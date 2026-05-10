// Webview-side script. Bundled by esbuild into out/media/typst-preview.js.
// Runs inside the VSCode webview (browser context). Receives incremental
// Typst vector deltas from the extension host and patches a long-lived
// renderer session instead of rebuilding the full SVG on every keystroke.

import { createTypstRenderer } from '@myriaddreamin/typst.ts/renderer';
import type { RenderSession, TypstRenderer } from '@myriaddreamin/typst.ts/renderer';
import { installZoom, createZoomIndicator, ZoomController } from './zoom';
import { replaceOrPatchSvg } from './svgPatch';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): { scrollTop?: number; zoom?: number } | undefined;
  setState(state: unknown): void;
}

interface TypstRendererWithSession extends TypstRenderer {
  createModule(artifactContent?: Uint8Array): Promise<RenderSession>;
}

declare const acquireVsCodeApi: () => VsCodeApi;
declare const TYPST_WASM_URI: string;

type LogLevel = 'info' | 'warn' | 'error';
type RenderAction = 'reset' | 'merge';

type RenderMessage = {
  type: 'render';
  action: RenderAction;
  data: Uint8Array;
  version?: number;
};
type ErrorMessage = { type: 'error'; message: string };
type IncomingMessage = RenderMessage | ErrorMessage;

const vscode = acquireVsCodeApi();
const container = document.getElementById('typst-container')!;
const statusEl = document.getElementById('typst-status')!;
const controls = document.getElementById('mdf-controls');
const menuToggle = document.getElementById('mdf-menu-toggle') as HTMLButtonElement | null;
const menuPanel = document.getElementById('mdf-menu-panel');
const themeSelect = document.getElementById('mdf-theme-select') as HTMLSelectElement | null;
const modeSelect = document.getElementById('mdf-mode-select') as HTMLSelectElement | null;

type SvgMetrics = { width: number; height: number };
const svgMetrics = new WeakMap<SVGSVGElement, SvgMetrics>();
const SVG_NS = 'http://www.w3.org/2000/svg';
const PAGE_GAP_PT = 10;

// ─── Logging ─────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c
  ));
}

function log(level: LogLevel, ...parts: unknown[]): void {
  const message = parts.map((p) => {
    if (p instanceof Error) return p.stack || p.message;
    if (typeof p === 'string') return p;
    try { return JSON.stringify(p); } catch { return String(p); }
  }).join(' ');
  try { vscode.postMessage({ type: 'log', level, message }); } catch { /* pre-api */ }
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(
    '[typst-preview]', ...parts,
  );
}

window.addEventListener('error', (e) => {
  log('error', 'window.error:', e.message, 'at', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  log('error', 'unhandledrejection:', (e.reason && (e.reason.stack || e.reason.message)) || e.reason);
});

// ─── Status banner ───────────────────────────────────────────────────────────

function showStatus(text: string): void {
  statusEl.classList.remove('hidden');
  statusEl.innerHTML = `<div class="typst-loading">${escHtml(text)}</div>`;
}

function showError(msg: string): void {
  statusEl.classList.remove('hidden');
  statusEl.innerHTML =
    '<div class="typst-error"><strong>Typst preview error</strong>\n\n' +
    escHtml(msg) +
    '\n\n<a href="#" data-action="show-output">Show full log →</a></div>';
  log('error', msg);
}

function hideStatus(): void {
  statusEl.classList.add('hidden');
  statusEl.innerHTML = '';
}

statusEl.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement | null;
  if (t?.getAttribute?.('data-action') === 'show-output') {
    ev.preventDefault();
    vscode.postMessage({ type: 'showOutput' });
  }
});

function setMenuOpen(open: boolean): void {
  if (!controls || !menuToggle) return;
  controls.classList.toggle('open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
}

menuToggle?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  const open = controls?.classList.contains('open') ?? false;
  setMenuOpen(!open);
});

menuPanel?.addEventListener('click', (ev) => {
  ev.stopPropagation();
});

window.addEventListener('click', () => setMenuOpen(false));

if (themeSelect) {
  themeSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'switchTheme', theme: themeSelect.value });
  });
}

if (modeSelect) {
  modeSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'switchMode', mode: modeSelect.value });
  });
}

// ─── Layout / zoom ───────────────────────────────────────────────────────────

const persistedState = vscode.getState() || {};
let zoom: ZoomController;
const showZoomIndicator = createZoomIndicator('typst-zoom-indicator');

function fmtSvgNumber(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, '');
}

function readTranslateX(el: Element): number {
  const transform = el.getAttribute('transform') || '';
  const match = /translate\(\s*([^,\s)]+)/.exec(transform);
  const x = match ? Number.parseFloat(match[1]) : 0;
  return Number.isFinite(x) ? x : 0;
}

