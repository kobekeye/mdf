// Diagnostic shapes shared by the WASM (preview) and Node (PDF export) Typst
// compile paths, plus the error class surfaced to the rest of the extension.

export interface TypstDiagnostic {
  message: string;
  path: string;
  range: unknown;
  severity: number | string;
}

export class TypstCompileError extends Error {
  readonly diagnostics: TypstDiagnostic[];
  constructor(diagnostics: TypstDiagnostic[]) {
    super('Typst compile failed:\n' + diagnostics.map(formatDiagnostic).join('\n'));
    this.name = 'TypstCompileError';
    this.diagnostics = diagnostics;
  }
}

export function formatDiagnostic(d: TypstDiagnostic): string {
  const sev = isErrorSeverity(d.severity) ? 'error' : 'warning';
  const file = d.path ? String(d.path).split(/[\\/]/).pop() : '<main>';
  return `  [${sev}] ${file}\n      ${String(d.message).replace(/\n/g, '\n      ')}`;
}

export function isErrorSeverity(s: number | string): boolean {
  if (typeof s === 'number') return s === 1;
  return String(s).toLowerCase() === 'error';
}

export function normalizeWasmDiagnostics(diag: unknown): TypstDiagnostic[] {
  if (!Array.isArray(diag)) return [{
    message: 'compile() returned no result and no diagnostics',
    path: '',
    range: null,
    severity: 'error',
  }];
  return diag.map((d) => {
    const obj = (d ?? {}) as Record<string, unknown>;
    return {
      message: String(obj.message ?? d),
      path: String(obj.path ?? ''),
      range: obj.range ?? null,
      severity: (obj.severity as string) ?? 'error',
    };
  });
}
