// Preview-pipeline smoke test.
//
// Exercises the exact WASM web-compiler setup that the VSCode extension uses
// for live preview — without touching VSCode at all. Run with:
//
//   node vscode-mdf/test/preview-smoke.js
//
// (Requires `npm run compile` first so out/compiler and out/assets exist.)
//
// This is the SOP: whenever the typst preview path changes, run this. If it
// fails here it will fail in VSCode.

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const EXT = path.resolve(__dirname, '..');
const MDF_ROOT = path.resolve(EXT, '..');

const compilerPkg = path.join(EXT, 'out/compiler/node_modules/@myriaddreamin/typst.ts');
const wasmFile = path.join(
  EXT,
  'out/compiler/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
);
const templateFile = path.join(EXT, 'out/assets/default.typ');
const bundledFontDir = path.join(EXT, 'out/assets/typst-assets/fonts');

for (const f of [compilerPkg, wasmFile, templateFile, bundledFontDir]) {
  if (!fs.existsSync(f)) {
    console.error(`missing build artifact: ${f}`);
    console.error('run `npm run compile` in vscode-mdf/ first');
    process.exit(2);
  }
}

const typstTs = require(path.join(compilerPkg, 'dist/cjs/compiler.cjs'));
const optionsInit = require(path.join(compilerPkg, 'dist/cjs/options.init.cjs'));
const wasmBytes = new Uint8Array(fs.readFileSync(wasmFile));
const template = fs.readFileSync(templateFile, 'utf8');
const mdToTypst = require(path.join(MDF_ROOT, 'src/typst-renderer'));

function readBundledTypstFonts() {
  return fs.readdirSync(bundledFontDir)
    .filter((name) => /\.(ttf|otf)$/i.test(name))
    .map((name) => new Uint8Array(fs.readFileSync(path.join(bundledFontDir, name))));
}

// Node-backed FS access model — mirrors the one in src/typstPreview.ts.
class NodeFsAccessModel {
  constructor(root) { this.root = root; }
  _resolve(p) { return path.join(this.root, p.replace(/^\/+/, '')); }
  getMTime(p) { try { return fs.statSync(this._resolve(p)).mtime; } catch { return undefined; } }
  isFile(p)   { try { return fs.statSync(this._resolve(p)).isFile(); } catch { return false; } }
  getRealPath(p) { return p; }
  readAll(p)  { try { return new Uint8Array(fs.readFileSync(this._resolve(p))); } catch { return undefined; } }
}

function fmtDiag(d) {
  const sev = typeof d === 'object' && d ? (d.severity ?? 'error') : 'error';
  const file = typeof d === 'object' && d ? (String(d.path || '').split(/[\\/]/).pop() || '<main>') : '<main>';
  const msg = typeof d === 'object' && d ? (d.message ?? JSON.stringify(d)) : String(d);
  return `  [${sev}] ${file}  ${msg}`;
}

function expectSuccess(label, result, { allowEmpty = false } = {}) {
  if (!result.result) {
    console.error(`✗ ${label} — compile failed:`);
    for (const d of result.diagnostics || []) console.error(fmtDiag(d));
    process.exit(1);
  }
  assert.ok(result.result instanceof Uint8Array, `${label}: result not Uint8Array`);
  if (!allowEmpty) {
    assert.ok(result.result.length > 0, `${label}: empty result`);
  }
  console.log(`✓ ${label} — ${result.result.length} bytes` +
    (result.diagnostics?.length ? ` (${result.diagnostics.length} warnings)` : ''));
}

async function compileOnce(compiler, incrementalServer, label, src, opts = {}) {
  compiler.addSource('/main.typ', src);
  const r = await compiler.compile({
    mainFilePath: '/main.typ',
    root: '/',
    format: 'vector',
    diagnostics: 'full',
    incrementalServer,
  });
  expectSuccess(label, r, opts);
  return r;
}

async function main() {
  const compiler = typstTs.createTypstCompiler();
  const accessModel = new NodeFsAccessModel(MDF_ROOT);
  await compiler.init({
    getModule: () => wasmBytes,
    beforeBuild: [
      optionsInit.loadFonts(readBundledTypstFonts(), { assets: false }),
      optionsInit.withAccessModel(accessModel),
    ],
  });

  await compiler.withIncrementalServer(async (incrementalServer) => {
    // ── Case 1: the literal "typ.md = '# mdf'" that broke live preview ─────
    await compileOnce(
      compiler,
      incrementalServer,
      'initial incremental compile',
      template + '\n' + mdToTypst.renderToTypstFromString('# mdf\n'),
    );

    // ── Case 2: second compile, identical source — should still be cheap and valid
    await compileOnce(
      compiler,
      incrementalServer,
      'second compile (identical)',
      template + '\n' + mdToTypst.renderToTypstFromString('# mdf\n'),
      { allowEmpty: true },
    );

    // ── Case 3: math — user reported this is broken ──────────────────────
    const r3 = await compileOnce(
      compiler,
      incrementalServer,
      'math block + inline',
      template + '\n' + mdToTypst.renderToTypstFromString(
        '# math\n\n$ integral_0^1 x dif x = 1/2 $\n\nInline $x^2 + y^2 = z^2$ text.\n',
      ),
    );
    // A math document without bundled math fonts collapses to a tiny delta.
    if (r3.result.length < 2000) {
      console.error(`✗ math output suspiciously small (${r3.result.length} B) — math fonts not loaded`);
      process.exit(1);
    }

    // ── Case 4: CJK text ──────────────────────────────────────────────────
    await compileOnce(
      compiler,
      incrementalServer,
      'CJK',
      template + '\n' + mdToTypst.renderToTypstFromString(
        '# 中文標題\n\n這是一段繁體中文，測試 CJK 字型。\n',
      ),
    );

    // ── Case 5: #image with a relative path (reproduces "access denied") ──
    const demoImg = path.join(MDF_ROOT, 'Markdown-mark.svg');
    if (fs.existsSync(demoImg)) {
      await compileOnce(
        compiler,
        incrementalServer,
        'relative #image',
        template + '\n' + mdToTypst.renderToTypstFromString(
          '# image\n\n![mdf](Markdown-mark.svg)\n',
        ),
      );
    } else {
      console.log(`• skipping relative-image case (${demoImg} not present)`);
    }
  });

  console.log('\nAll preview-smoke checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
