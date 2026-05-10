#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { parseFontMeta, generateFontFaceCSS, getFontCacheDir } = require('../src/font-manager');
const { renderToTypstFromString } = require('../src/typst-renderer');

let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
    if (condition) {
        console.log(`  \x1b[32m✓ ${name}\x1b[0m`);
        passed++;
    } else {
        console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

// ── parseFontMeta ───────────────────────────────────────────────────────────

console.log('\nparseFontMeta:');

{
    const css = '/* @mdf-fonts: Inter:400,700; Noto Sans TC:400,700 */';
    const result = parseFontMeta(css);
    assert('parses CSS comment format', result.length === 2);
    assert('first family is Inter', result[0]?.family === 'Inter');
    assert('Inter weights', JSON.stringify(result[0]?.weights) === '[400,700]');
    assert('second family is Noto Sans TC', result[1]?.family === 'Noto Sans TC');
}

{
    const typ = '// @mdf-fonts: Inter:400,700';
    const result = parseFontMeta(typ);
    assert('parses Typst comment format', result.length === 1);
    assert('Typst: family is Inter', result[0]?.family === 'Inter');
}

{
    const typ = '// @mdf-fonts: Inter:400,400i,700i';
    const result = parseFontMeta(typ);
    assert('parses italic font variants', JSON.stringify(result[0]?.variants) === JSON.stringify([
        { weight: 400, style: 'normal' },
        { weight: 400, style: 'italic' },
        { weight: 700, style: 'italic' },
    ]), `got: ${JSON.stringify(result[0]?.variants)}`);
}

{
    const noMeta = '/* just a normal comment */\nbody { color: red; }';
    const result = parseFontMeta(noMeta);
    assert('returns empty for no @mdf-fonts', result.length === 0);
}

// ── getFontCacheDir ─────────────────────────────────────────────────────────

console.log('\ngetFontCacheDir:');

{
    const dir = getFontCacheDir();
    const expected = path.join(os.homedir(), '.mdf', 'fonts');
    assert('returns ~/.mdf/fonts with correct path separators', dir === expected);
    assert('uses platform path separator', dir.includes(path.sep));
}

// ── generateFontFaceCSS ────────────────────────────────────────────────────

console.log('\ngenerateFontFaceCSS:');

{
    const result = generateFontFaceCSS([]);
    assert('empty specs returns empty string', result === '');
}

{
    const result = generateFontFaceCSS(null);
    assert('null specs returns empty string', result === '');
}

{
    // Test that file:// URLs use forward slashes (important for Puppeteer on Windows)
    const specs = [{ family: 'Inter', weights: [400], variants: [{ weight: 400, style: 'normal' }] }];
    const cacheDir = getFontCacheDir();
    const testFile = path.join(cacheDir, 'Inter-400.ttf');

    // Create a dummy font file to test URL generation
    fs.mkdirSync(cacheDir, { recursive: true });
    const existed = fs.existsSync(testFile);
    if (!existed) fs.writeFileSync(testFile, 'dummy');

    const css = generateFontFaceCSS(specs);
    const urlMatch = css.match(/url\('([^']+)'\)/);

    if (urlMatch) {
        const fileUrl = urlMatch[1];
        assert('file:// URL has no backslashes', !fileUrl.includes('\\'),
            `got: ${fileUrl}`);
        assert('file:// URL starts with file://', fileUrl.startsWith('file://'));
    } else {
        assert('generates @font-face with url()', false, 'no url() found in output');
    }

    // Clean up dummy file only if we created it
    if (!existed) fs.unlinkSync(testFile);
}

// ── renderToTypstFromString ─────────────────────────────────────────────────

console.log('\nrenderToTypstFromString:');

{
    const result = renderToTypstFromString('1. (a)\n    (b)\n');
    assert('keeps continued lines inside ordered list items',
        result.includes('+ (a)\\\n  (b)'),
        `got: ${JSON.stringify(result)}`);
}

{
    const result = renderToTypstFromString('abc*hihi*def\n');
    assert('renders emphasis with Typst function form inside words',
        result.includes('abc#emph[hihi]def'),
        `got: ${JSON.stringify(result)}`);
}

{
    const result = renderToTypstFromString('| Name | Age |\n|---|---|\n| A | 1 |\n');
    assert('preserves markdown table headers as Typst table.header',
        result.includes('table.header(') && result.includes('[Name]') && result.includes('[Age]'),
        `got: ${JSON.stringify(result)}`);
}

{
    const result = renderToTypstFromString('| Left | Center | Right |\n| :--- | :----: | ---: |\n| a | b | c |\n');
    assert('maps markdown table alignment to Typst table align tuple',
        result.includes('align: (left, center, right)'),
        `got: ${JSON.stringify(result)}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log();
if (failed > 0) {
    console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed.`);
    process.exit(1);
} else {
    console.log(`\x1b[32mAll ${passed} unit tests passed.\x1b[0m`);
}
