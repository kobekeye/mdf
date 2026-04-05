'use strict';

const fs   = require('fs');
const MarkdownIt  = require('markdown-it');
const anchor      = require('markdown-it-anchor');
const container   = require('markdown-it-container');

// Unique markers that won't appear in normal markdown
const PAGEBREAK_MARKER = 'MDFPBMARKER';
const TOC_MARKER       = 'MDFTOCMARKER';

// ── markdown-it instance (NO texmath — math is passthrough) ──────────────────
const md = new MarkdownIt({ html: true, breaks: true })
    .use(anchor, {
        permalink: false,
        slugify: s => encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-')),
    });

// ── Callout containers ────────────────────────────────────────────────────────
const CALLOUT_NAMES = [
    { names: ['info',    'blue'],   typstType: 'info'    },
    { names: ['warning', 'orange'], typstType: 'warning' },
    { names: ['danger',  'red'],    typstType: 'danger'  },
    { names: ['success', 'green'],  typstType: 'success' },
];

for (const { names, typstType } of CALLOUT_NAMES) {
    for (const name of names) {
        md.use(container, name, {
            render(tokens, idx) {
                const token = tokens[idx];
                if (token.nesting === 1) {
                    const m = token.info.trim().match(new RegExp(`^${name}\\s+(.*)`));
                    const title = m ? m[1].trim() : '';
                    const titleArg = title ? `, title: [${title}]` : '';
                    return `#callout("${typstType}"${titleArg})[\n`;
                }
                return ']\n\n';
            },
        });
    }
}

// --- Alignment containers: :::center, :::right ---
const ALIGNMENTS = ['center', 'right'];
for (const align of ALIGNMENTS) {
    md.use(container, align, {
        render(tokens, idx) {
            return tokens[idx].nesting === 1
                ? `#align(${align})[\n`
                : ']\n\n';
        },
    });
}

md.use(container, 'spoiler', {
    render(tokens, idx) {
        const token = tokens[idx];
        if (token.nesting === 1) {
            const m = token.info.trim().match(/^spoiler\s+(.*)/);
            const title = m ? m[1].trim() : 'Spoiler';
            return `#spoiler([${title}])[\n`;
        }
        return ']\n\n';
    },
});

// ── Renderer state ────────────────────────────────────────────────────────────
// Stack tracks list types (false = bullet, true = ordered)
let _listStack = [];

// ── Suppress HTML fallback (renderToken generates HTML tags by default) ───────
md.renderer.renderToken = () => '';

// ── Custom rules ──────────────────────────────────────────────────────────────
const r = md.renderer.rules;

// Headings
r.heading_open  = (tokens, idx) => '='.repeat(parseInt(tokens[idx].tag.slice(1))) + ' ';
r.heading_close = () => '\n\n';

// Paragraphs — single newline inside lists to avoid breaking list parsing
r.paragraph_open  = () => '';
r.paragraph_close = () => (_listStack.length > 0 ? '\n' : '\n\n');

// Emphasis
r.strong_open  = () => '*';
r.strong_close = () => '*';
r.em_open      = () => '_';
r.em_close     = () => '_';

// Inline code
r.code_inline = (tokens, idx) => '`' + tokens[idx].content + '`';

// Fenced code block — Typst native syntax highlighting
r.fence = (tokens, idx) => {
    const lang = (tokens[idx].info || '').trim();
    return '```' + lang + '\n' + tokens[idx].content + '```\n\n';
};

// Indented code block
r.code_block = (tokens, idx) => '```\n' + tokens[idx].content + '```\n\n';

// Horizontal rule
r.hr = () => '#line(length: 100%)\n\n';

// Breaks
r.softbreak = () => '\n';
r.hardbreak = () => '\\\n';

// Strip HTML (not valid in Typst)
r.html_block  = () => '';
r.html_inline = () => '';

// Blockquote
r.blockquote_open  = () => '#quote[\n';
r.blockquote_close = () => ']\n\n';

// Lists
r.bullet_list_open   = () => { _listStack.push(false); return ''; };
r.bullet_list_close  = () => { _listStack.pop();        return '\n'; };
r.ordered_list_open  = () => { _listStack.push(true);  return ''; };
r.ordered_list_close = () => { _listStack.pop();        return '\n'; };

r.list_item_open = () => {
    const depth     = _listStack.length - 1;
    const isOrdered = _listStack[depth];
    return '  '.repeat(depth) + (isOrdered ? '+' : '-') + ' ';
};
r.list_item_close = () => '\n';

// Image
r.image = (tokens, idx) => {
    const src = tokens[idx].attrGet('src') || '';
    const alt = tokens[idx].content || '';
    return `#image("${src}"${alt ? `, alt: "${alt}"` : ''})`;
};

// Link
r.link_open  = (tokens, idx) => `#link("${tokens[idx].attrGet('href') || ''}")[`;
r.link_close = () => ']';

// Plain text — output as-is (enables $math$ and #typst-function passthrough)
r.text = (tokens, idx) => {
    const c = tokens[idx].content;
    if (c === PAGEBREAK_MARKER) return '#pagebreak()';
    if (c === TOC_MARKER)       return '#outline()';
    return c;
};

// ── Table ─────────────────────────────────────────────────────────────────────
function countFirstRowCells(tokens, startIdx) {
    let count = 0;
    for (let i = startIdx; i < tokens.length; i++) {
        const type = tokens[i].type;
        if (type === 'tr_close') break;
        if (type === 'th_open' || type === 'td_open') count++;
    }
    return count;
}

r.table_open  = (tokens, idx) => `#table(\n  columns: ${countFirstRowCells(tokens, idx + 1)},\n`;
r.table_close = () => ')\n\n';
r.thead_open  = r.thead_close = r.tbody_open = r.tbody_close = () => '';
r.tr_open     = () => '';
r.tr_close    = () => '';
r.th_open     = r.td_open  = () => '  [';
r.th_close    = r.td_close = () => '],\n';

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Convert a Markdown file to a Typst string.
 * Math ($...$, $$...$$) and Typst functions (#set, #rect, …) pass through as-is.
 * @param {string} mdPath - absolute or relative path to the .md file
 * @returns {string} Typst markup (does NOT include the template preamble)
 */
function renderToTypst(mdPath) {
    return renderToTypstFromString(fs.readFileSync(mdPath, 'utf-8'));
}

/**
 * Convert a Markdown string to a Typst string (for in-memory use, e.g. VSCode extension).
 * @param {string} content - Markdown source string
 * @returns {string} Typst markup (does NOT include the template preamble)
 */
function renderToTypstFromString(content) {
    _listStack = []; // reset state

    // Task lists: convert before parsing (non-interactive unicode checkboxes)
    content = content.replace(/^(\s*)-\s+\[ \]/gm,  '$1- ☐');
    content = content.replace(/^(\s*)-\s+\[x\]/gim, '$1- ☑');

    // Page break and TOC markers — ensure blank lines around them so
    // markdown-it doesn't absorb them into a preceding table / list.
    content = content.replace(/^==page==$/gm,  '\n' + PAGEBREAK_MARKER + '\n');
    content = content.replace(/^\[TOC\]$/gim,  '\n' + TOC_MARKER + '\n');

    return md.render(content);
}

module.exports = { renderToTypst, renderToTypstFromString };
