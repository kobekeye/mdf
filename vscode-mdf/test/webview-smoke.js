// Webview-pipeline smoke test for the Typst preview.
//
// Exercises the FULL browser-side renderer path — the thing VSCode runs
// inside its webview — without booting VSCode. Serves the bundled
// typst-preview.js + renderer WASM over a localhost HTTP server, launches
// headless Chrome (same browser the CLI uses for PDF rendering), stubs
// acquireVsCodeApi, and feeds in real vector artifacts produced by the actual
// web-compiler. Captures every log line the webview posts back and asserts
// that pages land in the DOM.
//
//   node vscode-mdf/test/webview-smoke.js
//
// Requires `npm run compile` first (needs out/media/typst-preview.js and
// out/media/typst_ts_renderer_bg.wasm). Also requires a Chromium-based
// browser installed on the system (same requirement as the mdf CLI).
//
// This pairs with preview-smoke.js: that one covers the extension-host
// compiler path, this one covers the webview renderer path. Together they
// cover the full Typst preview pipeline without VSCode in the loop.

const path = require('path');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const EXT = path.resolve(__dirname, '..');
const MDF_ROOT = path.resolve(EXT, '..');

// ── Build-artifact sanity checks ─────────────────────────────────────────
const compilerPkg = path.join(EXT, 'out/compiler/node_modules/@myriaddreamin/typst.ts');
const compilerWasmFile = path.join(
  EXT,
  'out/compiler/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
);
const templateFile = path.join(EXT, 'out/assets/default.typ');
const webviewJsFile = path.join(EXT, 'out/media/typst-preview.js');
const webviewJsMapFile = path.join(EXT, 'out/media/typst-preview.js.map');
const rendererWasmFile = path.join(EXT, 'out/media/typst_ts_renderer_bg.wasm');
const bundledFontDir = path.join(EXT, 'out/assets/typst-assets/fonts');

for (const f of [compilerPkg, compilerWasmFile, templateFile, webviewJsFile, webviewJsMapFile, rendererWasmFile, bundledFontDir]) {
  if (!fs.existsSync(f)) {
    console.error(`missing build artifact: ${f}`);
    console.error('run `npm run compile` in vscode-mdf/ first');
    process.exit(2);
  }
}

// ── Host-side compiler (mirrors Typst preview compile session) ───────────
const typstTs = require(path.join(compilerPkg, 'dist/cjs/compiler.cjs'));
const optionsInit = require(path.join(compilerPkg, 'dist/cjs/options.init.cjs'));
const compilerWasmBytes = new Uint8Array(fs.readFileSync(compilerWasmFile));
const template = fs.readFileSync(templateFile, 'utf8');
const mdToTypst = require(path.join(MDF_ROOT, 'src/typst-renderer'));

function readBundledTypstFonts() {
  return fs.readdirSync(bundledFontDir)
    .filter((name) => /\.(ttf|otf)$/i.test(name))
    .map((name) => new Uint8Array(fs.readFileSync(path.join(bundledFontDir, name))));
}

class NodeFsAccessModel {
  constructor(root) { this.root = root; }
  _resolve(p) { return path.join(this.root, p.replace(/^\/+/, '')); }
  getMTime(p) { try { return fs.statSync(this._resolve(p)).mtime; } catch { return undefined; } }
  isFile(p)   { try { return fs.statSync(this._resolve(p)).isFile(); } catch { return false; } }
  getRealPath(p) { return p; }
  readAll(p)  { try { return new Uint8Array(fs.readFileSync(this._resolve(p))); } catch { return undefined; } }
}

