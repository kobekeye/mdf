// Typst preview performance benchmark.
//
// Measures the same two hot paths the VSCode preview uses:
//   1. extension-host-side incremental compile (WASM web compiler in Node)
//   2. webview-side SVG reset/merge render (headless Chromium)
//
// Run with:
//   node vscode-mdf/test/typst-perf.js
//
// Requires `npm run compile` first. The browser-side phase launches a local
// HTTP server plus a Chromium-based browser, so it may need elevated
// permissions in sandboxed environments.

const path = require('path');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const { performance } = require('perf_hooks');
const puppeteer = require('puppeteer-core');

const EXT = path.resolve(__dirname, '..');
const MDF_ROOT = path.resolve(EXT, '..');

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
const seedMarkdownFile = path.resolve(
  MDF_ROOT,
  process.env.MDF_PERF_SOURCE || 'README.md',
);

for (const f of [
  compilerPkg,
  compilerWasmFile,
  templateFile,
  webviewJsFile,
  webviewJsMapFile,
  rendererWasmFile,
  bundledFontDir,
  seedMarkdownFile,
]) {
  if (!fs.existsSync(f)) {
    console.error(`missing build artifact/input: ${f}`);
    console.error('run `npm run compile` in vscode-mdf/ first');
    process.exit(2);
  }
}

const typstTs = require(path.join(compilerPkg, 'dist/cjs/compiler.cjs'));
const optionsInit = require(path.join(compilerPkg, 'dist/cjs/options.init.cjs'));
const compilerWasmBytes = new Uint8Array(fs.readFileSync(compilerWasmFile));
const template = fs.readFileSync(templateFile, 'utf8');
const mdToTypst = require(path.join(MDF_ROOT, 'src/typst-renderer'));
const BLOCK_COUNT = Math.max(1, Number.parseInt(process.env.MDF_PERF_BLOCKS || '12', 10) || 12);
const ITERATION_COUNT = Math.max(2, Number.parseInt(process.env.MDF_PERF_ITERS || '24', 10) || 24);
const REPEAT_COUNT = Math.max(1, Number.parseInt(process.env.MDF_PERF_REPEAT || '1', 10) || 1);
const RAW_SOURCE = process.env.MDF_PERF_RAW === '1';

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
    for (const cmd of [
      'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
      'microsoft-edge', 'brave-browser', 'vivaldi',
    ]) {
      try {
        const p = execSync(`which ${cmd}`, { encoding: 'utf8' }).trim();
        if (p && fs.existsSync(p)) return p;
      } catch { /* try next */ }
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, v) => sum + v, 0) / Math.max(sorted.length, 1);
  return {
    count: sorted.length,
    min: sorted[0] || 0,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] || 0,
    avg,
  };
}

function fmtMs(n) {
  return `${n.toFixed(1)}ms`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  return `${(n / 1024).toFixed(1)}KiB`;
}

function formatSummary(label, values, formatter = fmtMs) {
  const s = summarize(values);
  return `${label}: avg=${formatter(s.avg)} p50=${formatter(s.p50)} p95=${formatter(s.p95)} min=${formatter(s.min)} max=${formatter(s.max)}`;
}

function buildSeedMarkdown() {
  const readme = fs.readFileSync(seedMarkdownFile, 'utf8').trim();
  if (RAW_SOURCE) {
    return Array.from({ length: REPEAT_COUNT }, () => readme).join('\n\n');
  }
  if (REPEAT_COUNT > 1) {
    return Array.from({ length: REPEAT_COUNT }, () => readme).join('\n\n');
  }
  const section = [
    '# Perf Bench',
    '',
    'This document is generated to benchmark Typst preview incremental updates.',
    '',
    readme,
    '',
    '## Repeated Blocks',
    '',
    ...Array.from({ length: BLOCK_COUNT }, (_, i) => [
      `### Block ${i + 1}`,
      '',
      `Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog. Counter ${i + 1}.`,
      '',
      '- alpha',
      '- beta',
      '- gamma',
      '',
      '$ integral_0^1 x dif x = 1/2 $',
      '',
      '```js',
      `console.log("block ${i + 1}");`,
      '```',
      '',
    ].join('\n')),
  ].join('\n');
  return section;
}

function buildVariants(baseMarkdown, count) {
  return Array.from({ length: count }, (_, i) => {
    const suffix = [
      '',
      '## Live Counter',
      '',
      `Tick ${String(i + 1).padStart(2, '0')} :: ${'x'.repeat((i % 9) + 1)}`,
    ].join('\n');
    return `${baseMarkdown}\n${suffix}\n`;
  });
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
  const ready = new Promise((resolve, reject) => {
    compiler.withIncrementalServer(async (server) => {
      incrementalServer = server;
      resolve();
      await release;
    }).catch(reject);
  });
  await ready;

  let firstCompile = true;
  return {
    async compile(markdown) {
      const src = template + '\n' + mdToTypst.renderToTypstFromString(markdown);
      compiler.addSource('/main.typ', src);
      const startedAt = performance.now();
      const result = await compiler.compile({
        mainFilePath: '/main.typ',
        root: '/',
        format: 'vector',
        diagnostics: 'full',
        incrementalServer,
      });
      const elapsedMs = performance.now() - startedAt;
      if (!result.result) {
        const msgs = (result.diagnostics || []).map((d) => (d && d.message) || String(d)).join('\n  ');
        throw new Error('compile failed:\n  ' + msgs);
      }
      const artifact = {
        type: 'render',
        action: firstCompile ? 'reset' : 'merge',
        data: result.result,
      };
      firstCompile = false;
      return { artifact, elapsedMs };
    },
    async dispose() {
      resolveRelease();
      await sleep(0);
    },
  };
}

