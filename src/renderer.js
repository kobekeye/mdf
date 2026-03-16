const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const texmath = require('markdown-it-texmath');
const katex = require('katex');
const hljs = require('highlight.js');
const anchor = require('markdown-it-anchor');
const taskLists = require('markdown-it-task-lists');
const container = require('markdown-it-container');
// const md = new MarkdownIt({
//     html: true,
//     highlight: function (str, lang) {
//         if (lang && hljs.getLanguage(lang)) {
//             try {
//                 return '<pre class="hljs"><code>' +
//                     hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
//                     '</code></pre>';
//             } catch (_) { }
//         }
//         return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
//     }
// });
const md = new MarkdownIt({
    html: true,
    highlight: (str, lang) => {
        const wrap = (content) => `<pre class="hljs"><code>${content}</code></pre>`;
        if (lang && hljs.getLanguage(lang)) {
            try {
                return wrap(hljs.highlight(str, { language: lang, ignoreIllegals: true }).value);
            } catch (_) { }
        }
        return wrap(md.utils.escapeHtml(str));
    }
})
    .use(texmath, {
        engine: katex,
        delimiters: 'dollars',
        // maybe can add some katexoptions later on.
    })
    .use(anchor, {
        permalink: false,
        // e.g. hello world 你好 -> hello-world-%E4%BD%A0%E5%A5%BD(你好)
        slugify: (s) => encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-')),
    })
    .use(taskLists, { enabled: true });
// --- Container blocks: :::info, :::warning, :::danger, :::success, :::spoiler ---
// Color aliases: :::blue = :::info, :::orange = :::warning, etc.
const CONTAINERS = [
    { names: ['info', 'blue'], type: 'callout', cssClass: 'info' },
    { names: ['warning', 'orange'], type: 'callout', cssClass: 'warning' },
    { names: ['danger', 'red'], type: 'callout', cssClass: 'danger' },
    { names: ['success', 'green'], type: 'callout', cssClass: 'success' },
    { names: ['spoiler'], type: 'spoiler' } // different type
];

for (const { names, type, cssClass } of CONTAINERS) {
    for (const name of names) {
        md.use(container, name, {
            render: function (tokens, idx) {
                const token = tokens[idx];
                if (token.nesting === 1) {
                    const titleMatch = token.info.trim().match(new RegExp(`^${name}\\s+(.*)$`));
                    const title = titleMatch ? titleMatch[1].trim() : '';

                    // decide the HTML structure based on type
                    if (type === 'spoiler') {
                        const summary = title || 'Spoiler';
                        return `<details class="callout-spoiler">\n<summary>${md.utils.escapeHtml(summary)}</summary>\n`;
                    } else { // 'callout'
                        const titleHtml = title ? `<p class="callout-title">${md.utils.escapeHtml(title)}</p>\n` : '';
                        return `<div class="callout callout-${cssClass}">\n${titleHtml}`;
                    }
                }
                // ending tag
                return type === 'spoiler' ? '</details>\n' : '</div>\n';
            },
        });
    }
}
// Unique HTML comment used as TOC marker (survives markdown-it rendering)
const TOC_MARKER = '<!--TOC_PLACEHOLDER-->';
// Regex to match [TOC] on its own line in raw Markdown
const TOC_MD_REGEX = /^\[TOC\]$/gmi;
/**
 * Generate a table of contents HTML from rendered HTML headings
 * @param {string} html - rendered HTML string
 * @returns {string} TOC HTML string
 */
function generateTOC(html) {
    const headingRegex = /<h([1-6])\s+id="([^"]*)"[^>]*>(.*?)<\/h[1-6]>/gi;
    const headings = [];
    let match;
    while ((match = headingRegex.exec(html)) !== null) {
        headings.push({
            level: parseInt(match[1]),
            id: match[2],
            text: match[3].replace(/<[^>]+>/g, ''), // strip inner HTML tags
        });
    }
    if (headings.length === 0) return '';
    // find the minimum heading level to use as base
    const minLevel = Math.min(...headings.map(h => h.level));
    let tocHtml = '<nav class="toc">\n<p class="toc-title">Contents</p>\n<ul>\n';
    let currentLevel = minLevel;
    let isFirst = true;
    for (const heading of headings) {
        const level = heading.level;
        if (level > currentLevel) {
            // go deeper: open nested <ul>
            for (let i = currentLevel; i < level; i++) {
                tocHtml += '<ul>\n';
            }
        } else if (level < currentLevel) {
            // go up: close nested <ul>
            for (let i = currentLevel; i > level; i--) {
                tocHtml += '</ul>\n</li>\n';
            }
        } else if (!isFirst) {
            // same level, close previous <li>
            tocHtml += '</li>\n';
        }
        tocHtml += `<li><a href="#${heading.id}">${heading.text}</a>\n`;
        currentLevel = level;
        isFirst = false;
    }
    // close remaining open tags
    for (let i = currentLevel; i >= minLevel; i--) {
        tocHtml += '</li>\n</ul>\n';
    }
    tocHtml += '</nav>';
    return tocHtml;
}
/**
 * Replace [TOC] in raw Markdown with a unique marker before rendering
 * @param {string} markdown - raw Markdown string
 * @returns {string} Markdown with [TOC] replaced by marker
 */
