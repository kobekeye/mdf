'use strict';

const fs   = require('fs');
const MarkdownIt  = require('markdown-it');
const anchor      = require('markdown-it-anchor');
const container   = require('markdown-it-container');
const { default: githubAlerts } = require('markdown-it-github-alerts');
const hljs = require('highlight.js');
const { replaceOutsideCodeBlocks } = require('./preprocess');

// Unique markers that won't appear in normal markdown
const PAGEBREAK_MARKER = 'MDFPBMARKER';
const TOC_MARKER       = 'MDFTOCMARKER';

function escapeTypstString(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function decodeHtmlEntities(value) {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&#x27;/g, '\'')
        .replace(/&amp;/g, '&');
}

function textToTypst(text) {
    let out = '';
    let buffer = '';

    const flush = () => {
        if (buffer.length > 0) {
            out += `#text("${escapeTypstString(buffer)}")`;
            buffer = '';
        }
    };

    for (const ch of String(text).replace(/\r\n?/g, '\n')) {
        if (ch === '\n') {
            flush();
            out += '#linebreak()';
        } else {
            buffer += ch;
        }
    }

    flush();
    return out;
}

function resolveHljsKind(classNames) {
    const classes = new Set(
        classNames
            .split(/\s+/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(s => s.replace(/^hljs-/, ''))
    );

    if (classes.size === 0) return null;
    if (classes.has('addition')) return 'addition';
    if (classes.has('deletion')) return 'deletion';
    if (classes.has('section')) return 'section';
    if (classes.has('bullet')) return 'bullet';
    if (classes.has('emphasis')) return 'emphasis';
    if (classes.has('strong')) return 'strong';
    if (classes.has('variable') && classes.has('language_')) return 'keyword';
    if (
        classes.has('doctag') ||
        classes.has('keyword') ||
        classes.has('template-tag') ||
        classes.has('template-variable') ||
        classes.has('type')
    ) return 'keyword';
    if (classes.has('title')) return 'title';
    if (
        classes.has('attr') ||
        classes.has('attribute') ||
        classes.has('literal') ||
        classes.has('meta') ||
        classes.has('number') ||
        classes.has('operator') ||
        classes.has('variable') ||
        classes.has('selector-attr') ||
        classes.has('selector-class') ||
        classes.has('selector-id')
    ) return 'constant';
    if (classes.has('regexp') || classes.has('string')) return 'string';
    if (classes.has('built_in') || classes.has('symbol')) return 'variable';
    if (classes.has('comment') || classes.has('code') || classes.has('formula')) return 'comment';
    if (classes.has('name') || classes.has('quote') || classes.has('selector-tag') || classes.has('selector-pseudo')) {
        return 'tag';
    }
    return null;
}

function parseHljsHtml(html) {
    const root = { kind: null, children: [] };
    const stack = [root];
    let i = 0;

    while (i < html.length) {
        if (html.startsWith('<span class="', i)) {
            const classStart = i + '<span class="'.length;
            const classEnd = html.indexOf('">', classStart);
            if (classEnd === -1) break;

            const node = {
                kind: resolveHljsKind(html.slice(classStart, classEnd)),
                children: [],
            };
            stack[stack.length - 1].children.push(node);
            stack.push(node);
            i = classEnd + 2;
            continue;
        }

        if (html.startsWith('</span>', i)) {
            if (stack.length > 1) stack.pop();
            i += '</span>'.length;
            continue;
        }

        const nextTag = html.indexOf('<', i);
        const end = nextTag === -1 ? html.length : nextTag;
        const text = decodeHtmlEntities(html.slice(i, end));
        if (text.length > 0) stack[stack.length - 1].children.push({ text });
        i = end;
    }

    return root.children;
}

function renderHljsNodesToTypst(nodes) {
    let out = '';

    for (const node of nodes) {
        if (Object.prototype.hasOwnProperty.call(node, 'text')) {
            out += textToTypst(node.text);
            continue;
        }

        const body = renderHljsNodesToTypst(node.children);
        out += node.kind ? `#mdf-code-token("${node.kind}")[${body}]` : body;
    }

    return out;
}

function renderCodeBlockToTypst(content, info = '') {
    const lang = String(info).trim().split(/\s+/)[0] || '';
    const langArg = lang ? `"${escapeTypstString(lang)}"` : 'none';

    let body = textToTypst(content);
    if (lang && hljs.getLanguage(lang)) {
        try {
            const highlighted = hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
            body = renderHljsNodesToTypst(parseHljsHtml(highlighted));
        } catch (_) {
            // Fall back to plain text when highlight.js rejects the snippet.
        }
    }

    return `#mdf-code-block(lang: ${langArg})[${body}]\n\n`;
}

// ── markdown-it instance (NO texmath — math is passthrough) ──────────────────
const md = new MarkdownIt({ html: true, breaks: true })
    .use(anchor, {
        permalink: false,
        slugify: s => encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-')),
    })
    .use(githubAlerts, { icons: {} });

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

// --- Alignment containers: :::center, :::right :::left ---
const ALIGNMENTS = ['center', 'right', 'left'];
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
r.heading_open = (tokens, idx) => {
    const prefix = '='.repeat(parseInt(tokens[idx].tag.slice(1))) + ' ';
    // Reduce gap between consecutive headings (like CSS h1+h2 { margin-top: 0.6em })
    if (idx > 0 && tokens[idx - 1].type === 'heading_close') {
        return '#v(-1.4em)\n' + prefix;
    }
    return prefix;
};
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

// Fenced code block — highlight.js token colors mapped into Typst spans
r.fence = (tokens, idx) => renderCodeBlockToTypst(tokens[idx].content, tokens[idx].info || '');

// Indented code block
r.code_block = (tokens, idx) => renderCodeBlockToTypst(tokens[idx].content);

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

// GitHub-style alerts (tokens rewritten by markdown-it-github-alerts)
r.alert_open = (tokens, idx) => {
    const { type, title } = tokens[idx].meta;
    const defaultTitles = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
    const isCustom = title && title !== defaultTitles[type];
    const titleArg = isCustom ? `, title: [${title}]` : '';
    return `#gh-alert("${type}"${titleArg})[\n`;
};
r.alert_close = () => ']\n\n';

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
    if (c === TOC_MARKER)       return '#outline(title: none)';
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
    content = replaceOutsideCodeBlocks(content, (text) => {
        text = text.replace(/^==page==$/gm,  '\n' + PAGEBREAK_MARKER + '\n');
        text = text.replace(/^\[TOC\]$/gim,  '\n' + TOC_MARKER + '\n');
        return text;
    });

    return md.render(content);
}

module.exports = { renderToTypst, renderToTypstFromString };
