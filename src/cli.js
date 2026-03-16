#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { renderToHtml } = require('./renderer');

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

if (args.length === 0) {
    console.log(`
usage: mdf <input.md> [output.pdf]

  input.md    required, the Markdown file to convert
  output.pdf  optional, the output PDF file name
              (if omitted, it will automatically use the same name, e.g. input.pdf)

examples:
  mdf README.md
  mdf doc.md custom-name.pdf
    `);
    process.exit(0);
}

const watchMode = args.includes('--watch') || args.includes('-w');
const filteredArgs = args.filter(a => a !== '--watch' && a !== '-w');
const inputFile = filteredArgs[0];
const outputFile = filteredArgs[1] || inputFile.replace(/\.md$/i, '.pdf');

// check if input file exists
if (!fs.existsSync(inputFile)) {
    console.error(`\x1b[31mError: file not found: ${inputFile}\x1b[0m`);
    process.exit(1);
}

async function convertToPdf(browser) {
    console.log(`converting: ${inputFile} → ${outputFile}`);

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
    const browser = await puppeteer.launch();

    try {
        await convertToPdf(browser);

        if (watchMode) {
            console.log(`\x1b[36mWatching for changes: ${inputFile}...\x1b[0m`);

            let debounceTimer;
            fs.watch(inputFile, (eventType) => {
                if (eventType === 'change') {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(async () => {
                        console.log(`\x1b[33mFile changed, re-converting...\x1b[0m`);
                        try {
                            await convertToPdf(browser);
                        } catch (err) {
                            console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
                        }
                    }, 300);
                }
            });

        } else {
            await browser.close();
        }
    } catch (err) {
        await browser.close();
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
    }
}

main();
