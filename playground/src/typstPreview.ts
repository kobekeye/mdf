import {
  createTypstCompiler,
  createTypstRenderer,
  initOptions,
  loadFonts,
} from '@myriaddreamin/typst.ts';
import type { IncrementalServer, TypstCompiler } from '@myriaddreamin/typst.ts/compiler';
import type { RenderSession, TypstRenderer } from '@myriaddreamin/typst.ts/renderer';
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url';
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url';
import { collectThemeFontUrls } from './previewRenderer';
import { replaceOrPatchSvg } from './svgPatch';
import { renderToTypstFromString } from './typstRenderer';

const bundledFontUrls = Object.values(
  import.meta.glob('../../vscode-mdf/vendor/typst-assets/fonts/*', {
    eager: true,
    import: 'default',
    query: '?url',
  }),
) as string[];

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAGE_GAP_PT = 10;

type Diagnostic = {
  message?: string;
};

type CompileResult = {
  result?: Uint8Array;
  diagnostics?: Diagnostic[];
};

type TypstCompileArtifact = {
  action: 'reset' | 'merge';
  data: Uint8Array;
};

interface TypstRendererWithSession extends TypstRenderer {
  createModule(artifactContent?: Uint8Array): Promise<RenderSession>;
}

type FsAccessModel = {
  getMTime(path: string): Date | undefined;
  isFile(path: string): boolean | undefined;
  getRealPath(path: string): string | undefined;
  readAll(path: string): Uint8Array | undefined;
};

function formatDiagnostic(diagnostic: Diagnostic): string {
  return diagnostic.message?.trim() || 'Typst compilation failed.';
}

function formatDiagnostics(result: CompileResult): string {
  if (!result.diagnostics || result.diagnostics.length === 0) {
    return 'Typst compilation failed.';
  }

  return result.diagnostics.map(formatDiagnostic).join('\n\n');
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function fmtSvgNumber(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, '');
}

function readTranslateX(el: Element): number {
  const transform = el.getAttribute('transform') || '';
  const match = /translate\(\s*([^,\s)]+)/.exec(transform);
  const x = match ? Number.parseFloat(match[1]) : 0;
  return Number.isFinite(x) ? x : 0;
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
  bg.setAttribute('fill', '#ffffff');
}

