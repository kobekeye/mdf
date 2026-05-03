import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TypstCompileError, normalizeWasmDiagnostics } from './diagnostics';
import { resolveFontDirs, readFontsFromDirs, readBundledTypstFonts } from './fonts';

// ─── typst.ts CJS surface ────────────────────────────────────────────────────

type CompileResult = {
  result?: Uint8Array;
  diagnostics?: unknown[];
};

type TypstIncrementalServer = {
  reset(): void;
  current(): Uint8Array | undefined;
  setAttachDebugInfo(enable: boolean): void;
};

type WebTypstCompiler = {
  init(opts: unknown): Promise<void>;
  addSource(path: string, source: string): void;
  compile(opts: unknown): Promise<CompileResult>;
  reset(): Promise<void>;
  withIncrementalServer<T>(f: (server: TypstIncrementalServer) => Promise<T>): Promise<T>;
};

type TypstTsModule = { createTypstCompiler(): WebTypstCompiler };

type FontAssetName = 'text' | 'cjk' | 'emoji';
type OptionsInitModule = {
  loadFonts(
    fonts: (Uint8Array | string)[],
    opts?: { assets?: FontAssetName[] | false },
  ): unknown;
  withAccessModel(model: unknown): unknown;
};

let cachedTypstTs: TypstTsModule | null = null;
let cachedOptionsInit: OptionsInitModule | null = null;
let cachedCompilerWasm: Uint8Array | null = null;

