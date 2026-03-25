#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { renderBodyHtmlFromString } = require('../src/renderer');
const { renderToTypstFromString } = require('../src/typst-renderer');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixture.md'), 'utf-8');
const SNAP_DIR = path.join(__dirname, 'snapshots');

const UPDATE = process.argv.includes('--update');

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function diffLines(expected, actual) {
    const a = expected.split('\n');
    const b = actual.split('\n');
    const lines = [];
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
        if (a[i] !== b[i]) {
            lines.push(`  line ${i + 1}:`);
            lines.push(`    expected: ${a[i] === undefined ? '(missing)' : JSON.stringify(a[i])}`);
            lines.push(`    actual:   ${b[i] === undefined ? '(missing)' : JSON.stringify(b[i])}`);
            if (lines.length > 30) {
                lines.push('  ... (truncated)');
                break;
            }
        }
    }
    return lines.join('\n');
}

// ── Test runner ──────────────────────────────────────────────────────────────

const tests = [
    {
        name: 'HTML renderer',
        run: () => renderBodyHtmlFromString(FIXTURE),
        snapFile: path.join(SNAP_DIR, 'fixture.html'),
    },
    {
        name: 'Typst renderer',
        run: () => renderToTypstFromString(FIXTURE),
        snapFile: path.join(SNAP_DIR, 'fixture.typ'),
    },
];

ensureDir(SNAP_DIR);

let passed = 0;
let failed = 0;
let created = 0;

for (const t of tests) {
    const actual = t.run();

    if (UPDATE || !fs.existsSync(t.snapFile)) {
        fs.writeFileSync(t.snapFile, actual, 'utf-8');
        console.log(`  \x1b[33m✎ ${t.name}\x1b[0m — snapshot ${fs.existsSync(t.snapFile) ? 'updated' : 'created'}: ${path.relative(process.cwd(), t.snapFile)}`);
        created++;
        continue;
    }

    const expected = fs.readFileSync(t.snapFile, 'utf-8');
    if (actual === expected) {
        console.log(`  \x1b[32m✓ ${t.name}\x1b[0m`);
        passed++;
    } else {
        console.log(`  \x1b[31m✗ ${t.name}\x1b[0m — snapshot mismatch`);
        console.log(diffLines(expected, actual));
        failed++;
    }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log();
if (created > 0) {
    console.log(`Snapshots created/updated: ${created}. Run \x1b[36mnpm test\x1b[0m again to verify.`);
}
if (failed > 0) {
    console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed.`);
    console.log(`If the changes are intentional, run: \x1b[36mnpm test -- --update\x1b[0m`);
    process.exit(1);
} else if (created === 0) {
    console.log(`\x1b[32mAll ${passed} tests passed.\x1b[0m`);
}
