import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import anchor from 'markdown-it-anchor';
import containerModule from 'markdown-it-container';
import githubAlertsModule from 'markdown-it-github-alerts';
import { replaceOutsideCodeBlocks } from './previewRenderer';

const container = containerModule as (
  md: MarkdownIt,
  name: string,
  opts?: { render?: (tokens: unknown[], idx: number) => string },
) => void;
const githubAlerts = (
  (githubAlertsModule as { default?: unknown }).default ?? githubAlertsModule
) as (md: MarkdownIt, opts?: unknown) => void;

const PAGEBREAK_MARKER = 'MDFPBMARKER';
const TOC_MARKER = 'MDFTOCMARKER';

const HLJS_KIND_PRIORITY = new Map([
  ['addition', 0],
  ['deletion', 1],
  ['bullet', 2],
  ['emphasis', 3],
  ['strong', 4],
  ['comment', 5],
  ['keyword', 6],
  ['tag', 7],
  ['operator', 8],
  ['string', 9],
  ['regexp', 10],
  ['constant', 11],
  ['type', 12],
  ['title', 13],
  ['property', 14],
  ['variable', 15],
]);

const HLJS_CLASS_TO_KIND = new Map([
  ['addition', 'addition'],
  ['deletion', 'deletion'],
  ['bullet', 'bullet'],
  ['emphasis', 'emphasis'],
  ['strong', 'strong'],
  ['comment', 'comment'],
  ['quote', 'comment'],
  ['code', 'comment'],
  ['formula', 'comment'],
  ['keyword', 'keyword'],
  ['selector-tag', 'keyword'],
  ['built_in', 'tag'],
  ['name', 'tag'],
  ['tag', 'tag'],
  ['operator', 'operator'],
  ['punctuation', 'operator'],
  ['string', 'string'],
  ['doctag', 'string'],
  ['selector-attr', 'string'],
  ['selector-pseudo', 'string'],
  ['template-tag', 'string'],
  ['regexp', 'regexp'],
  ['number', 'constant'],
  ['literal', 'constant'],
  ['template-variable', 'deletion'],
  ['type', 'type'],
  ['class', 'type'],
  ['title', 'title'],
  ['section', 'title'],
  ['attr', 'property'],
  ['attribute', 'property'],
  ['property', 'property'],
  ['symbol', 'bullet'],
  ['meta', 'bullet'],
  ['link', 'bullet'],
  ['subst', 'variable'],
  ['variable', 'variable'],
  ['params', 'variable'],
]);

type HljsNode = { text: string } | { kind: string | null; children: HljsNode[] };
type MarkdownToken = {
  attrGet(name: string): string | null;
  content: string;
  info: string;
  meta?: { type?: string; title?: string };
  nesting: number;
  tag: string;
  type: string;
};