function loadTypstTsModules(extensionPath: string): {
  compiler: TypstTsModule;
  optionsInit: OptionsInitModule;
  wasmBytes: Uint8Array;
} {
  if (!cachedTypstTs || !cachedOptionsInit || !cachedCompilerWasm) {
    const pkgDir = path.join(
      extensionPath, 'out', 'compiler', 'node_modules', '@myriaddreamin', 'typst.ts',
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedTypstTs = require(path.join(pkgDir, 'dist', 'cjs', 'compiler.cjs')) as TypstTsModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedOptionsInit = require(path.join(pkgDir, 'dist', 'cjs', 'options.init.cjs')) as OptionsInitModule;

    const wasmPath = path.join(
      extensionPath, 'out', 'compiler', 'node_modules', '@myriaddreamin',
      'typst-ts-web-compiler', 'pkg', 'typst_ts_web_compiler_bg.wasm',
    );
    cachedCompilerWasm = new Uint8Array(fs.readFileSync(wasmPath));
  }
  return { compiler: cachedTypstTs, optionsInit: cachedOptionsInit, wasmBytes: cachedCompilerWasm };
}

// ─── FS access model ─────────────────────────────────────────────────────────

// Shape the WASM compiler expects; mirrors MemoryAccessModel in
// typst.ts/dist/cjs/fs/memory.cjs.
interface FsAccessModel {
  getMTime(p: string): Date | undefined;
  isFile(p: string): boolean | undefined;
  getRealPath(p: string): string | undefined;
  readAll(p: string): Uint8Array | undefined;
}

/**
 * Node-backed access model. Maps virtual absolute paths (starting with `/`)
 * onto files under a configurable workspace root, so `#image("foo.png")` and
 * relative imports resolve to files next to the previewed markdown.
 *
 * Each preview panel owns one session, so the workspace root rarely changes.
 * When it does, we also reset the compiler — Typst caches file reads, so a
 * stale cache would otherwise survive the move.
 */
class NodeFsAccessModel implements FsAccessModel {
  root: string;
  constructor(root: string) { this.root = root; }

  private resolve(p: string): string {
    return path.join(this.root, p.replace(/^\/+/, ''));
  }

  getMTime(p: string): Date | undefined {
    try { return fs.statSync(this.resolve(p)).mtime; } catch { return undefined; }
  }

  isFile(p: string): boolean {
    try { return fs.statSync(this.resolve(p)).isFile(); } catch { return false; }
  }

  // Typst uses this as an identity key, not as a real-filesystem probe.
  getRealPath(p: string): string { return p; }

  readAll(p: string): Uint8Array | undefined {
    try { return new Uint8Array(fs.readFileSync(this.resolve(p))); } catch { return undefined; }
  }
}

// ─── Incremental compile session ─────────────────────────────────────────────

const MAIN_PATH = '/main.typ';

export interface TypstCompileArtifact {
  action: 'reset' | 'merge';
  data: Uint8Array;
}

/**
 * The typst.ts compiler exposes its incremental server only through a
 * `withIncrementalServer(callback)` lifetime. We open the lifetime once and
 * bridge it to a Disposable: the callback stays suspended on `releaseSignal`
 * until `dispose()` resolves it.
 */
class LeasedIncrementalServer {
  readonly server: TypstIncrementalServer;
  private readonly release: () => void;
  private readonly lifetime: Promise<unknown>;
  private disposed = false;

  private constructor(
    server: TypstIncrementalServer,
    release: () => void,
    lifetime: Promise<unknown>,
  ) {
    this.server = server;
    this.release = release;
    this.lifetime = lifetime;
  }

  static async create(compiler: WebTypstCompiler): Promise<LeasedIncrementalServer> {
    let resolveServer!: (server: TypstIncrementalServer) => void;
    let rejectServer!: (reason?: unknown) => void;
    const serverReady = new Promise<TypstIncrementalServer>((resolve, reject) => {
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
    return new LeasedIncrementalServer(server, release, lifetime);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    void this.lifetime.catch(() => { /* best-effort */ });
  }
}

/**
 * Preview compile session (WASM web compiler).
 *
 * Keeps both the compiler and the typst.ts incremental server alive across
 * edits. Each compile produces the latest delta against the server's current
 * state; the webview applies that delta to its long-lived render session
 * instead of rebuilding the full SVG tree on every keystroke.
 */
export class TypstIncrementalSession {
  private compiler!: WebTypstCompiler;
  private incrementalServer!: LeasedIncrementalServer;
  private accessModel!: NodeFsAccessModel;
  private disposed = false;
  private needsReset = true;
  private compiling = false;
  private pendingSource: string | null = null;
  private pendingWaiters: Array<{
    resolve: (value: TypstCompileArtifact) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  private constructor() { /* use create() */ }

  static async create(
    context: vscode.ExtensionContext,
    workspace: string,
  ): Promise<TypstIncrementalSession> {
    const session = new TypstIncrementalSession();
    await session.initialize(context, workspace);
    return session;
  }

  private async initialize(
    context: vscode.ExtensionContext,
    workspace: string,
  ): Promise<void> {
    const { compiler: typstTs, optionsInit, wasmBytes } = loadTypstTsModules(context.extensionPath);

    // Keep user-installed fonts first, then fall back to the bundled Typst
    // text/math set (includes NewCMMath for formulas). Avoids the default
    // typst.ts CDN fetch path during preview startup.
    const fontBytes = [
      ...readFontsFromDirs(resolveFontDirs(context)),
      ...readBundledTypstFonts(context.extensionPath),
    ];
    this.accessModel = new NodeFsAccessModel(workspace);
    const beforeBuild: unknown[] = [
      optionsInit.loadFonts(fontBytes, { assets: false }),
      optionsInit.withAccessModel(this.accessModel),
    ];

    const compiler = typstTs.createTypstCompiler();
    await compiler.init({ getModule: () => wasmBytes, beforeBuild });
    this.compiler = compiler;
    this.incrementalServer = await LeasedIncrementalServer.create(compiler);
    this.incrementalServer.server.setAttachDebugInfo(false);
  }

  async compile(typstSource: string): Promise<TypstCompileArtifact> {
    if (this.disposed) throw new Error('TypstIncrementalSession is disposed');
    return new Promise<TypstCompileArtifact>((resolve, reject) => {
      this.pendingSource = typstSource;
      this.pendingWaiters.push({ resolve, reject });
      if (!this.compiling) {
        void this.drainCompileQueue();
      }
    });
  }

  reset(): void {
    if (this.disposed) return;
    this.needsReset = true;
    this.incrementalServer.server.reset();
    void this.compiler.reset().catch(() => { /* best-effort */ });
  }

  /**
   * Retarget the FS access model at a new workspace dir. Reset the compiler
   * too, so files cached from the previous workspace don't linger.
   */
  setWorkspace(workspace: string): void {
    if (this.accessModel.root === workspace) return;
    this.accessModel.root = workspace;
    this.reset();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const err = new Error('TypstIncrementalSession is disposed');
    for (const waiter of this.pendingWaiters) waiter.reject(err);
    this.pendingWaiters = [];
    this.pendingSource = null;
    this.incrementalServer.dispose();
  }

  private async drainCompileQueue(): Promise<void> {
    this.compiling = true;
    try {
      while (this.pendingSource !== null) {
        const source = this.pendingSource;
        const waiters = this.pendingWaiters;
        this.pendingSource = null;
        this.pendingWaiters = [];
        try {
          const result = await this.compileOnce(source);
          for (const waiter of waiters) waiter.resolve(result);
        } catch (err) {
          for (const waiter of waiters) waiter.reject(err);
        }
      }
    } finally {
      this.compiling = false;
    }
  }

  private async compileOnce(typstSource: string): Promise<TypstCompileArtifact> {
    if (this.disposed) throw new Error('TypstIncrementalSession is disposed');

    this.compiler.addSource(MAIN_PATH, typstSource);

    const result = await this.compiler.compile({
      mainFilePath: MAIN_PATH,
      // Root the Typst project at the virtual FS root, so #image("foo.png")
      // and relative imports route through the FsAccessModel onto the real
      // workspace directory.
      root: '/',
      format: 'vector',
      diagnostics: 'full',
      incrementalServer: this.incrementalServer.server,
    });

    if (!result.result) {
      throw new TypstCompileError(normalizeWasmDiagnostics(result.diagnostics));
    }

    const action: TypstCompileArtifact['action'] = this.needsReset ? 'reset' : 'merge';
    this.needsReset = false;
    return { action, data: result.result };
  }
}