async function setupCompiler() {
  const compiler = typstTs.createTypstCompiler();
  await compiler.init({
    getModule: () => compilerWasmBytes,
    beforeBuild: [
      optionsInit.loadFonts(readBundledTypstFonts(), { assets: false }),
      optionsInit.withAccessModel(new NodeFsAccessModel(MDF_ROOT)),
    ],
  });
  let incrementalServer;
  let resolveRelease;
  const release = new Promise((resolve) => { resolveRelease = resolve; });
  const serverReady = new Promise((resolve, reject) => {
    compiler.withIncrementalServer(async (server) => {
      incrementalServer = server;
      resolve(server);
      await release;
    }).catch(reject);
  });
  await serverReady;

  let firstCompile = true;
  async function compile(md) {
    const src = template + '\n' + mdToTypst.renderToTypstFromString(md);
    compiler.addSource('/main.typ', src);
    const r = await compiler.compile({
      mainFilePath: '/main.typ', root: '/',
      format: 'vector', diagnostics: 'full',
      incrementalServer,
    });
    if (!r.result) {
      const msgs = (r.diagnostics || []).map((d) => (d && d.message) || String(d)).join('\n  ');
      throw new Error('compile failed:\n  ' + msgs);
    }
    const action = firstCompile ? 'reset' : 'merge';
    firstCompile = false;
    return { type: 'render', action, data: r.result };
  }

  return {
    compile,
    dispose: async () => { resolveRelease(); },
  };
}

// ── HTTP server that mimics VSCode's webview asset loader ───────────────
const NONCE = 'webview-smoke-nonce';

function htmlShell() {
  // Matches buildTypstWebviewHtml in src/typstPreview.ts as closely as useful.
  // Same CSP shape (including 'wasm-unsafe-eval'), same DOM ids.
  const csp = [
    `default-src 'none'`,
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self' data:`,
    `script-src 'nonce-${NONCE}' 'wasm-unsafe-eval'`,
    `img-src 'self' data:`,
    `connect-src 'self'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html, body { background: #2a2a2a; margin: 0; padding: 0; }
  #typst-container { width: fit-content; min-width: 100%; margin: 0 auto; padding: 24px 16px 32px; box-sizing: border-box; position: relative; }
  #typst-status.hidden { display: none; }
  #typst-container .typst-dom-page { display: block; background: white; }
  #typst-zoom-indicator.visible { opacity: 1; }
</style>
</head>
<body>
<div id="typst-container"></div>
<div id="typst-status"></div>
<script nonce="${NONCE}">
  window.TYPST_WASM_URI = '/typst_ts_renderer_bg.wasm';
</script>
<script nonce="${NONCE}" src="/typst-preview.js"></script>
</body>
</html>`;
}

function startHttpServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = (req.url || '').split('?')[0];
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(htmlShell());
      } else if (url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
      } else if (url === '/typst-preview.js') {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        fs.createReadStream(webviewJsFile).pipe(res);
      } else if (url === '/typst-preview.js.map') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        fs.createReadStream(webviewJsMapFile).pipe(res);
      } else if (url === '/typst_ts_renderer_bg.wasm') {
        res.writeHead(200, { 'content-type': 'application/wasm' });
        fs.createReadStream(rendererWasmFile).pipe(res);
      } else {
        res.writeHead(404); res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

// ── Browser detection (same approach as src/cli.js) ─────────────────────
function findBrowser() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : process.platform === 'linux'
      ? [
          '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium', '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
          '/usr/bin/brave', '/usr/bin/brave-browser',
          '/usr/bin/vivaldi', '/usr/bin/vivaldi-stable',
        ]
      : [];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  if (process.platform !== 'win32') {
    for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
                        'microsoft-edge', 'brave-browser', 'vivaldi']) {
      try {
        const p = execSync(`which ${cmd}`, { encoding: 'utf8' }).trim();
        if (p && fs.existsSync(p)) return p;
      } catch { /* try next */ }
    }
  }
  return null;
}

// ── Utilities ───────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

