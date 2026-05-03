import * as vscode from 'vscode';
import * as path from 'path';
import { renderBodyHtml, buildWebviewHtml } from './htmlPreview';
import {
  TypstIncrementalSession,
  TypstCompileError,
  buildFullTypst,
  buildTypstWebviewHtml,
} from './typst';

interface PanelEntry {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  mode: string;
  theme: string;
  typstSession: TypstIncrementalSession | null;
  typstSessionInit: Promise<TypstIncrementalSession> | null;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  webviewReady: boolean;
  typstRenderVersion: number;
}

// One panel per document URI
const panels = new Map<string, PanelEntry>();

// Diagnostics for Typst compile errors — shown in Problems panel
const diagnostics = vscode.languages.createDiagnosticCollection('mdf-typst');

// Persistent output channel — every compile/render error goes here so users
// can read the full history. Exposed via the `mdf.showOutput` command.
export const outputChannel = vscode.window.createOutputChannel('mdf', { log: true });

function logError(prefix: string, err: unknown): string {
  const detail = err instanceof TypstCompileError
    ? err.message
    : (err instanceof Error ? (err.stack || err.message) : String(err));
  outputChannel.appendLine(`[${prefix}] ${detail}`);
  return detail;
}

function setTypstDiagnostics(uri: vscode.Uri, err: unknown): void {
  if (err instanceof TypstCompileError) {
    const items = err.diagnostics.map((d) => {
      const isError = typeof d.severity === 'number'
        ? d.severity === 1
        : String(d.severity).toLowerCase() === 'error';
      const diag = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        d.message,
        isError ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
      );
      diag.source = 'mdf (typst)';
      return diag;
    });
    diagnostics.set(uri, items);
  } else {
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      err instanceof Error ? (err.message || String(err)) : String(err),
      vscode.DiagnosticSeverity.Error,
    );
    diag.source = 'mdf (typst)';
    diagnostics.set(uri, [diag]);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function currentMode(): string {
  return vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
}

function currentTheme(): string {
  return vscode.workspace.getConfiguration('mdf').get<string>('theme', 'default');
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
      if (/^https?:\/\/|^data:/i.test(src)) return _match;
      const absPath = path.isAbsolute(src) ? src : path.resolve(docDir, src);
      const uri = webview.asWebviewUri(vscode.Uri.file(absPath));
      return `${prefix}${quote}${uri}${quote}`;
    },
  );
}

async function getOrCreateSession(
  entry: PanelEntry,
  context: vscode.ExtensionContext,
): Promise<TypstIncrementalSession> {
  if (entry.typstSession) return entry.typstSession;
  if (!entry.typstSessionInit) {
    const workspace = path.dirname(entry.document.uri.fsPath);
    entry.typstSessionInit = TypstIncrementalSession.create(context, workspace).then((s) => {
      entry.typstSession = s;
      return s;
    });
  }
  return entry.typstSessionInit;
}

function disposeSession(entry: PanelEntry): void {
  entry.typstSession?.dispose();
  entry.typstSession = null;
  entry.typstSessionInit = null;
}

/** Fully set the webview HTML for the given mode (resets the webview). */
function setWebviewContent(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  entry: PanelEntry,
): void {
  const content = entry.document.getText();
  const workspace = path.dirname(entry.document.uri.fsPath);
  const { mode, theme } = entry;

  if (mode === 'typst') {
    entry.webviewReady = false;
    panel.webview.html = buildTypstWebviewHtml(panel, context);
  } else {
    try {
      const bodyHtml = rewriteImageSrcs(renderBodyHtml(content), panel.webview, workspace);
      panel.webview.html = buildWebviewHtml(panel, context, bodyHtml, theme);
    } catch (err) {
      panel.webview.html = errorHtml(err instanceof Error ? (err.stack || err.message) : String(err));
    }
  }
}

