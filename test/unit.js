#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { parseFontMeta, generateFontFaceCSS, getFontCacheDir } = require('../src/font-manager');

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
    const specs = [{ family: 'Inter', weights: [400] }];
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

// ── Summary ─────────────────────────────────────────────────────────────────

console.log();
if (failed > 0) {
    console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed.`);
    process.exit(1);
} else {
    console.log(`\x1b[32mAll ${passed} unit tests passed.\x1b[0m`);
}