function fmtLog(entry) {
  if (entry && entry.type === 'log') {
    return `    [${entry.level}] ${entry.message}`;
  }
  return '    ' + JSON.stringify(entry);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const compiler = await setupCompiler();
  const server = await startHttpServer();

  const execPath = findBrowser();
  if (!execPath) {
    console.error('No Chromium-based browser found; install Chrome/Chromium/Edge/Brave/Vivaldi.');
    process.exit(2);
  }

  const browser = await puppeteer.launch({ executablePath: execPath });
  let exitCode = 0;
  try {
    const page = await browser.newPage();

    const logs = [];
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });

    await page.exposeFunction('__webviewPostMessage', (msg) => {
      logs.push(msg);
      if (msg && msg.type === 'ready') resolveReady();
    });
    await page.evaluateOnNewDocument(() => {
      let state = {};
      window.acquireVsCodeApi = () => ({
        postMessage: (m) => { window.__webviewPostMessage(m); },
        getState: () => state,
        setState: (next) => { state = next || {}; },
      });
    });

    page.on('pageerror', (err) => {
      logs.push({ type: 'log', level: 'error', message: 'pageerror: ' + (err.stack || err.message) });
    });
    page.on('requestfailed', (req) => {
      logs.push({ type: 'log', level: 'error',
        message: `requestfailed: ${req.url()} — ${req.failure() && req.failure().errorText}` });
    });
    page.on('console', (msg) => {
      // Only surface browser-console errors/warnings; info is already teed
      // through the postMessage bridge.
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        logs.push({ type: 'log', level: type === 'warning' ? 'warn' : 'error',
          message: 'console.' + type + ': ' + msg.text() });
      }
    });

    await page.goto(server.url, { waitUntil: 'load' });
    await withTimeout(ready, 20000, 'timeout waiting for webview "ready" (bootstrap + WASM init)');

    async function postArtifact(delta) {
      const crypto = require('crypto');
      const nodeHash = crypto.createHash('sha256').update(delta.data).digest('hex');
      const pageHash = await page.evaluate(async (kind, action, b64, expectedHash) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hex = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0')).join('');
        window.postMessage({ type: kind, action, data: bytes }, '*');
        return { hex, len: bytes.length, expectedHash };
      }, delta.type, delta.action, Buffer.from(delta.data).toString('base64'), nodeHash);
      if (pageHash.hex !== nodeHash) {
        console.error(`  byte-integrity mismatch: node=${nodeHash.slice(0,12)} page=${pageHash.hex.slice(0,12)} len=${pageHash.len} vs ${delta.data.length}`);
      }
    }

    async function runCase(label, md, minPages) {
      const delta = await compiler.compile(md);
      const before = logs.length;
      await postArtifact(delta);

      // Wait for either the render completion log (success path) or an error.
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const fresh = logs.slice(before);
        if (fresh.some((l) => l && l.type === 'log' && /render #\d+ complete; svg=/.test(l.message || ''))) break;
        if (fresh.some((l) => l && l.type === 'log' && l.level === 'error')) break;
        await sleep(50);
      }

      const fresh = logs.slice(before);
      const errs = fresh.filter((l) => l && l.type === 'log' && l.level === 'error');
      const svgCount = await page.evaluate(
        () => document.querySelectorAll('#typst-container svg').length,
      );

      if (errs.length > 0 || svgCount < minPages) {
        console.error(`✗ ${label}: svg=${svgCount} (want ≥ ${minPages}), bytes=${delta.data.length}`);
        if (errs.length) {
          console.error('  errors:');
          for (const e of errs) console.error(fmtLog(e));
        }
        const info = fresh.filter((l) => l && l.type === 'log' && l.level === 'info').slice(-8);
        if (info.length) {
          console.error('  recent info logs:');
          for (const i of info) console.error(fmtLog(i));
        }
        return false;
      }
      console.log(`✓ ${label} — bytes=${delta.data.length}, svg=${svgCount}`);
      return true;
    }

    async function countMissingVisibleUseRefs() {
      return await page.evaluate(() => {
        const root = document.querySelector('#typst-container svg');
        if (!root) return -1;
        const ids = new Set(Array.from(root.querySelectorAll('[id]'), (el) => el.id));
        let missing = 0;
        for (const textGroup of root.querySelectorAll('.typst-text')) {
          const text = textGroup.querySelector('foreignObject')?.textContent || '';
          const uses = Array.from(textGroup.children).filter((el) => el.tagName === 'use');
          for (let i = 0; i < uses.length; i++) {
            const href = uses[i].getAttribute('href') || uses[i].getAttribute('xlink:href');
            if (!href?.startsWith('#') || ids.has(href.slice(1))) continue;

            const char = text[i] || '';
            if (!/\s/.test(char)) missing++;
          }
        }
        return missing;
      });
    }

    async function runZoomCase() {
      const baseMetrics = await page.evaluate(() => {
        const svg = document.querySelector('#typst-container svg');
        if (!(svg instanceof SVGSVGElement)) return null;
        const rect = svg.getBoundingClientRect();
        const viewBox = svg.viewBox.baseVal;
        return {
          availableWidth: Math.max(window.innerWidth - 32, 1),
          renderedWidth: rect.width,
          naturalWidth: viewBox?.width || 0,
        };
      });
      if (!baseMetrics) {
        console.error('✗ zoom threshold: no SVG found');
        return false;
      }
      if (Math.abs(baseMetrics.renderedWidth - baseMetrics.availableWidth) > 0.5) {
        console.error(`✗ fit width: expected ${baseMetrics.availableWidth}, got ${baseMetrics.renderedWidth}`);
        return false;
      }

      await page.evaluate(() => {
        window.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -8,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await sleep(50);

      const afterSmallDelta = await page.evaluate(() => {
        const svg = document.querySelector('#typst-container svg');
        return svg instanceof SVGSVGElement ? svg.getBoundingClientRect().width : -1;
      });
      if (Math.abs(afterSmallDelta - baseMetrics.renderedWidth) > 0.5) {
        console.error(`✗ zoom threshold: small pinch changed width ${baseMetrics.renderedWidth} -> ${afterSmallDelta}`);
        return false;
      }

      await page.evaluate(() => {
        window.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -16,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await sleep(50);

      const afterThresholdCross = await page.evaluate(() => {
        const svg = document.querySelector('#typst-container svg');
        const indicator = document.getElementById('typst-zoom-indicator');
        return {
          renderedWidth: svg instanceof SVGSVGElement ? svg.getBoundingClientRect().width : -1,
          indicatorVisible: indicator?.classList.contains('visible') || false,
        };
      });
      if (afterThresholdCross.renderedWidth <= baseMetrics.renderedWidth + 0.5) {
        console.error(`✗ zoom threshold: pinch past threshold did not zoom in (${baseMetrics.renderedWidth} -> ${afterThresholdCross.renderedWidth})`);
        return false;
      }
      if (
        baseMetrics.naturalWidth > baseMetrics.renderedWidth + 0.5 &&
        afterThresholdCross.renderedWidth <= baseMetrics.naturalWidth
      ) {
        console.error(`✗ zoom overflow: wide page stayed capped at fit width (${afterThresholdCross.renderedWidth} <= natural ${baseMetrics.naturalWidth})`);
        return false;
      }
      if (!afterThresholdCross.indicatorVisible) {
        console.error('✗ zoom threshold: zoom indicator did not appear');
        return false;
      }

      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: '0',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      await sleep(50);

      const afterReset = await page.evaluate(() => {
        const svg = document.querySelector('#typst-container svg');
        return svg instanceof SVGSVGElement ? svg.getBoundingClientRect().width : -1;
      });
      if (Math.abs(afterReset - baseMetrics.renderedWidth) > 0.5) {
        console.error(`✗ zoom reset: expected ${baseMetrics.renderedWidth}, got ${afterReset}`);
        return false;
      }

      console.log('✓ zoom threshold + overflow + reset');
      return true;
    }

    async function runPageGapCase() {
      if (!(await runCase(
        'manual page gap',
        '# first page\n\n==page==\n\n# second page\n',
        1,
      ))) return false;

      const metrics = await page.evaluate(() => {
        const svg = document.querySelector('#typst-container svg.typst-doc');
        if (!(svg instanceof SVGSVGElement)) return null;

        const pages = Array.from(svg.querySelectorAll(':scope > g.typst-page'));
        if (pages.length < 2) return { pageCount: pages.length };

        const firstHeight = Number.parseFloat(pages[0].getAttribute('data-page-height') || '');
        const secondTransform = pages[1].getAttribute('transform') || '';
        const secondY = Number.parseFloat(secondTransform.match(/translate\(\s*[^,\s)]+[,\s]+([^)]+)/)?.[1] || '');
        const bgCount = svg.querySelectorAll('rect.mdf-preview-page-bg').length;
        const svgHeight = Number.parseFloat(svg.getAttribute('data-height') || svg.getAttribute('height') || '');

        return { pageCount: pages.length, firstHeight, secondY, bgCount, svgHeight };
      });

      if (!metrics || metrics.pageCount < 2) {
        console.error('✗ manual page gap: expected at least two Typst page groups');
        return false;
      }
      if (metrics.bgCount < metrics.pageCount) {
        console.error(`✗ manual page gap: expected page backgrounds for ${metrics.pageCount} pages, got ${metrics.bgCount}`);
        return false;
      }
      if (!(metrics.secondY > metrics.firstHeight)) {
        console.error(`✗ manual page gap: second page y=${metrics.secondY}, first height=${metrics.firstHeight}`);
        return false;
      }
      if (!(metrics.svgHeight > metrics.firstHeight * metrics.pageCount)) {
        console.error(`✗ manual page gap: svg height=${metrics.svgHeight}, page height sum=${metrics.firstHeight * metrics.pageCount}`);
        return false;
      }

      console.log(`✓ manual page gap — y=${metrics.secondY}, page=${metrics.firstHeight}, svgHeight=${metrics.svgHeight}`);
      return true;
    }

    let allPass = true;
    // ── Case 1: the minimal "# mdf" that broke live preview before ────────
    if (!(await runCase('minimal "# mdf"', '# mdf\n', 1))) allPass = false;

    // ── Case 2: second compile of identical source — tests repeatability ───
    if (!(await runCase('second compile (identical)', '# mdf\n', 1))) allPass = false;

    // ── Case 3: editing a heading to include "+" after preview is live ─────
    if (!(await runCase(
      'heading before plus edit',
      '# mdf Intro\n\n[TOC]\n',
      1,
    ))) allPass = false;
    if (!(await runCase(
      'heading after plus edit',
      '# mdf Introx+y\n\n[TOC]\n',
      1,
    ))) allPass = false;
    {
      const missingRefs = await countMissingVisibleUseRefs();
      if (missingRefs !== 0) {
        allPass = false;
        console.error(`✗ heading after plus edit: ${missingRefs} missing visible SVG <use> references`);
      } else {
        console.log('✓ heading after plus edit — no missing visible SVG <use> references');
      }
    }

    // ── Case 4: math (needs NewCMMath from bundled text assets) ───────
    if (!(await runCase(
      'math block + inline',
      '# math\n\n$ integral_0^1 x dif x = 1/2 $\n\nInline $x^2 + y^2 = z^2$ text.\n',
      1,
    ))) allPass = false;

    // ── Case 5: CJK text ──────────────────────────────────────────────
    if (!(await runCase(
      'CJK',
      '# 中文標題\n\n這是一段繁體中文，測試 CJK 字型。\n',
      1,
    ))) allPass = false;

    // ── Case 6: manual page breaks get visible page gaps ──────────────
    if (!(await runPageGapCase())) allPass = false;

    // ── Case 7: trackpad pinch thresholded zoom ───────────────────────
    if (!(await runZoomCase())) allPass = false;

    if (!allPass) {
      exitCode = 1;
      console.error('\nSome webview-smoke checks failed.');
    } else {
      console.log('\nAll webview-smoke checks passed.');
    }
  } catch (err) {
    console.error('webview-smoke crashed:', err && err.stack || err);
    exitCode = 1;
  } finally {
    try { await compiler.dispose(); } catch { /* best-effort */ }
    try { await browser.close(); } catch { /* best-effort */ }
    try { await server.close(); } catch { /* best-effort */ }
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error('webview-smoke crashed:', err && err.stack || err);
  process.exit(1);
});
