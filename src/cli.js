#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chokidar = require('chokidar');
const puppeteer = require('puppeteer-core');
const { renderToHtml, setTheme, prepareFonts } = require('./renderer');
const { renderToTypst } = require('./typst-renderer');
const { parseFontMeta, ensureFonts, getFontCacheDir } = require('./font-manager');

const BROWSERS = [
    // Google Chrome
    { name: 'Google Chrome', paths: {
        linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
        darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        win32: [
            path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        ],
    }},
    // Chromium
    { name: 'Chromium', paths: {
        linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser'],
        darwin: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
        win32: [
            path.join(process.env.LOCALAPPDATA || '', 'Chromium/Application/chrome.exe'),
        ],
    }},
    // Microsoft Edge
    { name: 'Microsoft Edge', paths: {
        linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
        darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
        win32: [
            path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
        ],
    }},
    // Brave
    { name: 'Brave', paths: {
        linux: ['/usr/bin/brave', '/usr/bin/brave-browser'],
        darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
        win32: [
            path.join(process.env.PROGRAMFILES || '', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
        ],
    }},
    // Opera
    { name: 'Opera', paths: {
        linux: ['/usr/bin/opera'],
        darwin: ['/Applications/Opera.app/Contents/MacOS/Opera'],
        win32: [
            path.join(process.env.PROGRAMFILES || '', 'Opera/opera.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs/Opera/opera.exe'),
        ],
    }},
    // Vivaldi
    { name: 'Vivaldi', paths: {
        linux: ['/usr/bin/vivaldi', '/usr/bin/vivaldi-stable'],
        darwin: ['/Applications/Vivaldi.app/Contents/MacOS/Vivaldi'],
        win32: [
            path.join(process.env.LOCALAPPDATA || '', 'Vivaldi/Application/vivaldi.exe'),
        ],
    }},
];

function findBrowser() {
    const platform = process.platform;

    for (const browser of BROWSERS) {
        const candidates = browser.paths[platform] || [];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                return { name: browser.name, path: p };
            }
        }
    }

    // fallback: try `which` on Linux/macOS
    if (platform !== 'win32') {
        const cmds = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
                       'microsoft-edge', 'brave-browser', 'opera', 'vivaldi'];
        for (const cmd of cmds) {
            try {
                const result = execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim();
                if (result) return { name: cmd, path: result };
            } catch (_) { }
        }
    }

    return null;
}

let tempFiles = [];

// gracefully handle Ctrl+C: clean up temp files before exit
// must be registered before puppeteer.launch(), which installs its own SIGINT wrapper
process.on('SIGINT', () => {
    for (const tempFile of tempFiles) {
        try { fs.unlinkSync(tempFile); } catch (_) { }
    }
    process.exit(0);
});

// parse command line arguments
const args = process.argv.slice(2);

if (args.includes('-v') || args.includes('--version')) {
    const pkg = require('../package.json');
    console.log(pkg.version);
    process.exit(0);
}

function printHelp() {
    console.log(`
usage: mdf <input.md> [output.pdf] [-w|--watch] [--typ] [--theme <name>]

  input.md        required, the Markdown file to convert
  output.pdf      optional, the output PDF file name
                  (if omitted, it will automatically use the same name, e.g. input.pdf)
  -w, --watch     watch for changes and re-convert automatically
  --typ           use Typst pipeline (faster, no browser needed)
  --theme <name>  use a custom theme (default: default)
                  available: default, asterisk
  -h, --help      show this help message
  -v, --version   show version number

examples:
  mdf README.md
  mdf doc.md custom-name.pdf
  mdf doc.md --typ
  mdf doc.md -w --typ
  mdf doc.md --theme asterisk
    `);
    process.exit(0);
}

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
}

const watchMode = args.includes('--watch') || args.includes('-w');
const typstMode = args.includes('--typ');

// parse --theme option
const themeIdx = args.indexOf('--theme');
const themeName = themeIdx !== -1 && args[themeIdx + 1] ? args[themeIdx + 1] : 'default';
if (themeName) setTheme(themeName);

const filteredArgs = args.filter((a, i) => a !== '--watch' && a !== '-w' && a !== '--typ' && a !== '--theme' && (themeIdx === -1 || i !== themeIdx + 1));
const inputFile = filteredArgs[0];
const outputFile = filteredArgs[1] || inputFile.replace(/\.md$/i, '.pdf');

// check if input file exists
if (!fs.existsSync(inputFile)) {
    console.error(`\x1b[31mError: file not found: ${inputFile}\x1b[0m`);
    process.exit(1);
}

const typTemplatePath = path.join(__dirname, '..', 'themes', `${themeName}.typ`);

// Thrown when typst compile fails. `diagnostics` is an array of { message, path, range, severity }
// from NodeCompiler.fetchDiagnostics()/shortDiagnostics. The .message is already formatted for display.
class TypstCompileError extends Error {
    constructor(diagnostics) {
        const body = diagnostics.map(formatTypstDiagnostic).join('\n');
        super('Typst compile failed:\n' + body);
        this.name = 'TypstCompileError';
        this.diagnostics = diagnostics;
    }
}

function formatTypstDiagnostic(d) {
    const sev = d.severity === 1 ? 'error' : 'warning';
    const file = d.path ? path.basename(d.path) : '<main>';
    const range = d.range ? ':' + JSON.stringify(d.range) : '';
    return `  [${sev}] ${file}${range}\n      ${String(d.message).replace(/\n/g, '\n      ')}`;
}