function escapeTypstString(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function decodeHtmlEntities(value: string): string {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

function textToTypst(text: string): string {
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

function resolveHljsKind(classNames: string): string | null {
  let bestKind: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const rawClass of String(classNames).split(/\s+/)) {
    const cls = rawClass.trim().replace(/^hljs-/, '');
    if (!cls) {
      continue;
    }

    const kind = HLJS_CLASS_TO_KIND.get(cls);
    if (!kind) {
      continue;
    }

    const rank = HLJS_KIND_PRIORITY.get(kind);
    if (rank !== undefined && rank < bestRank) {
      bestKind = kind;
      bestRank = rank;
    }
  }

  return bestKind;
}

function parseHljsHtml(html: string): HljsNode[] {
  const root: { kind: null; children: HljsNode[] } = { kind: null, children: [] };
  const stack: Array<{ kind: string | null; children: HljsNode[] }> = [root];
  let i = 0;

  while (i < html.length) {
    if (html.startsWith('<span class="', i)) {
      const classStart = i + '<span class="'.length;
      const classEnd = html.indexOf('">', classStart);
      if (classEnd === -1) {
        break;
      }

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
      if (stack.length > 1) {
        stack.pop();
      }
      i += '</span>'.length;
      continue;
    }

    const nextTag = html.indexOf('<', i);
    const end = nextTag === -1 ? html.length : nextTag;
    const text = decodeHtmlEntities(html.slice(i, end));
    if (text.length > 0) {
      stack[stack.length - 1].children.push({ text });
    }
    i = end;
  }

  return root.children;
}

function renderHljsNodesToTypst(nodes: HljsNode[]): string {
  let out = '';

  for (const node of nodes) {
    if ('text' in node) {
      out += textToTypst(node.text);
      continue;
    }

    const body = renderHljsNodesToTypst(node.children);
    if (body.length === 0) {
      continue;
    }
    out += node.kind ? `#mdf-code-token("${node.kind}")[${body}]` : body;
  }

  return out;
}

function renderCodeBlockToTypst(content: string, info = ''): string {
  const lang = String(info).trim().split(/\s+/)[0] || '';
  const langArg = lang ? `"${escapeTypstString(lang)}"` : 'none';

  let body = textToTypst(content);
  if (lang && hljs.getLanguage(lang)) {
    try {
      const highlighted = hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
      body = renderHljsNodesToTypst(parseHljsHtml(highlighted));
    } catch {
      // Plain text fallback keeps the preview available for uncommon snippets.
    }
  }

  return `#mdf-code-block(lang: ${langArg})[${body}]\n\n`;
}

const md = new MarkdownIt({ html: true, breaks: true })
  .use(anchor, {
    permalink: false,
    slugify: (value: string) => encodeURIComponent(String(value).trim().toLowerCase().replace(/\s+/g, '-')),
  })
  .use(githubAlerts, { icons: {} })

const callouts = [
  { names: ['info', 'blue'], typstType: 'info' },
  { names: ['warning', 'orange'], typstType: 'warning' },
  { names: ['danger', 'red'], typstType: 'danger' },
  { names: ['success', 'green'], typstType: 'success' },
];

for (const { names, typstType } of callouts) {
  for (const name of names) {
    md.use(container, name, {
      render(tokens: Array<{ nesting: number; info: string }>, idx: number) {
        const token = tokens[idx];
        if (token.nesting === 1) {
          const match = token.info.trim().match(new RegExp(`^${name}\\s+(.*)`));
          const title = match ? match[1].trim() : '';
          const titleArg = title ? `, title: [${title}]` : '';
          return `#callout("${typstType}"${titleArg})[\n`;
        }
        return ']\n\n';
      },
    });
  }
}

for (const align of ['center', 'right', 'left'] as const) {
  md.use(container, align, {
    render(tokens: Array<{ nesting: number }>, idx: number) {
      return tokens[idx].nesting === 1 ? `#align(${align})[\n` : ']\n\n';
    },
  });
}

md.use(container, 'spoiler', {
  render(tokens: Array<{ nesting: number; info: string }>, idx: number) {
    const token = tokens[idx];
    if (token.nesting === 1) {
      const match = token.info.trim().match(/^spoiler\s+(.*)/);
      const title = match ? match[1].trim() : 'Spoiler';
      return `#spoiler([${title}])[\n`;
    }
    return ']\n\n';
  },
});

let listStack: boolean[] = [];

function listContinuationIndent(): string {
  return listStack.length > 0 ? '  '.repeat(listStack.length) : '';
}


md.renderer.renderToken = () => '';
const rules = md.renderer.rules;

rules.heading_open = (tokens, idx) => {
  const token = tokens[idx] as MarkdownToken;
  const prefix = '='.repeat(Number.parseInt(token.tag.slice(1), 10)) + ' ';
  return idx > 0 && tokens[idx - 1].type === 'heading_close' ? '#v(-1.4em)\n' + prefix : prefix;
};
rules.heading_close = () => '\n\n';
rules.paragraph_open = () => '';
rules.paragraph_close = () => (listStack.length > 0 ? '\n' : '\n\n');
// Function form avoids Typst markup boundary quirks like abc*hihi*def.
rules.strong_open = () => '#strong[';
rules.strong_close = () => ']';
rules.em_open = () => '#emph[';
rules.em_close = () => ']';
rules.code_inline = (tokens, idx) => '`' + (tokens[idx] as MarkdownToken).content + '`';
rules.fence = (tokens, idx) => {
  const token = tokens[idx] as MarkdownToken;
  return renderCodeBlockToTypst(token.content, token.info || '');
};
rules.code_block = (tokens, idx) => renderCodeBlockToTypst((tokens[idx] as MarkdownToken).content);
rules.hr = () => '#line(length: 100%)\n\n';
rules.softbreak = () => (listStack.length > 0 ? '\\\n' + listContinuationIndent() : '\n');
rules.hardbreak = () => '\\\n' + listContinuationIndent();
rules.html_block = () => '';
rules.html_inline = () => '';
rules.blockquote_open = () => '#quote[\n';
rules.blockquote_close = () => ']\n\n';
rules.alert_open = (tokens, idx) => {
  const token = tokens[idx] as MarkdownToken;
  const type = token.meta?.type ?? 'note';
  const title = token.meta?.title ?? '';
  const defaultTitles: Record<string, string> = {
    note: 'Note',
    tip: 'Tip',
    important: 'Important',
    warning: 'Warning',
    caution: 'Caution',
  };
  const titleArg = title && title !== defaultTitles[type] ? `, title: [${title}]` : '';
  return `#gh-alert("${type}"${titleArg})[\n`;
};
rules.alert_close = () => ']\n\n';
rules.bullet_list_open = () => {
  listStack.push(false);
  return '';
};
rules.bullet_list_close = () => {
  listStack.pop();
  return '\n';
};
rules.ordered_list_open = () => {
  listStack.push(true);
  return '';
};
rules.ordered_list_close = () => {
  listStack.pop();
  return '\n';
};
rules.list_item_open = () => {
  const depth = listStack.length - 1;
  const isOrdered = listStack[depth];
  return '  '.repeat(depth) + (isOrdered ? '+' : '-') + ' ';
};
rules.list_item_close = () => '\n';
rules.image = (tokens, idx) => {
  const token = tokens[idx] as MarkdownToken;
  const src = token.attrGet('src') || '';
  const alt = token.content || '';
  return `#image("${escapeTypstString(src)}"${alt ? `, alt: "${escapeTypstString(alt)}"` : ''})`;
};
rules.link_open = (tokens, idx) => `#link("${(tokens[idx] as MarkdownToken).attrGet('href') || ''}")[`;
rules.link_close = () => ']';
rules.text = (tokens, idx) => {
  const content = (tokens[idx] as MarkdownToken).content;
  if (content === PAGEBREAK_MARKER) {
    return '#pagebreak()';
  }
  if (content === TOC_MARKER) {
    return '#outline(title: none)';
  }
  return content;
};

function countFirstRowCells(tokens: unknown[], startIdx: number): number {
  let count = 0;
  for (let i = startIdx; i < tokens.length; i += 1) {
    const type = (tokens[i] as MarkdownToken).type;
    if (type === 'tr_close') {
      break;
    }
    if (type === 'th_open' || type === 'td_open') {
      count += 1;
    }
  }
  return count;
}

function explicitTypstAlignFromToken(token: MarkdownToken): 'left' | 'center' | 'right' | null {
  const style = token.attrGet('style') || '';
  const match = /text-align\s*:\s*(left|center|right)/i.exec(style);
  return (match?.[1].toLowerCase() as 'left' | 'center' | 'right' | undefined) ?? null;
}

function firstRowAlignments(tokens: unknown[], startIdx: number): Array<'left' | 'center' | 'right' | null> {
  const aligns: Array<'left' | 'center' | 'right' | null> = [];
  for (let i = startIdx; i < tokens.length; i += 1) {
    const token = tokens[i] as MarkdownToken;
    if (token.type === 'tr_close') {
      break;
    }
    if (token.type === 'th_open' || token.type === 'td_open') {
      aligns.push(explicitTypstAlignFromToken(token));
    }
  }
  return aligns;
}

rules.table_open = (tokens, idx) => {
  const aligns = firstRowAlignments(tokens, idx + 1);
  const hasExplicitAlign = aligns.some((align) => align !== null);
  const alignArg = hasExplicitAlign
    ? `  align: (${aligns.map((align) => align || 'left').join(', ')}),\n`
    : '';
  return `#table(\n  columns: ${countFirstRowCells(tokens, idx + 1)},\n${alignArg}`;
};
rules.table_close = () => ')\n\n';
rules.thead_open = () => '  table.header(\n';
rules.thead_close = () => '  ),\n';
rules.tbody_open = rules.tbody_close = () => '';
rules.tr_open = rules.tr_close = () => '';
rules.th_open = () => '    [';
rules.th_close = () => '],\n';
rules.td_open = () => '  [';
rules.td_close = () => '],\n';

export function renderToTypstFromString(content: string): string {
  listStack = [];

  const withTaskLists = content
    .replace(/^(\s*)-\s+\[ \]/gm, '$1- ☐')
    .replace(/^(\s*)-\s+\[x\]/gim, '$1- ☑');

  const prepared = replaceOutsideCodeBlocks(withTaskLists, (text) => (
    text
      .replace(/^==page==$/gm, '\n' + PAGEBREAK_MARKER + '\n')
      .replace(/^\[TOC\]$/gim, '\n' + TOC_MARKER + '\n')
  ));

  return md.render(prepared);
}