function readTranslateY(el: Element): number {
  const transform = el.getAttribute('transform') || '';
  const match = /translate\(\s*[^,\s)]+\s*,\s*([^)\s]+)/.exec(transform);
  const y = match ? Number.parseFloat(match[1]) : 0;
  return Number.isFinite(y) ? y : 0;
}

function readPositiveNumber(el: Element, attr: string): number | null {
  const value = Number.parseFloat(el.getAttribute(attr) || '');
  return Number.isFinite(value) && value > 0 ? value : null;
}

function ensurePageBackground(page: SVGGElement, width: number, height: number): void {
  let bg = page.querySelector(':scope > rect.mdf-preview-page-bg') as SVGRectElement | null;
  if (!bg) {
    bg = document.createElementNS(SVG_NS, 'rect');
    bg.classList.add('mdf-preview-page-bg');
    page.insertBefore(bg, page.firstChild);
  }

  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', fmtSvgNumber(width));
  bg.setAttribute('height', fmtSvgNumber(height));
  bg.setAttribute('fill', '#fff');
}

function addPreviewPageGaps(): void {
  for (const svg of container.querySelectorAll('svg.typst-doc')) {
    if (!(svg instanceof SVGSVGElement)) continue;

    const pages = Array.from(svg.querySelectorAll(':scope > g.typst-page'))
      .filter((el): el is SVGGElement => el instanceof SVGGElement);
    if (pages.length === 0) continue;

    const viewBox = svg.viewBox.baseVal;
    let y = 0;
    let maxWidth = viewBox?.width || 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const width = readPositiveNumber(page, 'data-page-width') || maxWidth;
      const height = readPositiveNumber(page, 'data-page-height');
      if (!height || !width) return;

      maxWidth = Math.max(maxWidth, width);
      ensurePageBackground(page, width, height);
      page.setAttribute('transform', `translate(${fmtSvgNumber(readTranslateX(page))}, ${fmtSvgNumber(y)})`);
      y += height;
      if (i < pages.length - 1) y += PAGE_GAP_PT;
    }

    if (maxWidth > 0 && y > 0) {
      const minX = viewBox?.x || 0;
      const minY = viewBox?.y || 0;
      svg.setAttribute('viewBox', `${fmtSvgNumber(minX)} ${fmtSvgNumber(minY)} ${fmtSvgNumber(maxWidth)} ${fmtSvgNumber(y)}`);
      svg.setAttribute('height', fmtSvgNumber(y));
      svg.setAttribute('data-height', fmtSvgNumber(y));
      svg.style.background = 'transparent';
      svgMetrics.delete(svg);
    }
  }
}

function readSvgMetrics(svg: SVGSVGElement): SvgMetrics | null {
  const cached = svgMetrics.get(svg);
  if (cached) return cached;

  const viewBox = svg.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    const metrics = { width: viewBox.width, height: viewBox.height };
    svgMetrics.set(svg, metrics);
    return metrics;
  }

  const attrWidth = Number.parseFloat(svg.getAttribute('width') || '');
  const attrHeight = Number.parseFloat(svg.getAttribute('height') || '');
  if (attrWidth > 0 && attrHeight > 0) {
    const metrics = { width: attrWidth, height: attrHeight };
    svgMetrics.set(svg, metrics);
    return metrics;
  }

  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const metrics = { width: rect.width, height: rect.height };
    svgMetrics.set(svg, metrics);
    return metrics;
  }

  return null;
}

function layoutPages(showIndicator = false): void {
  const level = zoom?.getLevel() ?? 1;
  const availableWidth = Math.max(window.innerWidth - 32, 1);
  for (const svg of container.querySelectorAll('svg')) {
    if (!(svg instanceof SVGSVGElement)) continue;
    const metrics = readSvgMetrics(svg);
    if (!metrics) continue;

    // Treat 100% as "fit to preview width", matching Tinymist's baseline.
    // Zoom levels above/below that baseline then scale relative to the fit size.
    const targetWidth = availableWidth * level;
    const targetHeight = metrics.height * (targetWidth / metrics.width);
    svg.style.width = `${targetWidth}px`;
    svg.style.height = `${targetHeight}px`;
  }

  vscode.setState({ ...vscode.getState(), zoom: level });
  if (showIndicator) showZoomIndicator(level);
}

type TypstJumpTarget = {
  page: number;
  x: number;
  y: number;
};