/** Send a live update via postMessage (does not reset the webview). */
async function postUpdate(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  entry: PanelEntry,
): Promise<void> {
  const content = entry.document.getText();
  const workspace = path.dirname(entry.document.uri.fsPath);
  const { mode } = entry;

  if (mode === 'typst') {
    if (!entry.webviewReady) {
      // Webview hasn't said 'ready' yet — defer. It will call us via ready.
      return;
    }
    try {
      const session = await getOrCreateSession(entry, context);
      session.setWorkspace(workspace);
      const renderVersion = ++entry.typstRenderVersion;
      const typstSource = buildFullTypst(context.extensionPath, content);
      const artifact = await session.compile(typstSource);
      if (renderVersion !== entry.typstRenderVersion) return;
      panel.webview.postMessage({
        type: 'render',
        action: artifact.action,
        data: artifact.data,
        version: renderVersion,
      });
      diagnostics.delete(entry.document.uri);
    } catch (err) {
      const detail = logError('live compile', err);
      setTypstDiagnostics(entry.document.uri, err);
      panel.webview.postMessage({ type: 'error', message: detail });
    }
    return;
  }

  try {
    const bodyHtml = rewriteImageSrcs(renderBodyHtml(content), panel.webview, workspace);
    panel.webview.postMessage({ type: 'update', html: bodyHtml });
  } catch (err) {
    panel.webview.postMessage({
      type: 'update',
      html: `<pre style="color:red;white-space:pre-wrap">${escapeHtml(String(err))}</pre>`,
    });
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
  const theme = currentTheme();

  const panel = vscode.window.createWebviewPanel(
    'mdfPreview',
    `Preview: ${path.basename(document.fileName)}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'out', 'assets')),
        vscode.Uri.file(path.join(context.extensionPath, 'out', 'media')),
        vscode.Uri.file(path.join(context.extensionPath, 'media')),
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        ...(vscode.workspace.workspaceFolders?.map(f => f.uri) ?? []),
      ],
      retainContextWhenHidden: true,
    },
  );

  const entry: PanelEntry = {
    panel, document, mode, theme,
    typstSession: null,
    typstSessionInit: null,
    pendingTimer: null,
    webviewReady: false,
    typstRenderVersion: 0,
  };
  panels.set(docUri, entry);

  // Initial render
  setWebviewContent(panel, context, entry);

  // Live update on keystroke — debounced per panel
  const changeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() !== docUri) return;
    const ent = panels.get(docUri);
    if (!ent) return;

    if (ent.pendingTimer !== null) {
      clearTimeout(ent.pendingTimer);
    }
    // The Typst pipeline now coalesces to the latest source and ships deltas,
    // but a slightly wider debounce still avoids thrashing on bursty typing.
    const delay = ent.mode === 'typst' ? 30 : 80;
    ent.pendingTimer = setTimeout(() => {
      ent.pendingTimer = null;
      void postUpdate(ent.panel, context, ent);
    }, delay);
  });

  // Mode/theme switch: dispose session if leaving typst, then fully reload
  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('mdf.mode') && !e.affectsConfiguration('mdf.theme')) return;
    const ent = panels.get(docUri);
    if (!ent) return;
    const newMode = currentMode();
    if (newMode !== ent.mode) {
      disposeSession(ent);
    }
    ent.mode = newMode;
    ent.theme = currentTheme();
    setWebviewContent(ent.panel, context, ent);
  });

  // Handle messages from webview (theme selector + ready signal + show-output).
  const messageDisposable = panel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'switchTheme') {
      vscode.workspace.getConfiguration('mdf').update('theme', msg.theme, vscode.ConfigurationTarget.Global);
    } else if (msg.type === 'ready') {
      const ent = panels.get(docUri);
      if (ent && ent.mode === 'typst') {
        ent.webviewReady = true;
        // A recreated webview starts with a fresh renderer session, but the
        // extension-side incremental compiler may still be holding onto the
        // previous delta chain. Force the next artifact to be a full reset so
        // detached/restored preview windows do not receive a merge delta first.
        ent.typstSession?.reset();
        void postUpdate(ent.panel, context, ent);
      }
    } else if (msg.type === 'showOutput') {
      outputChannel.show();
    } else if (msg.type === 'log') {
      // Forwarded console output from the webview. Visible in the mdf
      // Output channel so we can diagnose render issues without asking
      // the user to open webview DevTools.
      const level = typeof msg.level === 'string' ? msg.level : 'info';
      outputChannel.appendLine(`[webview:${level}] ${String(msg.message ?? '')}`);
    }
  });

  panel.onDidDispose(() => {
    panels.delete(docUri);
    if (entry.pendingTimer !== null) {
      clearTimeout(entry.pendingTimer);
    }
    diagnostics.delete(entry.document.uri);
    disposeSession(entry);
    changeDisposable.dispose();
    configDisposable.dispose();
    messageDisposable.dispose();
  });
}

export function disposeAll(): void {
  for (const entry of panels.values()) {
    entry.panel.dispose();
  }
  panels.clear();
  diagnostics.clear();
}

function errorHtml(msg: string): string {
  return `<!DOCTYPE html><html><body><pre style="color:red;padding:20px">${escapeHtml(msg)}</pre></body></html>`;
}
