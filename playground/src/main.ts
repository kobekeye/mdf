import './app.css';
import htmlSampleSource from './sample-html.md?raw';
import typstSampleSource from './sample-typst.md?raw';
import defaultThemeCssText from '../../themes/default.css?raw';
import defaultThemeCssUrl from '../../themes/default.css?url';
import defaultThemeTypText from '../../themes/default.typ?raw';
import asteriskThemeCssText from '../../themes/asterisk.css?raw';
import asteriskThemeCssUrl from '../../themes/asterisk.css?url';
import asteriskThemeTypText from '../../themes/asterisk.typ?raw';
import logoAssetUrl from '../../Markdown-mark.svg?url';
import katexCssUrl from 'katex/dist/katex.min.css?url';
import highlightCssUrl from 'highlight.js/styles/github-dark.css?url';
import texmathCssUrl from 'markdown-it-texmath/css/texmath.css?url';
import { buildThemeFontFaceCss, renderBodyHtml } from './previewRenderer';

type ThemeName = 'default' | 'asterisk';
type PreviewMode = 'html' | 'typst';

type ThemeAsset = {
  cssText: string;
  cssHref: string;
  typstText: string;
};

const STORAGE_KEYS = {
  legacyMarkdown: 'mdf-playground:markdown',
  markdownHtml: 'mdf-playground:markdown:html',
  markdownTypst: 'mdf-playground:markdown:typst',
  theme: 'mdf-playground:theme',
  mode: 'mdf-playground:mode',
} as const;
const PLAYGROUND_FONT_STYLE_ATTR = 'data-mdf-playground-fonts';
const MARKDOWN_STORAGE_KEY_BY_MODE: Record<PreviewMode, string> = {
  html: STORAGE_KEYS.markdownHtml,
  typst: STORAGE_KEYS.markdownTypst,
};

const themes: Record<ThemeName, ThemeAsset> = {
  default: {
    cssText: defaultThemeCssText,
    cssHref: defaultThemeCssUrl,
    typstText: defaultThemeTypText,
  },
  asterisk: {
    cssText: asteriskThemeCssText,
    cssHref: asteriskThemeCssUrl,
    typstText: asteriskThemeTypText,
  },
};

const sampleMarkdownSourceByMode: Record<PreviewMode, string> = {
  html: htmlSampleSource,
  typst: typstSampleSource,
};

function hydrateSampleMarkdown(markdown: string): string {
  return markdown.replace(/Markdown-mark\.svg/g, logoAssetUrl);
}

const initialTheme = readStoredTheme();
const initialMode = readStoredMode();
migrateLegacyMarkdown(initialMode);
const initialMarkdown = readStoredMarkdown(initialMode);

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root');
}

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <h1>mdf Playground</h1>
        <p>
          Switch between HTML for the web view and Typst for the PDF-oriented rendered document.
        </p>
      </div>
      <div class="status" id="render-status">
        <span class="status-dot"></span>
        <span id="render-status-label">Rendering…</span>
      </div>
    </section>

    <section class="toolbar">
      <div class="toolbar-group">
        <label class="field" for="mode-select">
          <span>Mode</span>
          <select id="mode-select">
            <option value="html">html</option>
            <option value="typst">typst</option>
          </select>
        </label>
        <label class="field" for="theme-select">
          <span>Theme</span>
          <select id="theme-select">
            <option value="default">default</option>
            <option value="asterisk">asterisk</option>
          </select>
        </label>
      </div>
      <div class="toolbar-group">
        <button class="ghost-button" id="load-sample" type="button">Reload Sample</button>
        <button class="pill-button" id="clear-editor" type="button">Clear Editor</button>
      </div>
    </section>

    <section class="workspace">
      <article class="panel editor-panel">
        <header class="panel-head">
          <h2 class="panel-title">Editor</h2>
          <div class="panel-meta">Markdown input</div>
        </header>
        <textarea id="editor" class="editor" spellcheck="false"></textarea>
      </article>

      <article class="panel preview-panel">
        <header class="panel-head">
          <h2 class="panel-title">Preview</h2>
          <div class="panel-meta" id="preview-meta">Current HTML theme rendering</div>
        </header>
        <iframe id="preview-frame" class="preview-frame" title="mdf HTML preview" sandbox="allow-same-origin"></iframe>
        <div id="typst-preview" class="typst-preview" hidden>
          <div id="typst-preview-stage" class="typst-preview-stage"></div>
        </div>
      </article>
    </section>

    <p class="footnote">
      Typst mode runs the browser WASM compiler and renderer. The sample image is bundled,
      but arbitrary local relative images are not resolved in the playground yet.
    </p>
  </main>
