'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

function getFontCacheDir() {
    return path.join(os.homedir(), '.mdf', 'fonts');
}

/**
 * Parse @mdf-fonts metadata from theme file content
 * Supports both CSS comment format: /* @mdf-fonts: ... *\/
 * and Typst comment format:          // @mdf-fonts: ...
 * @param {string} content
 * @returns {Array<{family: string, weights: number[]}>}
 */
function parseFontMeta(content) {
    const match = content.match(/(?:\/\*|\/\/)\s*@mdf-fonts:\s*([^*\n]+?)(?:\s*\*\/)?$/m);
    if (!match) return [];
    return match[1].trim().split(';').map(s => s.trim()).filter(Boolean).map(spec => {
        const colonIdx = spec.lastIndexOf(':');
        if (colonIdx === -1) return null;
        const family = spec.slice(0, colonIdx).trim();
        const weights = spec.slice(colonIdx + 1).split(',')
            .map(w => parseInt(w.trim()))
            .filter(w => !isNaN(w));
        if (!family || weights.length === 0) return null;
        return { family, weights };
    }).filter(Boolean);
}

/**
 * Download a URL to destPath, returns a Promise
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, { headers: { 'User-Agent': 'Mozilla/4.0' } }, (res) => {
            if (res.statusCode !== 200) {
                file.close(() => fs.unlink(destPath, () => {}));
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
        }).on('error', (err) => { file.close(() => {}); reject(err); });
    });
}

/**
 * Fetch Google Fonts CSS2 with old UA (forces TTF), parse @font-face blocks,
 * return a map of { weight: ttfUrl }
 */
function fetchFontUrls(family, weights) {
    const familyParam = `${family.replace(/ /g, '+')}:wght@${weights.join(';')}`;
    const url = `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`;
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/4.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                const result = {};
                const fontFaceRe = /@font-face\s*\{([^}]+)\}/gi;
                let m;
                while ((m = fontFaceRe.exec(data)) !== null) {
                    const block = m[1];
                    const wm = block.match(/font-weight:\s*(\d+)/);
                    const um = block.match(/url\((['"]?)([^'")\s]+\.ttf)\1\)/i);
                    if (wm && um) {
                        const w = parseInt(wm[1]);
                        if (!result[w]) result[w] = um[2]; // keep first URL per weight
                    }
                }
                resolve(result);
            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Ensure all fonts in fontSpecs are downloaded to ~/.mdf/fonts/
 * Prints progress; failures are warnings only (non-fatal)
 * @param {Array<{family: string, weights: number[]}>} fontSpecs
 * @param {string} [themeName]
 */
async function ensureFonts(fontSpecs, themeName) {
    if (!fontSpecs || fontSpecs.length === 0) return;

    const cacheDir = getFontCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });

    // Collect missing family+weight pairs
    const missing = [];
    for (const { family, weights } of fontSpecs) {
        const key = family.replace(/ /g, '');
        for (const weight of weights) {
            const filename = `${key}-${weight}.ttf`;
            if (!fs.existsSync(path.join(cacheDir, filename))) {
                missing.push({ family, weight, key, filename });
            }
        }
    }
    if (missing.length === 0) return;

    const label = themeName ? `'${themeName}'` : 'current';
    const fontNames = [...new Set(missing.map(m => m.family))].join(', ');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
        rl.question(`\x1b[36mTo use ${label} theme, install fonts: ${fontNames}? [Y/n] \x1b[0m`, resolve);
    });
    rl.close();

    const a = answer.trim().toLowerCase();
    if (a !== '' && a !== 'y' && a !== 'yes') {
        console.log('Skipped font installation.');
        return;
    }

    console.log(`\x1b[36mDownloading fonts...\x1b[0m`);

    // Group by family to minimise API calls
    const byFamily = {};
    for (const item of missing) {
        (byFamily[item.family] = byFamily[item.family] || []).push(item);
    }

    for (const [family, items] of Object.entries(byFamily)) {
        let urlMap;
        try {
            urlMap = await fetchFontUrls(family, items.map(i => i.weight));
        } catch (err) {
            console.warn(`\x1b[33mWarning: could not fetch font info for '${family}': ${err.message}\x1b[0m`);
            continue;
        }

        for (const { weight, filename } of items) {
            const ttfUrl = urlMap[weight];
            if (!ttfUrl) {
                console.warn(`\x1b[33mWarning: no TTF URL for '${family}' weight ${weight}\x1b[0m`);
                continue;
            }
            process.stdout.write(`  ${filename}... `);
            try {
                await downloadFile(ttfUrl, path.join(cacheDir, filename));
                process.stdout.write('\x1b[32mok\x1b[0m\n');
            } catch (err) {
                process.stdout.write('\x1b[31mfailed\x1b[0m\n');
                console.warn(`\x1b[33mWarning: ${err.message}\x1b[0m`);
            }
        }
    }
}

/**
 * Generate @font-face CSS for all cached fonts in fontSpecs
 * Skips entries where the local file doesn't exist (download may have failed)
 * @param {Array<{family: string, weights: number[]}>} fontSpecs
 * @returns {string}
 */
function generateFontFaceCSS(fontSpecs) {
    if (!fontSpecs || fontSpecs.length === 0) return '';
    const cacheDir = getFontCacheDir();
    const blocks = [];
    for (const { family, weights } of fontSpecs) {
        const key = family.replace(/ /g, '');
        for (const weight of weights) {
            const filePath = path.join(cacheDir, `${key}-${weight}.ttf`);
            if (fs.existsSync(filePath)) {
                const fileUrl = 'file://' + filePath.split(path.sep).join('/');
                blocks.push(
                    `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: normal; src: url('${fileUrl}') format('truetype'); }`
                );
            }
        }
    }
    return blocks.join('\n');
}

module.exports = { parseFontMeta, ensureFonts, generateFontFaceCSS, getFontCacheDir };