function parseTypstJump(el: Element): TypstJumpTarget | null {
  const handler = el.getAttribute('onclick') || '';
  const match = /handleTypstLocation\(\s*this\s*,\s*(\d+)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(handler);
  if (!match) return null;

  const page = Number.parseInt(match[1], 10);
  const x = Number.parseFloat(match[2]);
  const y = Number.parseFloat(match[3]);
  if (!Number.isFinite(page) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { page, x, y };
}

function scrollToTypstLocation(target: TypstJumpTarget): void {
  const svg = container.querySelector('svg.typst-doc');
  if (!(svg instanceof SVGSVGElement)) return;

  const naturalWidth = readPositiveNumber(svg, 'data-width')
    ?? readPositiveNumber(svg, 'width')
    ?? svg.viewBox.baseVal.width;
  if (!(naturalWidth > 0)) return;

  const pages = Array.from(svg.querySelectorAll(':scope > g.typst-page'))
    .filter((el): el is SVGGElement => el instanceof SVGGElement);
  const page = pages[target.page - 1];
  if (!page) return;

  const scale = svg.getBoundingClientRect().width / naturalWidth;
  if (!(scale > 0)) return;

  const docY = readTranslateY(page) + target.y;
  const top = window.scrollY + svg.getBoundingClientRect().top + docY * scale;
  window.scrollTo(0, Math.max(0, top - 16));
  vscode.setState({ ...vscode.getState(), scrollTop: window.scrollY });
}

zoom = installZoom({
  initialLevel: persistedState.zoom || 1,
  onZoomChange: () => layoutPages(true),
});

window.addEventListener('resize', () => layoutPages(false), { passive: true });
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') setMenuOpen(false);
});
window.addEventListener('scroll', () => {
  vscode.setState({ ...vscode.getState(), scrollTop: window.scrollY });
}, { passive: true });
container.addEventListener('click', (ev) => {
  const target = ev.target;
  if (!(target instanceof Element)) return;

  const link = target.closest('a');
  if (!(link instanceof Element)) return;

  const jump = parseTypstJump(link);
  if (!jump) return;

  ev.preventDefault();
  scrollToTypstLocation(jump);
});

// ─── Render loop ─────────────────────────────────────────────────────────────

const savedScroll = persistedState.scrollTop;
let scrollRestored = false;

function toBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array(raw as ArrayBuffer | ArrayLike<number>);
}

function restoreScrollIfNeeded(svgCount: number): void {
  if (!scrollRestored && typeof savedScroll === 'number' && svgCount > 0) {
    window.scrollTo(0, savedScroll);
    scrollRestored = true;
  }
}

async function bootstrap(): Promise<void> {
  showStatus('Loading Typst renderer…');

  const renderer = createTypstRenderer() as TypstRendererWithSession;

  const wasmResp = await fetch(TYPST_WASM_URI);
  if (!wasmResp.ok) {
    showError(`WASM fetch failed: ${wasmResp.status} ${wasmResp.statusText}`);
    return;
  }
  const wasmBytes = await wasmResp.arrayBuffer();

  await renderer.init({ getModule: () => wasmBytes });
  log('info', 'renderer ready');
  showStatus('Waiting for first Typst artifact…');

  let session: RenderSession | null = null;
  let pending: { action: RenderAction; bytes: Uint8Array; version: number } | null = null;
  let rendering = false;
  let renderCounter = 0;

  async function renderArtifact(
    action: RenderAction,
    bytes: Uint8Array,
    version: number,
  ): Promise<void> {
    try {
      if (!session || action === 'reset') {
        if (session) renderer.resetSession(session);
        session = await renderer.createModule(bytes);
        const svg = await session.renderSvg({});
        container.innerHTML = svg;
        addPreviewPageGaps();
        log('info', `render #${version} reset; bytes=${bytes.length}`);
      } else {
        session.manipulateData({ action: 'merge', data: bytes });
        replaceOrPatchSvg(container, session.renderSvgDiff({}));
        addPreviewPageGaps();
        log('info', `render #${version} merge; bytes=${bytes.length}`);
      }
    } catch (err) {
      session = null;
      showError('render failed: ' + String(err));
      return;
    }

    requestAnimationFrame(() => {
      const svgCount = container.querySelectorAll('svg').length;
      layoutPages(false);
      log('info', `render #${version} complete; svg=${svgCount}`);
      if (svgCount > 0) hideStatus();
      else showStatus(`Render #${version} produced no SVG nodes`);
      restoreScrollIfNeeded(svgCount);
    });
  }

  async function drainRenderQueue(): Promise<void> {
    if (rendering) return;
    rendering = true;
    while (pending) {
      const job = pending;
      pending = null;
      await renderArtifact(job.action, job.bytes, job.version);
    }
    rendering = false;
  }

  window.addEventListener('message', (e: MessageEvent<IncomingMessage>) => {
    const msg = e.data;
    if (!msg) return;

    if (msg.type === 'error') {
      showError(msg.message);
      return;
    }
    if (msg.type !== 'render') return;

    const version = typeof msg.version === 'number' ? msg.version : ++renderCounter;
    pending = {
      action: msg.action,
      bytes: toBytes(msg.data),
      version,
    };
    showStatus(msg.action === 'reset' ? 'Resetting preview…' : 'Applying Typst delta…');
    void drainRenderQueue();
  });

  vscode.postMessage({ type: 'ready' });
}

bootstrap().catch((err) => {
  log('error', 'bootstrap threw:', err);
  showError('bootstrap threw: ' + String(err));
});
