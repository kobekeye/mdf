import MarkdownIt from 'markdown-it';
import texmathModule from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';
import anchor from 'markdown-it-anchor';
import taskListsModule from 'markdown-it-task-lists';
import containerModule from 'markdown-it-container';
import githubAlertsModule from 'markdown-it-github-alerts';

const themeFontAssetUrls = import.meta.glob('../fonts/*', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

const texmath = texmathModule as (md: MarkdownIt, opts?: unknown) => void;
const taskLists = taskListsModule as (md: MarkdownIt, opts?: unknown) => void;
const container = containerModule as (
  md: MarkdownIt,
  name: string,
  opts?: { render?: (tokens: unknown[], idx: number) => string },
) => void;
const githubAlerts = (
  (githubAlertsModule as { default?: unknown }).default ?? githubAlertsModule
) as (md: MarkdownIt, opts?: unknown) => void;

const TOC_MARKER = '<!--TOC_PLACEHOLDER-->';
const TOC_MD_REGEX = /^\[TOC\]$/gim;

type ThemeFontSpec = {
  family: string;
  weights: string[];
  variants: Array<{
    style: 'normal' | 'italic';
    weight: string;
  }>;
};

function parseFontVariant(token: string): { style: 'normal' | 'italic'; weight: string } | null {
  const match = String(token).trim().match(/^(\d+)(i|italic)?$/i);
  if (!match) {
    return null;
  }

  return {
    weight: match[1],
    style: match[2] ? 'italic' : 'normal',
  };
}

export function replaceOutsideCodeBlocks(content: string, replaceFn: (text: string) => string): string {
  const lines = content.split('\n');
  const segments: Array<{ code: boolean; text: string }> = [];
  let buffer: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  for (const line of lines) {
    if (!inFence) {
      const match = line.match(/^(`{3,}|~{3,})/);
      if (match) {
        if (buffer.length > 0) {
          segments.push({ code: false, text: buffer.join('\n') });
        }
        buffer = [line];
        inFence = true;
        fenceChar = match[1][0];
        fenceLength = match[1].length;
      } else {
        buffer.push(line);
      }
      continue;
    }

    buffer.push(line);
    const closingFence = new RegExp(`^\\${fenceChar}{${fenceLength},}\\s*$`);
    if (closingFence.test(line)) {
      segments.push({ code: true, text: buffer.join('\n') });
      buffer = [];
      inFence = false;
    }
  }

  if (buffer.length > 0) {
    segments.push({ code: inFence, text: buffer.join('\n') });
  }

  return segments.map((segment) => (segment.code ? segment.text : replaceFn(segment.text))).join('\n');
}

function preprocessTOC(markdown: string): string {
  return markdown.replace(TOC_MD_REGEX, TOC_MARKER);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function generateTOC(html: string): string {
  const headingRegex = /<h([1-6])\s+id="([^"]*)"[^>]*>(.*?)<\/h[1-6]>/gi;
  const headings: Array<{ level: number; id: string; text: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      level: Number.parseInt(match[1], 10),
      id: match[2],
      text: stripTags(match[3]),
    });
  }

  if (headings.length === 0) {
    return '';
  }

  const minLevel = Math.min(...headings.map((heading) => heading.level));
  let tocHtml = '<nav class="toc">\n<p class="toc-title">Contents</p>\n<ul>\n';
  let currentLevel = minLevel;
  let isFirst = true;

  for (const heading of headings) {
    if (heading.level > currentLevel) {
      for (let i = currentLevel; i < heading.level; i += 1) {
        tocHtml += '<ul>\n';
      }
    } else if (heading.level < currentLevel) {
      for (let i = currentLevel; i > heading.level; i -= 1) {
        tocHtml += '</ul>\n</li>\n';
      }
    } else if (!isFirst) {
      tocHtml += '</li>\n';
    }

    tocHtml += `<li><a href="#${heading.id}">${heading.text}</a>\n`;
    currentLevel = heading.level;
    isFirst = false;
  }

  for (let i = currentLevel; i >= minLevel; i -= 1) {
    tocHtml += '</li>\n</ul>\n';
  }

  tocHtml += '</nav>';
  return tocHtml;
}

function processTOC(html: string): string {
  if (!html.includes(TOC_MARKER)) {
    return html;
  }
  return html.replace(TOC_MARKER, generateTOC(html));
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  breaks: true,
});

md.set({
  highlight(source: string, language: string): string {
    const wrap = (content: string) => `<pre class="hljs"><code>${content}</code></pre>`;
    if (language && hljs.getLanguage(language)) {
      try {
        return wrap(hljs.highlight(source, { language, ignoreIllegals: true }).value);
      } catch {
        return wrap(md.utils.escapeHtml(source));
      }
    }
    return wrap(md.utils.escapeHtml(source));
  },
});

md.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
})
  .use(anchor, {
    permalink: false,
    slugify: (value: string) => encodeURIComponent(String(value).trim().toLowerCase().replace(/\s+/g, '-')),
  })
  .use(taskLists, { enabled: true })
  .use(githubAlerts, {
    classPrefix: 'gh-alert',
    icons: { note: '', tip: '', important: '', warning: '', caution: '' },
  });

const alignments = ['center', 'right', 'left'] as const;
for (const align of alignments) {
  md.use(container, align, {
    render(tokens: Array<{ nesting: number }>, idx: number) {
      return tokens[idx].nesting === 1 ? `<div class="align-${align}">\n` : '</div>\n';
    },
  });
}

const containers = [
  { names: ['info', 'blue'], cssClass: 'info' },
  { names: ['warning', 'orange'], cssClass: 'warning' },
  { names: ['danger', 'red'], cssClass: 'danger' },
  { names: ['success', 'green'], cssClass: 'success' },
];

for (const { names, cssClass } of containers) {
  for (const name of names) {
    md.use(container, name, {
      render(tokens: Array<{ nesting: number; info: string }>, idx: number) {
        const token = tokens[idx];
        if (token.nesting !== 1) {
          return '</div>\n';
        }

        const titleMatch = token.info.trim().match(new RegExp(`^${name}\\s+(.*)$`));
        const title = titleMatch ? titleMatch[1].trim() : '';
        const titleHtml = title ? `<p class="callout-title">${md.utils.escapeHtml(title)}</p>\n` : '';
        return `<div class="callout callout-${cssClass}">\n${titleHtml}`;
      },
    });
  }
}

md.use(container, 'spoiler', {
  render(tokens: Array<{ nesting: number; info: string }>, idx: number) {
    const token = tokens[idx];
    if (token.nesting !== 1) {
      return '</details>\n';
    }

    const titleMatch = token.info.trim().match(/^spoiler\s+(.*)$/);
    const title = titleMatch ? titleMatch[1].trim() : 'Spoiler';
    return `<details class="callout-spoiler">\n<summary>${md.utils.escapeHtml(title)}</summary>\n`;
  },
});

export function renderBodyHtml(markdown: string): string {
  const prepared = replaceOutsideCodeBlocks(markdown, (text) => {
    const withPageBreaks = text.replace(/^==page==$/gm, '\n<div class="page-break"></div>\n');
    return preprocessTOC(withPageBreaks);
  });

  return processTOC(md.render(prepared));
}

function parseThemeFontSpecs(themeSource: string): ThemeFontSpec[] {
  const match =
    themeSource.match(/\/\*\s*@mdf-fonts:\s*([^*]+?)\s*\*\//) ??
    themeSource.match(/\/\/\s*@mdf-fonts:\s*(.+)/);
  if (!match) {
    return [];
  }

  return match[1]
    .trim()
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((spec) => {
      const separator = spec.lastIndexOf(':');
      if (separator === -1) {
        return [];
      }

      const family = spec.slice(0, separator).trim();
      const variants = spec
        .slice(separator + 1)
        .split(',')
        .map((variant) => parseFontVariant(variant))
        .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant));
      return family && variants.length > 0
        ? [{ family, weights: [...new Set(variants.map((variant) => variant.weight))], variants }]
        : [];
    });
}

function normalizeFontFamilyKey(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function detectFontFormat(url: string): string {
  if (url.endsWith('.otf')) return 'opentype';
  if (url.endsWith('.ttf')) return 'truetype';
  if (url.endsWith('.woff2')) return 'woff2';
  if (url.endsWith('.woff')) return 'woff';
  return 'truetype';
}

function resolveThemeFontUrl(
  family: string,
  variant: { style: 'normal' | 'italic'; weight: string },
): string | null {
  const key = normalizeFontFamilyKey(family);
  const needle = `/${key}-${variant.weight}${variant.style === 'italic' ? 'i' : ''}.`;

  for (const [assetPath, assetUrl] of Object.entries(themeFontAssetUrls)) {
    if (assetPath.toLowerCase().includes(needle)) {
      return assetUrl;
    }
  }

  return null;
}

export function collectThemeFontUrls(themeSource: string): string[] {
  return parseThemeFontSpecs(themeSource)
    .flatMap(({ family, variants }) => variants.map((variant) => resolveThemeFontUrl(family, variant)))
    .filter((url): url is string => Boolean(url));
}

export function buildThemeFontFaceCss(themeSource: string): string {
  return parseThemeFontSpecs(themeSource)
    .flatMap(({ family, variants }) => variants.map((variant) => {
      const url = resolveThemeFontUrl(family, variant);
      if (!url) {
        return null;
      }
      const format = detectFontFormat(url);
      return `@font-face { font-family: '${family}'; font-style: ${variant.style}; font-weight: ${variant.weight}; src: url('${url}') format('${format}'); }`;
    }))
    .filter((block): block is string => Boolean(block))
    .join('\n');
}

export function buildGoogleFontsUrl(themeCss: string): string | null {
  const families = parseThemeFontSpecs(themeCss);

  const params = families
    .map(({ family, variants }) => {
      if (variants.length === 0) return null;
      const hasItalic = variants.some((variant) => variant.style === 'italic');
      if (!hasItalic) {
        return `family=${family.replace(/ /g, '+')}:wght@${variants.map((variant) => variant.weight).join(';')}`;
      }
      return `family=${family.replace(/ /g, '+')}:ital,wght@${variants.map((variant) => `${variant.style === 'italic' ? 1 : 0},${variant.weight}`).join(';')}`;
    })
    .filter((value): value is string => Boolean(value));

  if (params.length === 0) {
    return null;
  }

  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}