`;

const editor = document.querySelector<HTMLTextAreaElement>('#editor');
const modeSelect = document.querySelector<HTMLSelectElement>('#mode-select');
const themeSelect = document.querySelector<HTMLSelectElement>('#theme-select');
const previewFrame = document.querySelector<HTMLIFrameElement>('#preview-frame');
const typstPreview = document.querySelector<HTMLDivElement>('#typst-preview');
const typstPreviewStage = document.querySelector<HTMLDivElement>('#typst-preview-stage');
const loadSampleButton = document.querySelector<HTMLButtonElement>('#load-sample');
const clearEditorButton = document.querySelector<HTMLButtonElement>('#clear-editor');
const renderStatus = document.querySelector<HTMLDivElement>('#render-status');
const renderStatusLabel = document.querySelector<HTMLSpanElement>('#render-status-label');
const previewMeta = document.querySelector<HTMLDivElement>('#preview-meta');

if (
  !editor ||
  !modeSelect ||
  !themeSelect ||
  !previewFrame ||
  !typstPreview ||
  !typstPreviewStage ||
  !loadSampleButton ||
  !clearEditorButton ||
  !renderStatus ||
  !renderStatusLabel ||
  !previewMeta
) {
  throw new Error('Playground UI failed to initialize');
}

const editorEl = editor;
const modeSelectEl = modeSelect;
const themeSelectEl = themeSelect;
const previewFrameEl = previewFrame;
const typstPreviewEl = typstPreview;
const typstPreviewStageEl = typstPreviewStage;
const loadSampleButtonEl = loadSampleButton;
const clearEditorButtonEl = clearEditorButton;
const renderStatusEl = renderStatus;
const renderStatusLabelEl = renderStatusLabel;
const previewMetaEl = previewMeta;

let currentTheme = initialTheme;
let currentMode = initialMode;
let pendingPreviewHtml = '';
let renderTimer: number | null = null;
let renderVersion = 0;
let typstControllerPromise: Promise<import('./typstPreview').TypstPreviewController> | null = null;

editorEl.value = initialMarkdown;
modeSelectEl.value = currentMode;
themeSelectEl.value = currentTheme;

previewFrameEl.addEventListener('load', () => {
  if (currentMode === 'html' && applyPreviewBody(pendingPreviewHtml)) {
    setReadyStatus('HTML preview ready');
  }
});

editorEl.addEventListener('input', () => {
  writeStoredMarkdown(currentMode, editorEl.value);
  scheduleRender();
});

themeSelectEl.addEventListener('change', () => {
  currentTheme = themeSelectEl.value as ThemeName;
  localStorage.setItem(STORAGE_KEYS.theme, currentTheme);
  syncPlaygroundFonts();
  if (currentMode === 'html') {
    rebuildPreviewDocument();
  } else {
    scheduleRender(true);
  }
});

modeSelectEl.addEventListener('change', () => {
  const nextMode = modeSelectEl.value as PreviewMode;
  if (nextMode === currentMode) {
    return;
  }

  writeStoredMarkdown(currentMode, editorEl.value);
  currentMode = nextMode;
  localStorage.setItem(STORAGE_KEYS.mode, currentMode);
  editorEl.value = readStoredMarkdown(currentMode);
  syncPreviewMode();
  scheduleRender(true);
});

loadSampleButtonEl.addEventListener('click', () => {
  editorEl.value = readBundledSampleMarkdown(currentMode);
  writeStoredMarkdown(currentMode, editorEl.value);
  scheduleRender(true);
});

clearEditorButtonEl.addEventListener('click', () => {
  editorEl.value = '';
  writeStoredMarkdown(currentMode, editorEl.value);
  scheduleRender(true);
  editorEl.focus();
});

syncPreviewMode();
syncPlaygroundFonts();
rebuildPreviewDocument();
scheduleRender(true);

function readStoredTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEYS.theme);
  return stored === 'asterisk' ? 'asterisk' : 'default';
}

function readStoredMode(): PreviewMode {
  const stored = localStorage.getItem(STORAGE_KEYS.mode);
  return stored === 'typst' ? 'typst' : 'html';
}

function readBundledSampleMarkdown(mode: PreviewMode): string {
  return hydrateSampleMarkdown(sampleMarkdownSourceByMode[mode]);
}

function readStoredMarkdown(mode: PreviewMode): string {
  return localStorage.getItem(MARKDOWN_STORAGE_KEY_BY_MODE[mode]) ?? readBundledSampleMarkdown(mode);
}

function writeStoredMarkdown(mode: PreviewMode, markdown: string): void {
  localStorage.setItem(MARKDOWN_STORAGE_KEY_BY_MODE[mode], markdown);
}

function migrateLegacyMarkdown(mode: PreviewMode): void {
  const legacy = localStorage.getItem(STORAGE_KEYS.legacyMarkdown);
  if (legacy === null) {
    return;
  }

  const hasModeSpecificContent = (Object.values(MARKDOWN_STORAGE_KEY_BY_MODE) as string[])
    .some((storageKey) => localStorage.getItem(storageKey) !== null);
  if (!hasModeSpecificContent) {
    writeStoredMarkdown(mode, hydrateSampleMarkdown(legacy));
  }

  localStorage.removeItem(STORAGE_KEYS.legacyMarkdown);
}

function syncPreviewMode(): void {
  const isHtml = currentMode === 'html';
  previewFrameEl.hidden = !isHtml;
  typstPreviewEl.hidden = isHtml;
  previewMetaEl.textContent = isHtml ? 'Current HTML theme rendering' : 'Current Typst theme rendering';
}

function syncPlaygroundFonts(): void {
  const css = buildThemeFontFaceCss(themes[currentTheme].typstText);
  const existing = document.head.querySelector<HTMLStyleElement>(`style[${PLAYGROUND_FONT_STYLE_ATTR}]`);

  if (!css) {
    existing?.remove();
    return;
  }

  if (existing) {
    if (existing.textContent !== css) {
      existing.textContent = css;
    }
    return;
  }

  const style = document.createElement('style');
  style.textContent = css;
  style.setAttribute(PLAYGROUND_FONT_STYLE_ATTR, '1');
  document.head.appendChild(style);
}

function scheduleRender(immediate = false): void {
  setRenderingStatus(currentMode === 'html' ? 'Rendering HTML…' : 'Rendering Typst…');

  if (renderTimer !== null) {
    window.clearTimeout(renderTimer);
    renderTimer = null;
  }

  if (immediate) {
    updatePreview();
    return;
  }

  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    updatePreview();
  }, 30);
}

function updatePreview(): void {
  const version = ++renderVersion;

  if (currentMode === 'typst') {
    void updateTypstPreview(version);
    return;
  }

  pendingPreviewHtml = renderBodyHtml(editorEl.value);
  if (applyPreviewBody(pendingPreviewHtml)) {
    setReadyStatus('HTML preview ready');
  }
}

function applyPreviewBody(bodyHtml: string): boolean {
  const doc = previewFrameEl.contentDocument;
  const target = doc?.getElementById('mdf-content');
  if (!target) {
    return false;
  }
  target.innerHTML = bodyHtml;
  return true;
}

function rebuildPreviewDocument(): void {
  if (currentMode === 'html') {
    setRenderingStatus('Rendering HTML…');
  }
  previewFrameEl.srcdoc = buildPreviewDocument(currentTheme);
}

async function updateTypstPreview(version: number): Promise<void> {
  try {
    const controller = await getTypstController();
    await controller.render(editorEl.value, themes[currentTheme].typstText);
    if (version !== renderVersion || currentMode !== 'typst') {
      return;
    }
    setReadyStatus('Typst preview ready');
  } catch (error) {
    if (version !== renderVersion || currentMode !== 'typst') {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const controller = typstControllerPromise ? await typstControllerPromise.catch(() => null) : null;
    if (controller) {
      controller.showError(message);
    } else {
      typstPreviewStageEl.innerHTML = `<div class="typst-error-card"><div class="typst-error-title">Typst preview error</div><pre>${escapeHtml(message)}</pre></div>`;
    }
    setErrorStatus('Typst preview failed');
  }
}

function getTypstController(): Promise<import('./typstPreview').TypstPreviewController> {
  typstControllerPromise ??= import('./typstPreview').then(({ TypstPreviewController }) => (
    new TypstPreviewController(typstPreviewStageEl, Object.values(themes).map((theme) => theme.typstText))
  ));
  return typstControllerPromise;
}

function buildPreviewDocument(theme: ThemeName): string {
  const asset = themes[theme];
  const fontFaceCss = buildThemeFontFaceCss(asset.typstText);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${katexCssUrl}">
  <link rel="stylesheet" href="${highlightCssUrl}">
  <link rel="stylesheet" href="${texmathCssUrl}">
  <link rel="stylesheet" href="${asset.cssHref}">
  <style>
    ${fontFaceCss}

    html {
      background:
        radial-gradient(circle at top, rgba(214, 196, 171, 0.32), transparent 42%),
        linear-gradient(180deg, #e9dfcf 0%, #e4d7c3 100%);
    }

    body {
      min-height: 100vh;
      padding: 38px 22px 72px !important;
      color-scheme: light;
    }

    .page-break {
      position: relative;
      height: 1px;
      margin: 2.6em 0;
      border-top: 1px dashed rgba(122, 100, 73, 0.32);
      break-after: auto !important;
    }

    .page-break::after {
      content: 'page break';
      position: absolute;
      top: -11px;
      right: 0;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(255, 249, 240, 0.9);
      color: rgba(122, 100, 73, 0.9);
      font: 700 10px/1 'IBM Plex Mono', monospace;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div id="mdf-content"></div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setRenderingStatus(label: string): void {
  renderStatusEl.classList.remove('ready');
  renderStatusEl.classList.remove('error');
  renderStatusLabelEl.textContent = label;
}

function setReadyStatus(label: string): void {
  renderStatusEl.classList.add('ready');
  renderStatusEl.classList.remove('error');
  renderStatusLabelEl.textContent = label;
}

function setErrorStatus(label: string): void {
  renderStatusEl.classList.remove('ready');
  renderStatusEl.classList.add('error');
  renderStatusLabelEl.textContent = label;
}
