const esbuild = require('esbuild');
const { cpSync, mkdirSync } = require('fs');
const path = require('path');

const mdfRoot = path.join(__dirname, '..');

// Bundle extension + renderers into a single file
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
  bundle: true,
  outfile: path.join(__dirname, 'out', 'extension.js'),
  external: ['vscode', '@myriaddreamin/*'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  tsconfig: path.join(__dirname, 'tsconfig.json'),
});

// Copy CSS assets + fonts into the extension
const assetsDir = path.join(__dirname, 'out', 'assets');
mkdirSync(assetsDir, { recursive: true });

cpSync(path.join(mdfRoot, 'node_modules/katex/dist/katex.min.css'), path.join(assetsDir, 'katex.min.css'));
cpSync(path.join(mdfRoot, 'node_modules/katex/dist/fonts'), path.join(assetsDir, 'fonts'), { recursive: true });
cpSync(path.join(mdfRoot, 'node_modules/highlight.js/styles/github-dark.css'), path.join(assetsDir, 'github-dark.css'));
cpSync(path.join(mdfRoot, 'node_modules/markdown-it-texmath/css/texmath.css'), path.join(assetsDir, 'texmath.css'));
cpSync(path.join(mdfRoot, 'themes/default.css'), path.join(assetsDir, 'default.css'));
cpSync(path.join(mdfRoot, 'themes/default.typ'), path.join(assetsDir, 'default.typ'));

console.log('Build complete.');
