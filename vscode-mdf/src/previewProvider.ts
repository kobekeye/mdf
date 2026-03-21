import * as vscode from 'vscode';
import * as path from 'path';
import { renderBodyHtml, buildWebviewHtml } from './htmlPreview';
import { compileToSvg, buildTypstWebviewHtml } from './typstPreview';

interface PanelEntry {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  mode: string;
}

// One panel per document URI
const panels = new Map<string, PanelEntry>();

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function currentMode(): string {
  return vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
}

/** Rewrite relative image src attributes in HTML to webview URIs. */
function rewriteImageSrcs(
  html: string,
  webview: vscode.Webview,
  docDir: string,
): string {
  return html.replace(
    /(<img\s[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi,
    (_match, prefix, quote, src) => {
      // Skip URLs and data URIs
      if (/^https?:\/\/|^data:/i.test(src)) return _match;
      const absPath = path.isAbsolute(src) ? src : path.resolve(docDir, src);
      const uri = webview.asWebviewUri(vscode.Uri.file(absPath));
      return `${prefix}${quote}${uri}${quote}`;
    },
  );
}

/** Fully set the webview HTML for the given mode (resets the webview). */
async function setWebviewContent(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  mode: string,
): Promise<void> {
  const content = document.getText();
  const workspace = path.dirname(document.uri.fsPath);

  try {
    if (mode === 'typst') {
      const svgContent = await compileToSvg(context, content, workspace);
      panel.webview.html = buildTypstWebviewHtml(panel, context, svgContent);
    } else {
      const bodyHtml = rewriteImageSrcs(renderBodyHtml(content), panel.webview, workspace);
      panel.webview.html = buildWebviewHtml(panel, context, bodyHtml);
    }
  } catch (err) {
    panel.webview.html = errorHtml(String(err));
  }
}

/** Send a live update via postMessage (does not reset the webview). */
async function postUpdate(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  mode: string,
): Promise<void> {
  const content = document.getText();
  const workspace = path.dirname(document.uri.fsPath);

  try {
    if (mode === 'typst') {
      const svgContent = await compileToSvg(context, content, workspace);
      panel.webview.postMessage({ type: 'update', svg: svgContent });
    } else {
      const bodyHtml = rewriteImageSrcs(renderBodyHtml(content), panel.webview, workspace);
      panel.webview.postMessage({ type: 'update', html: bodyHtml });
    }
  } catch (err) {
    if (mode === 'typst') {
      panel.webview.postMessage({ type: 'update', error: String(err) });
    } else {
      panel.webview.postMessage({
        type: 'update',
        html: `<pre style="color:red;white-space:pre-wrap">${escapeHtml(String(err))}</pre>`,
      });
    }
  }
}

export function openOrRevealPreview(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): void {
  const docUri = document.uri.toString();

  // Reveal existing panel
  const existing = panels.get(docUri);
  if (existing) {
    existing.panel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  const mode = currentMode();

  const panel = vscode.window.createWebviewPanel(
    'mdfPreview',
    `Preview: ${path.basename(document.fileName)}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'out', 'assets')),
        vscode.Uri.file(path.join(context.extensionPath, 'media')),
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        ...(vscode.workspace.workspaceFolders?.map(f => f.uri) ?? []),
      ],
      retainContextWhenHidden: true,
    },
  );

  const entry: PanelEntry = { panel, document, mode };
  panels.set(docUri, entry);

  // Initial render (async)
  setWebviewContent(panel, context, document, mode);

  // Live update on every keystroke
  const changeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() !== docUri) return;
    const ent = panels.get(docUri);
    if (!ent) return;
    postUpdate(ent.panel, context, e.document, ent.mode);
  });

  // Mode switch: fully reload webview HTML for the new mode
  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('mdf.mode')) return;
    const ent = panels.get(docUri);
    if (!ent) return;
    ent.mode = currentMode();
    setWebviewContent(ent.panel, context, ent.document, ent.mode);
  });

  panel.onDidDispose(() => {
    panels.delete(docUri);
    changeDisposable.dispose();
    configDisposable.dispose();
  });
}

export function disposeAll(): void {
  for (const entry of panels.values()) {
    entry.panel.dispose();
  }
  panels.clear();
}

function errorHtml(msg: string): string {
  return `<!DOCTYPE html><html><body><pre style="color:red;padding:20px">${escapeHtml(msg)}</pre></body></html>`;
}