function htmlShell() {
  const nonce = 'typst-perf-nonce';
  const csp = [
    `default-src 'none'`,
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self' data:`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
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
</style>
</head>
<body>
<div id="typst-container"></div>
<div id="typst-status"></div>
<script nonce="${nonce}">
  window.TYPST_WASM_URI = '/typst_ts_renderer_bg.wasm';
</script>
<script nonce="${nonce}" src="/typst-preview.js"></script>
</body>
</html>`;
}

function startHttpServer() {
  return new Promise((resolve, reject) => {
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
        res.writeHead(404);
        res.end();
      }
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

async function setupBrowser() {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error('No Chromium-based browser found');
  }

  const server = await startHttpServer();
  const browser = await puppeteer.launch({ executablePath: browserPath });
  const page = await browser.newPage();

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const renderEvents = [];

  await page.exposeFunction('__webviewPostMessage', (msg) => {
    if (msg && msg.type === 'ready') {
      resolveReady();
      return;
    }
    if (msg && msg.type === 'log' && typeof msg.message === 'string') {
      const match = /render #(\d+) complete; svg=(\d+)/.exec(msg.message);
      if (match) {
        renderEvents.push({
          version: Number.parseInt(match[1], 10),
          svgCount: Number.parseInt(match[2], 10),
          receivedAt: performance.now(),
        });
      }
    }
  });

  await page.evaluateOnNewDocument(() => {
    let state = {};
    window.acquireVsCodeApi = () => ({
      postMessage: (msg) => { window.__webviewPostMessage(msg); },
      getState: () => state,
      setState: (next) => { state = next || {}; },
    });
  });

  await page.goto(server.url, { waitUntil: 'load' });
  await Promise.race([
    ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for ready')), 20000)),
  ]);

  return {
    async render(artifact, version) {
      const startedAt = performance.now();
      await page.evaluate((kind, action, b64, renderVersion) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
        window.postMessage({ type: kind, action, data: bytes, version: renderVersion }, '*');
      }, artifact.type, artifact.action, Buffer.from(artifact.data).toString('base64'), version);

      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        const event = renderEvents.find((entry) => entry.version === version);
        if (event) {
          return { elapsedMs: event.receivedAt - startedAt, svgCount: event.svgCount };
        }
        await sleep(10);
      }
      throw new Error(`timeout waiting for render completion for version ${version}`);
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

async function main() {
  const markdownVariants = buildVariants(buildSeedMarkdown(), ITERATION_COUNT);
  const compiler = await setupCompiler();
  const browser = await setupBrowser();

  const compileTimes = [];
  const renderTimes = [];
  const endToEndTimes = [];
  const payloadSizes = [];

  try {
    for (let i = 0; i < markdownVariants.length; i++) {
      const version = i + 1;
      const startedAt = performance.now();
      const { artifact, elapsedMs: compileMs } = await compiler.compile(markdownVariants[i]);
      const { elapsedMs: renderMs, svgCount } = await browser.render(artifact, version);
      const totalMs = performance.now() - startedAt;

      compileTimes.push(compileMs);
      renderTimes.push(renderMs);
      endToEndTimes.push(totalMs);
      payloadSizes.push(artifact.data.length);

      const kind = artifact.action === 'reset' ? 'reset' : 'merge';
      console.log(
        `${String(version).padStart(2, '0')}. ${kind} ` +
        `compile=${fmtMs(compileMs)} render=${fmtMs(renderMs)} total=${fmtMs(totalMs)} ` +
        `payload=${fmtBytes(artifact.data.length)} svg=${svgCount}`,
      );
    }
  } finally {
    await browser.close();
    await compiler.dispose();
  }

  console.log('');
  console.log(`seed markdown: ${path.relative(MDF_ROOT, seedMarkdownFile)}`);
  console.log(`expanded markdown size: ${Buffer.byteLength(markdownVariants[0], 'utf8')} bytes`);
  console.log(`block count: ${BLOCK_COUNT}`);
  console.log(`iterations: ${markdownVariants.length}`);
  console.log(formatSummary('compile', compileTimes));
  console.log(formatSummary('render', renderTimes));
  console.log(formatSummary('end-to-end', endToEndTimes));
  console.log(formatSummary('payload', payloadSizes, fmtBytes));
}

main().catch((err) => {
  console.error('typst-perf crashed:', err && err.stack || err);
  process.exit(1);
});
