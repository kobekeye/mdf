import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TypstCompileError, TypstDiagnostic } from './diagnostics';
import { resolveFontDirs, legacyFontDirsForPdf } from './fonts';
import { buildFullTypst } from './template';

// ─── Node compiler types ─────────────────────────────────────────────────────

interface CompileArgs {
  workspace?: string;
  fontArgs?: Array<{ fontPaths: string[] }>;
}

interface CompileDocArgs {
  mainFilePath?: string;
  mainFileContent?: string;
  resetRead?: boolean;
}

interface NodeError {
  readonly shortDiagnostics: TypstDiagnostic[];
}

interface NodeTypstCompileResult {
  readonly result: unknown;
  hasError(): boolean;
  takeDiagnostics(): NodeError | null;
}

interface NodeCompilerInstance {
  evictCache(maxAge: number): void;
  compile(opts: CompileDocArgs): NodeTypstCompileResult;
  fetchDiagnostics(diag: NodeError): TypstDiagnostic[];
  svg(docOrOpts: unknown): string;
  pdf(docOrOpts: unknown): Buffer;
}

function loadNodeCompiler(extensionPath: string): {
  NodeCompiler: { create: (opts: CompileArgs) => NodeCompilerInstance };
} {
  const bundled = path.join(
    extensionPath, 'out', 'compiler', 'node_modules', '@myriaddreamin', 'typst-ts-node-compiler',
  );
  if (!fs.existsSync(bundled)) {
    throw new Error('Typst node compiler not found in extension bundle. Reinstall or recompile the extension.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(bundled);
}

function extractNodeDiagnostics(compiler: NodeCompilerInstance, raw: NodeError | null): TypstDiagnostic[] {
  if (!raw) return [];
  try {
    const full = compiler.fetchDiagnostics(raw);
    if (Array.isArray(full) && full.length > 0) return full;
  } catch { /* fall through */ }
  return raw.shortDiagnostics || [];
}

/**
 * Node-compiler path — used for PDF export only. Preview no longer uses it
 * (preview goes through TypstIncrementalSession + the WASM compiler).
 */
export class TypstPdfCompilerSession {
  private compiler: NodeCompilerInstance;

  constructor(workspace: string, extensionPath: string, context?: vscode.ExtensionContext) {
    const { NodeCompiler } = loadNodeCompiler(extensionPath);
    const fontPaths = context ? resolveFontDirs(context) : legacyFontDirsForPdf();
    this.compiler = NodeCompiler.create({
      workspace,
      fontArgs: fontPaths.length > 0 ? [{ fontPaths }] : undefined,
    });
  }

  private compileDoc(typstSource: string): unknown {
    const result = this.compiler.compile({
      mainFileContent: typstSource,
      resetRead: false,
    });
    if (result.hasError()) {
      throw new TypstCompileError(extractNodeDiagnostics(this.compiler, result.takeDiagnostics()));
    }
    const doc = result.result;
    if (!doc) {
      throw new TypstCompileError([
        { message: 'compile() returned no document', path: '', range: null, severity: 1 },
      ]);
    }
    return doc;
  }

  pdf(typstSource: string): Buffer {
    const doc = this.compileDoc(typstSource);
    const out = this.compiler.pdf(doc);
    try { this.compiler.evictCache(30); } catch { /* hygiene-only */ }
    return out;
  }

  dispose(): void { /* release reference; GC collects the native object */ }
}

export function compileToPdf(
  extensionPath: string,
  content: string,
  workspace: string,
  theme = 'default',
  context?: vscode.ExtensionContext,
): Buffer {
  const session = new TypstPdfCompilerSession(workspace, extensionPath, context);
  try {
    return session.pdf(buildFullTypst(extensionPath, content, theme));
  } finally {
    session.dispose();
  }
}