function preprocessTOC(markdown) {
    return markdown.replace(TOC_MD_REGEX, TOC_MARKER);
}
/**
 * Replace TOC marker in rendered HTML with the actual generated TOC
 * @param {string} html - rendered HTML string
 * @returns {string} HTML with TOC inserted
 */
function processTOC(html) {
    if (!html.includes(TOC_MARKER)) return html;
    const toc = generateTOC(html);
    return html.replace(TOC_MARKER, toc);
}
// CSS file paths
const root = path.join(__dirname, '..');
const themePath = path.join(root, 'themes', 'default.css');
const hljsCssPath = path.join(root, 'node_modules', 'highlight.js', 'styles', 'github-dark.css');
const texmathCssPath = path.join(root, 'node_modules', 'markdown-it-texmath', 'css', 'texmath.css');
// KaTeX CSS is referenced as a local file:// URL so its bundled fonts resolve correctly
const katexCssUrl = `file://${path.join(__dirname, 'node_modules', 'katex', 'dist', 'katex.min.css')}`;
// CSS cache: read once, avoid I/O on every render
let cachedThemeCSS = null;
let cachedHljsCSS = null;
let cachedTexmathCSS = null;
function loadCSS() {
    if (!cachedThemeCSS) {
        cachedThemeCSS = fs.readFileSync(themePath, 'utf-8');
        cachedHljsCSS = fs.readFileSync(hljsCssPath, 'utf-8');
        cachedTexmathCSS = fs.readFileSync(texmathCssPath, 'utf-8');
    }
    return { themeCSS: cachedThemeCSS, hljsCSS: cachedHljsCSS, texmathCSS: cachedTexmathCSS };
}
/**
 * render only Markdown body HTML (without <head>, CSS, etc.) for SSE real-time update, avoid full page reload
 * @param {string} markdownFilePath - Markdown file path
 * @returns {string} rendered HTML body content
 */
function renderBodyHtml(markdownFilePath) {
    let content = fs.readFileSync(markdownFilePath, 'utf-8');
    content = content.replace(/^==page==$/gm, '\n<div class="page-break"></div>\n');
    content = preprocessTOC(content);
    let html = md.render(content);
    html = processTOC(html);
    return html;
}
/**
 * render Markdown file to complete HTML string (including CSS)
 * @param {string} markdownFilePath - Markdown file path
 * @param {object} [options] - options
 * @param {string} [options.extraHeadHtml] - extra HTML to inject into <head>
 * @param {string} [options.extraBodyHtml] - extra HTML to inject at the end of <body>
 * @param {string} [options.contentWrapperId] - if provided, wrap content in a div with this ID (for SSE real-time update)
 * @returns {string} complete HTML string
 */
function renderToHtml(markdownFilePath, options = {}) {
    let markdownContent = fs.readFileSync(markdownFilePath, 'utf-8');
    markdownContent = markdownContent.replace(/^==page==$/gm, '\n<div class="page-break"></div>\n');
    markdownContent = preprocessTOC(markdownContent);
    const { themeCSS, hljsCSS, texmathCSS } = loadCSS();
    let bodyHtml = md.render(markdownContent);
    bodyHtml = processTOC(bodyHtml);
    // if contentWrapperId is provided, wrap content in a div for SSE real-time update
    if (options.contentWrapperId) {
        bodyHtml = `<div id="${options.contentWrapperId}">${bodyHtml}</div>`;
    }
    const extraHead = options.extraHeadHtml || '';
    const extraBody = options.extraBodyHtml || '';
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="${katexCssUrl}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Noto+Sans+TC:wght@400;700&display=swap" rel="stylesheet">
    <style>${texmathCSS} ${hljsCSS} ${themeCSS}</style>
    ${extraHead}
</head>
<body>
    ${bodyHtml}
    ${extraBody}
</body>
</html>`;
}
module.exports = { renderToHtml, renderBodyHtml };