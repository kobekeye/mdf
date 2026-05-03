const esbuild = require('esbuild');
const { cpSync, mkdirSync, readdirSync, existsSync } = require('fs');
const path = require('path');

const mdfRoot = path.join(__dirname, '..');
const isWatch = process.argv.includes('--watch');

// ── Extension host bundle ────────────────────────────────────────────────────
const hostOptions = {
  entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
  bundle: true,
  outfile: path.join(__dirname, 'out', 'extension.js'),
  external: ['vscode', '@myriaddreamin/*'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  tsconfig: path.join(__dirname, 'tsconfig.json'),
};

// ── Webview client bundle ────────────────────────────────────────────────────
// Runs in the VSCode webview (browser context). Bundles @myriaddreamin/typst.ts
// + the WASM renderer into a single IIFE.
const webviewOptions = {
  entryPoints: [path.join(__dirname, 'media', 'typst-preview.ts')],
  bundle: true,
  outfile: path.join(__dirname, 'out', 'media', 'typst-preview.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  tsconfig: path.join(__dirname, 'tsconfig.json'),
  // The webview fetches the WASM binary via TYPST_WASM_URI; keep `.wasm`
  // imports out of the bundle (esbuild would otherwise try to load them).
  loader: { '.wasm': 'file' },
};

// Copy CSS assets + fonts into the extension
function copyAssets() {
  const assetsDir = path.join(__dirname, 'out', 'assets');
  mkdirSync(assetsDir, { recursive: true });
  cpSync(path.join(mdfRoot, 'node_modules/katex/dist/katex.min.css'), path.join(assetsDir, 'katex.min.css'));
  cpSync(path.join(mdfRoot, 'node_modules/katex/dist/fonts'), path.join(assetsDir, 'fonts'), { recursive: true });
  cpSync(path.join(mdfRoot, 'node_modules/highlight.js/styles/github-dark.css'), path.join(assetsDir, 'github-dark.css'));
  cpSync(path.join(mdfRoot, 'node_modules/markdown-it-texmath/css/texmath.css'), path.join(assetsDir, 'texmath.css'));
  cpSync(path.join(mdfRoot, 'themes/default.css'), path.join(assetsDir, 'default.css'));
  cpSync(path.join(mdfRoot, 'themes/asterisk.css'), path.join(assetsDir, 'asterisk.css'));
  cpSync(path.join(mdfRoot, 'themes/default.typ'), path.join(assetsDir, 'default.typ'));
  cpSync(
    path.join(__dirname, 'vendor', 'typst-assets'),
    path.join(assetsDir, 'typst-assets'),
    { recursive: true },
  );
}

// Bundle the Typst compiler(s) into out/compiler/ so the extension doesn't
// need to npm-install at runtime.
//
//   typst-ts-node-compiler     → PDF export (native NAPI)
//   typst.ts + typst-ts-web-compiler + typst-ts-renderer
//                              → incremental preview (WASM, extension host)
//
// Copies the main packages + all available platform binaries. We also copy
// the renderer's WASM blob into out/media/ so the webview can fetch it.
function copyCompiler() {
  // typst-ts-node-compiler and its platform binaries live in the monorepo
  // root (used by the CLI + PDF export). The other three are vscode-mdf deps.
  const rootSrc = path.join(mdfRoot, 'node_modules', '@myriaddreamin');
  const localSrc = path.join(__dirname, 'node_modules', '@myriaddreamin');
  const dest = path.join(__dirname, 'out', 'compiler', 'node_modules', '@myriaddreamin');
  mkdirSync(dest, { recursive: true });

  // PDF path (node-compiler)
  if (existsSync(rootSrc)) {
    for (const entry of readdirSync(rootSrc)) {
      if (entry.startsWith('typst-ts-node-compiler')) {
        cpSync(path.join(rootSrc, entry), path.join(dest, entry), { recursive: true });
      }
    }
  }

  // Preview path (web-compiler + renderer + typst.ts core)
  for (const pkg of ['typst.ts', 'typst-ts-web-compiler', 'typst-ts-renderer']) {
    const srcPath = existsSync(path.join(localSrc, pkg))
      ? path.join(localSrc, pkg)
      : path.join(rootSrc, pkg);
    if (!existsSync(srcPath)) {
      throw new Error(`copyCompiler: @myriaddreamin/${pkg} not found in node_modules`);
    }
    cpSync(srcPath, path.join(dest, pkg), { recursive: true });
  }

  // Copy the renderer WASM into out/media/ so the webview can fetch it via
  // webview.asWebviewUri. The compiler WASM stays in out/compiler/... and
  // is loaded via fs.readFileSync at extension-host startup.
  const rendererWasmSrc = path.join(
    dest, 'typst-ts-renderer', 'pkg', 'typst_ts_renderer_bg.wasm',
  );
  if (existsSync(rendererWasmSrc)) {
    const mediaOutDir = path.join(__dirname, 'out', 'media');
    mkdirSync(mediaOutDir, { recursive: true });
    cpSync(rendererWasmSrc, path.join(mediaOutDir, 'typst_ts_renderer_bg.wasm'));
  } else {
    throw new Error(`copyCompiler: renderer WASM missing at ${rendererWasmSrc}`);
  }
}

copyAssets();
copyCompiler();

if (isWatch) {
  Promise.all([
    esbuild.context(hostOptions).then(ctx => ctx.watch()),
    esbuild.context(webviewOptions).then(ctx => ctx.watch()),
  ]).then(() => {
    console.log('Watching for changes (host + webview)…');
  });
} else {
  esbuild.buildSync(hostOptions);
  esbuild.buildSync(webviewOptions);
  console.log('Build complete.');
}