function addPreviewPageGaps(host: HTMLElement): void {
  for (const svg of host.querySelectorAll('svg.typst-doc')) {
    if (!(svg instanceof SVGSVGElement)) {
      continue;
    }

    const pages = Array.from(svg.querySelectorAll(':scope > g.typst-page'))
      .filter((el): el is SVGGElement => el instanceof SVGGElement);
    if (pages.length === 0) {
      continue;
    }

    const viewBox = svg.viewBox.baseVal;
    let y = 0;
    let maxWidth = viewBox?.width || 0;

    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const width = readPositiveNumber(page, 'data-page-width') || maxWidth;
      const height = readPositiveNumber(page, 'data-page-height');
      if (!height || !width) {
        return;
      }

      maxWidth = Math.max(maxWidth, width);
      ensurePageBackground(page, width, height);
      page.setAttribute('transform', `translate(${fmtSvgNumber(readTranslateX(page))}, ${fmtSvgNumber(y)})`);
      y += height;
      if (i < pages.length - 1) {
        y += PAGE_GAP_PT;
      }
    }

    if (maxWidth > 0 && y > 0) {
      const minX = viewBox?.x || 0;
      const minY = viewBox?.y || 0;
      svg.setAttribute('viewBox', `${fmtSvgNumber(minX)} ${fmtSvgNumber(minY)} ${fmtSvgNumber(maxWidth)} ${fmtSvgNumber(y)}`);
      svg.setAttribute('height', fmtSvgNumber(y));
      svg.setAttribute('data-height', fmtSvgNumber(y));
      svg.style.background = 'transparent';
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class BrowserAccessModel implements FsAccessModel {
  private mTimes = new Map<string, Date | undefined>();
  private mData = new Map<string, Uint8Array | undefined>();

  constructor(private readonly baseUrl: string) {}

  private resolvePath(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  getMTime(path: string): Date | undefined {
    if (this.mTimes.has(path)) {
      return this.mTimes.get(path);
    }

    const request = new XMLHttpRequest();
    request.open('HEAD', this.resolvePath(path), false);
    request.send(null);
    const modified = request.status === 200 ? request.getResponseHeader('Last-Modified') : null;
    const date = modified ? new Date(modified) : undefined;
    this.mTimes.set(path, date);
    return date;
  }

  isFile(): boolean {
    return true;
  }

  getRealPath(path: string): string {
    return path;
  }

  readAll(path: string): Uint8Array | undefined {
    if (this.mData.has(path)) {
      return this.mData.get(path);
    }

    const request = new XMLHttpRequest();
    request.overrideMimeType('text/plain; charset=x-user-defined');
    request.open('GET', this.resolvePath(path), false);
    request.send(null);
    const data = request.status === 200 && typeof request.response === 'string'
      ? Uint8Array.from(request.response, (ch) => ch.charCodeAt(0))
      : undefined;
    this.mData.set(path, data);
    return data;
  }
}

class LeasedIncrementalServer {
  private disposed = false;

  private constructor(
    readonly server: IncrementalServer,
    private readonly release: () => void,
    private readonly lifetime: Promise<unknown>,
  ) {}

  static async create(compiler: TypstCompiler): Promise<LeasedIncrementalServer> {
    let resolveServer!: (server: IncrementalServer) => void;
    let rejectServer!: (reason?: unknown) => void;
    const serverReady = new Promise<IncrementalServer>((resolve, reject) => {
      resolveServer = resolve;
      rejectServer = reject;
    });

    let release!: () => void;
    const releaseSignal = new Promise<void>((resolve) => { release = resolve; });

    const lifetime = compiler.withIncrementalServer(async (server) => {
      resolveServer(server);
      await releaseSignal;
    });
    lifetime.catch((err) => rejectServer(err));

    const server = await serverReady;
    server.setAttachDebugInfo(false);
    return new LeasedIncrementalServer(server, release, lifetime);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    void this.lifetime.catch(() => { /* best-effort release */ });
  }
}

export class TypstPreviewController {
  private readonly compiler: TypstCompiler;
  private readonly renderer: TypstRendererWithSession;
  private readonly accessModel: BrowserAccessModel;
  private readonly themeSources: string[];
  private initPromise: Promise<void> | null = null;
  private incrementalServer: LeasedIncrementalServer | null = null;
  private renderSession: RenderSession | null = null;
  private needsReset = true;
  private rendering = false;
  private pendingSource: string | null = null;
  private pendingWaiters: Array<{
    resolve: () => void;
    reject: (reason?: unknown) => void;
  }> = [];

  constructor(private readonly host: HTMLElement, themeSources: string[]) {
    this.themeSources = themeSources;
    this.compiler = createTypstCompiler();
    this.renderer = createTypstRenderer() as TypstRendererWithSession;
    this.accessModel = new BrowserAccessModel(window.location.href);
  }

  async render(markdown: string, themeSource: string): Promise<void> {
    const source = themeSource + '\n' + renderToTypstFromString(markdown);
    return new Promise<void>((resolve, reject) => {
      this.pendingSource = source;
      this.pendingWaiters.push({ resolve, reject });
      if (!this.rendering) {
        void this.drainRenderQueue();
      }
    });
  }

  showError(message: string): void {
    const card = this.ensureErrorCard();
    const body = card.querySelector('pre');
    if (body) {
      body.textContent = message;
    }
  }

  private ensureRuntime(): Promise<void> {
    this.initPromise ??= this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const themeFontUrls = uniq(this.themeSources.flatMap((source) => collectThemeFontUrls(source)));
    const fontUrls = uniq([...themeFontUrls, ...bundledFontUrls]);

    await this.compiler.init({
      getModule: () => compilerWasmUrl,
      beforeBuild: [
        loadFonts(fontUrls, { assets: false }),
        initOptions.withAccessModel(this.accessModel),
      ],
    });
    await this.renderer.init({
      getModule: () => rendererWasmUrl,
    });
    this.incrementalServer = await LeasedIncrementalServer.create(this.compiler);
  }

  private async drainRenderQueue(): Promise<void> {
    this.rendering = true;
    try {
      await this.ensureRuntime();

      while (this.pendingSource !== null) {
        const source = this.pendingSource;
        const waiters = this.pendingWaiters;
        this.pendingSource = null;
        this.pendingWaiters = [];

        try {
          const artifact = await this.compileOnce(source);
          try {
            await this.renderArtifact(artifact);
          } catch (err) {
            if (artifact.action !== 'merge') {
              throw err;
            }
            await this.resetIncrementalState();
            await this.renderArtifact(await this.compileOnce(source));
          }
          for (const waiter of waiters) waiter.resolve();
        } catch (err) {
          for (const waiter of waiters) waiter.reject(err);
        }
      }
    } catch (err) {
      const waiters = this.pendingWaiters;
      this.pendingSource = null;
      this.pendingWaiters = [];
      for (const waiter of waiters) waiter.reject(err);
    } finally {
      this.rendering = false;
      if (this.pendingSource !== null) {
        void this.drainRenderQueue();
      }
    }
  }

  private async compileOnce(source: string): Promise<TypstCompileArtifact> {
    const incrementalServer = this.incrementalServer?.server;
    if (!incrementalServer) {
      throw new Error('Typst incremental server is not initialized.');
    }

    this.compiler.addSource('/main.typ', source);
    const result = await this.compiler.compile({
      mainFilePath: '/main.typ',
      root: '/',
      format: 'vector',
      diagnostics: 'full',
      incrementalServer,
    }) as CompileResult;

    if (!result.result) {
      throw new Error(formatDiagnostics(result));
    }

    const action: TypstCompileArtifact['action'] = this.needsReset ? 'reset' : 'merge';
    this.needsReset = false;
    return { action, data: result.result };
  }

  private async renderArtifact(artifact: TypstCompileArtifact): Promise<void> {
    this.clearError();

    if (!this.renderSession || artifact.action === 'reset') {
      if (this.renderSession) {
        this.renderer.resetSession(this.renderSession);
      }
      const session = await this.renderer.createModule(artifact.data);
      this.renderSession = session;
      this.host.innerHTML = await session.renderSvg({});
      addPreviewPageGaps(this.host);
      return;
    }

    this.renderSession.manipulateData({ action: 'merge', data: artifact.data });
    replaceOrPatchSvg(this.host, this.renderSession.renderSvgDiff({}));
    addPreviewPageGaps(this.host);
  }

  private async resetIncrementalState(): Promise<void> {
    this.needsReset = true;
    if (this.renderSession) {
      this.renderer.resetSession(this.renderSession);
      this.renderSession = null;
    }
    this.incrementalServer?.server.reset();
    await this.compiler.reset();
  }

  private ensureErrorCard(): HTMLDivElement {
    const existing = this.host.querySelector(':scope > .typst-error-card');
    if (existing instanceof HTMLDivElement) {
      return existing;
    }

    const card = document.createElement('div');
    card.className = 'typst-error-card';
    card.innerHTML = `
      <div class="typst-error-title">Typst preview error</div>
      <pre></pre>
    `;
    this.host.appendChild(card);
    return card;
  }

  private clearError(): void {
    this.host.querySelector(':scope > .typst-error-card')?.remove();
  }
}
