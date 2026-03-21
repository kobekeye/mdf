import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { openOrRevealPreview, disposeAll } from './previewProvider';
import { compileToPdf } from './typstPreview';

interface MathEntry {
  snippet?: string;
  detail: string;
}

type MathData = Record<string, MathEntry>;

export function activate(context: vscode.ExtensionContext): void {
  const latexData: MathData = require('../data/latex-math.json');
  const typstData: MathData = require('../data/typst-math.json');

  // ── Enable quickSuggestions for markdown ────────────────────────────────
  // VS Code's built-in [markdown] default sets quickSuggestions: off,
  // which overrides configurationDefaults. We must set it programmatically.
  // Only set if the user hasn't explicitly configured it themselves.
  const editorCfg = vscode.workspace.getConfiguration('editor', { languageId: 'markdown' });
  const qsInspect = editorCfg.inspect('quickSuggestions');
  if (!qsInspect?.globalLanguageValue && !qsInspect?.workspaceLanguageValue) {
    editorCfg.update(
      'quickSuggestions',
      { other: 'inline', comments: 'off', strings: 'off' },
      vscode.ConfigurationTarget.Global,
      true,
    );
  }
  const ssInspect = editorCfg.inspect('snippetSuggestions');
  if (!ssInspect?.globalLanguageValue && !ssInspect?.workspaceLanguageValue) {
    editorCfg.update(
      'snippetSuggestions',
      'top',
      vscode.ConfigurationTarget.Global,
      true,
    );
  }

  // ── Status bar item ──────────────────────────────────────────────────────
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'mdf.switchMode';
  statusItem.tooltip = 'mdf: click to switch HTML / Typst mode';
  context.subscriptions.push(statusItem);

  function updateStatus(): void {
    const mode = vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
    statusItem.text = `MDF: ${mode.toUpperCase()}`;
  }

  updateStatus();

  // Show only when a markdown file is active
  function syncStatusVisibility(): void {
    const lang = vscode.window.activeTextEditor?.document.languageId;
    if (lang === 'markdown') {
      statusItem.show();
    } else {
      statusItem.hide();
    }
  }

  syncStatusVisibility();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => syncStatusVisibility()),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mdf.mode')) {
        updateStatus();
      }
    }),
  );

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('mdf.switchMode', async () => {
      const current = vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
      const next = current === 'html' ? 'typst' : 'html';
      await vscode.workspace.getConfiguration('mdf').update(
        'mode',
        next,
        vscode.ConfigurationTarget.Global,
      );
      updateStatus();
      vscode.window.showInformationMessage(`mdf: switched to ${next.toUpperCase()} mode`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdf.openPreview', () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'markdown') {
        vscode.window.showWarningMessage('mdf: open a Markdown file first.');
        return;
      }
      openOrRevealPreview(context, doc);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdf.exportPdf', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'markdown') {
        vscode.window.showWarningMessage('mdf: open a Markdown file first.');
        return;
      }

      const defaultUri = vscode.Uri.file(doc.uri.fsPath.replace(/\.md$/i, '.pdf'));
      const outputUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'PDF': ['pdf'] },
        title: 'Export PDF',
      });
      if (!outputUri) return;

      const mode = vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `mdf: Exporting PDF (${mode.toUpperCase()})…` },
        async () => {
          try {
            if (mode === 'typst') {
              const workspace = path.dirname(doc.uri.fsPath);
              const pdfBuffer = await compileToPdf(context, doc.getText(), workspace);
              fs.writeFileSync(outputUri.fsPath, pdfBuffer);
            } else {
              // HTML mode: spawn the globally installed mdf CLI
              await new Promise<void>((resolve, reject) => {
                const { execFile } = require('child_process') as typeof import('child_process');
                execFile('mdf', [doc.uri.fsPath, outputUri.fsPath], (err) => {
                  if (err) reject(new Error('mdf CLI not found. Install it: npm install -g @kobekeye/mdf'));
                  else resolve();
                });
              });
            }
            vscode.window.showInformationMessage(`mdf: PDF saved to ${outputUri.fsPath}`);
          } catch (err) {
            vscode.window.showErrorMessage(`mdf: Export failed — ${String(err)}`);
          }
        },
      );
    }),
  );

  // ── Math completions ──────────────────────────────────────────────────────
  // LaTeX mode: triggered by '\', inserts \command or \snippet
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'markdown',
      {
        provideCompletionItems(): vscode.CompletionItem[] {
          const mode = vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
          if (mode !== 'html') return [];

          return Object.entries(latexData).map(([key, entry]) => {
            const label = '\\' + key;
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
            // Don't prepend '\' — the trigger character '\' stays in the document
            // and the replace range only covers the word after it
            const body = entry.snippet !== undefined ? entry.snippet : key;
            item.insertText = new vscode.SnippetString(body);
            item.filterText = label;
            item.detail = entry.detail;
            item.documentation = new vscode.MarkdownString(`\`${label}\``);
            return item;
          });
        },
      },
      '\\',
    ),
  );

  // Typst mode: no backslash prefix, Ctrl+Space inside $...$
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', {
      provideCompletionItems(): vscode.CompletionItem[] {
        const mode = vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
        if (mode !== 'typst') return [];

        return Object.entries(typstData).map(([key, entry]) => {
          const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Snippet);
          const body = entry.snippet !== undefined ? entry.snippet : key;
          item.insertText = new vscode.SnippetString(body);
          item.filterText = key;
          item.detail = entry.detail;
          item.documentation = new vscode.MarkdownString(`\`${key}\``);
          return item;
        });
      },
    }),
  );
}

export function deactivate(): void {
  disposeAll();
}
