import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export function safeIsDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function resolveFontDirs(context: vscode.ExtensionContext): string[] {
  const dirs: string[] = [];
  const gs = path.join(context.globalStorageUri.fsPath, 'fonts');
  if (safeIsDir(gs)) dirs.push(gs);
  const legacy = path.join(os.homedir(), '.mdf', 'fonts');
  if (safeIsDir(legacy)) dirs.push(legacy);
  return dirs;
}

export function readFontsFromDirs(dirs: string[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const dir of dirs) {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/\.(ttf|otf|ttc|woff2?)$/i.test(name)) continue;
      try {
        out.push(new Uint8Array(fs.readFileSync(path.join(dir, name))));
      } catch { /* skip unreadable */ }
    }
  }
  return out;
}

export function readBundledTypstFonts(extensionPath: string): Uint8Array[] {
  const fontDir = path.join(extensionPath, 'out', 'assets', 'typst-assets', 'fonts');
  let names: string[];
  try {
    names = fs.readdirSync(fontDir);
  } catch {
    throw new Error(
      'Bundled Typst fonts are missing from the extension bundle. Reinstall or recompile the extension.',
    );
  }

  const out: Uint8Array[] = [];
  for (const name of names) {
    if (!/\.(ttf|otf)$/i.test(name)) continue;
    out.push(new Uint8Array(fs.readFileSync(path.join(fontDir, name))));
  }

  if (out.length === 0) {
    throw new Error(
      'Bundled Typst fonts were found, but no font files were readable. Reinstall or recompile the extension.',
    );
  }
  return out;
}

export function legacyFontDirsForPdf(): string[] {
  return [path.join(os.homedir(), '.mdf', 'fonts')].filter(safeIsDir);
}