function extractDiagnostics(compiler, rawDiag) {
    // Prefer fetchDiagnostics (full) then fall back to shortDiagnostics.
    try {
        const full = compiler.fetchDiagnostics(rawDiag);
        if (Array.isArray(full) && full.length > 0) return full;
    } catch (_) { /* fall through */ }
    return (rawDiag && rawDiag.shortDiagnostics) || [];
}

async function convertToTypstPdf() {
    console.log(`converting: ${inputFile} → ${outputFile}`);

    const { NodeCompiler } = require('@myriaddreamin/typst-ts-node-compiler');

    if (!fs.existsSync(typTemplatePath)) {
        throw new Error(`theme not found: ${themeName}`);
    }

    const template = fs.readFileSync(typTemplatePath, 'utf-8');
    const fontSpecs = parseFontMeta(template);
    await ensureFonts(fontSpecs, themeName);

    const body = renderToTypst(inputFile);
    const fullTypst = template + '\n' + body;

    const inputDir = path.dirname(path.resolve(inputFile));
    const $typst = NodeCompiler.create({
        workspace: inputDir,
        fontArgs: [{ fontPaths: [getFontCacheDir()] }],
    });

    // Two-phase API: compile() → hasError() → pdf(doc). The one-step pdf()
    // throws a useless Error with an empty message on compile errors, so we
    // go through compile() to get structured diagnostics.
    const result = $typst.compile({ mainFileContent: fullTypst });
    if (result.hasError()) {
        throw new TypstCompileError(extractDiagnostics($typst, result.takeDiagnostics()));
    }
    const doc = result.result;
    if (!doc) {
        throw new TypstCompileError([{ message: 'compile() returned no document', path: '', range: null, severity: 1 }]);
    }
    const pdfBuffer = $typst.pdf(doc);
    fs.writeFileSync(path.resolve(outputFile), pdfBuffer);
    console.log(`\x1b[32mDone! Output to: ${path.resolve(outputFile)}\x1b[0m`);
}

// Print any error with as much detail as possible. The typst-ts-node-compiler
// sometimes throws plain Error objects with an empty `message`, so fall back
// through stack → name → inspect → String(err).
function printError(err) {
    if (err instanceof TypstCompileError) {
        console.error('\x1b[31m' + err.message + '\x1b[0m');
        return;
    }
    const util = require('util');
    const detail = err && (err.stack || err.message) ? (err.stack || err.message) : util.inspect(err, { depth: 3 });
    console.error('\x1b[31mError: ' + detail + '\x1b[0m');
}

async function convertToPdf(browser) {
    console.log(`converting: ${inputFile} → ${outputFile}`);

    await prepareFonts();
    const fullHtml = renderToHtml(inputFile);

    // write HTML to temp file (in the same directory as Markdown), let Puppeteer parse relative path of images correctly
    const inputDir = path.dirname(path.resolve(inputFile));
    const tempHtmlPath = path.join(inputDir, `.mdf-temp-${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, fullHtml, 'utf-8');

    tempFiles.push(tempHtmlPath);
    try {
        const page = await browser.newPage();
        // use file:// URL to load, let relative path of images parse correctly
        await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle0' });
        // wait for all fonts (including Google Fonts) to load completely, avoid CJK characters use synthetic bold
        await page.evaluate(() => document.fonts.ready);

        await page.pdf({
            path: outputFile,
            format: 'A4',
            printBackground: true,
            margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },

            displayHeaderFooter: true,
            headerTemplate: '<span></span>',  // do not display header
            footerTemplate: `
            <div style="width: 100%; text-align: center; font-size: 14px; color: #888; font-family: 'Times New Roman', Times, serif; margin-bottom: 5mm;">
                <span class="pageNumber"></span>
            </div>`,
        });

        await page.close();
        console.log(`\x1b[32mDone! Output to: ${path.resolve(outputFile)}\x1b[0m`);
    } finally {
        // clean up temp HTML file
        try { fs.unlinkSync(tempHtmlPath); } catch (_) { }
    }
}

async function main() {
    if (typstMode) {
        try {
            await convertToTypstPdf();
        } catch (err) {
            printError(err);
            process.exit(1);
        }

        if (watchMode) {
            console.log(`\x1b[36mWatching for changes: ${inputFile}...\x1b[0m`);
            let debounceTimer;
            chokidar.watch(inputFile, { ignoreInitial: true }).on('change', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    console.log(`\x1b[33mFile changed, re-converting...\x1b[0m`);
                    try {
                        await convertToTypstPdf();
                    } catch (err) {
                        printError(err);
                    }
                }, 300);
            });
        }
        return;
    }

    const detected = findBrowser();
    if (!detected) {
        console.error('\x1b[31mError: no supported browser found.\x1b[0m');
        console.error('Please install one of: Google Chrome, Chromium, Microsoft Edge, Brave, Opera, or Vivaldi.');
        process.exit(1);
    }
    console.log(`\x1b[90mUsing browser: ${detected.name}\x1b[0m`);
    const browser = await puppeteer.launch({ executablePath: detected.path });

    try {
        await convertToPdf(browser);

        if (watchMode) {
            console.log(`\x1b[36mWatching for changes: ${inputFile}...\x1b[0m`);

            let debounceTimer;
            chokidar.watch(inputFile, { ignoreInitial: true }).on('change', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    console.log(`\x1b[33mFile changed, re-converting...\x1b[0m`);
                    try {
                        await convertToPdf(browser);
                    } catch (err) {
                        printError(err);
                    }
                }, 300);
            });

        } else {
            await browser.close();
        }
    } catch (err) {
        await browser.close();
        printError(err);
        process.exit(1);
    }
}

main();
