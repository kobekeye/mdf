import * as vscode from 'vscode';
import {
  openOrRevealPreview,
  disposeAll,
  outputChannel,
  getPreviewState,
  togglePreviewModeForDocument,
  onDidChangePreviewState,
} from './previewProvider';
import { registerExportPdfCommand } from './exportPdf';
import { registerMathCompletions } from './completions';

export function activate(context: vscode.ExtensionContext): void {
  applyMarkdownEditorDefaults();
  registerStatusBar(context);
  registerExportPdfCommand(context);
  registerMathCompletions(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('mdf.switchMode', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'markdown') {
        vscode.window.showWarningMessage('mdf: open a Markdown file first.');
        return;
      }
      if (!togglePreviewModeForDocument(context, doc)) {
        vscode.window.showWarningMessage('mdf: open the preview panel first.');
        return;
      }
      const state = getPreviewState(doc);
      if (state) {
        vscode.window.showInformationMessage(`mdf: switched preview to ${state.mode.toUpperCase()} mode`);
      }
    }),
    vscode.commands.registerCommand('mdf.showOutput', () => outputChannel.show()),
    vscode.commands.registerCommand('mdf.openPreview', () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'markdown') {
        vscode.window.showWarningMessage('mdf: open a Markdown file first.');
        return;
      }
      openOrRevealPreview(context, doc);
    }),
  );
}

export function deactivate(): void {
  disposeAll();
}

// VSCode's built-in [markdown] default sets quickSuggestions: off, which
// overrides configurationDefaults. Set it programmatically — but only when
// the user hasn't explicitly configured it themselves.
function applyMarkdownEditorDefaults(): void {
  const cfg = vscode.workspace.getConfiguration('editor', { languageId: 'markdown' });

  const qs = cfg.inspect('quickSuggestions');
  if (!qs?.globalLanguageValue && !qs?.workspaceLanguageValue) {
    cfg.update(
      'quickSuggestions',
      { other: 'inline', comments: 'off', strings: 'off' },
      vscode.ConfigurationTarget.Global,
      true,
    );
  }

  const ss = cfg.inspect('snippetSuggestions');
  if (!ss?.globalLanguageValue && !ss?.workspaceLanguageValue) {
    cfg.update('snippetSuggestions', 'top', vscode.ConfigurationTarget.Global, true);
  }
}

// Mode-toggle status bar item. Visible only while the active markdown file has
// an MDF preview panel; clicking it cycles that panel between HTML and Typst.
function registerStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'mdf.switchMode';
  item.tooltip = 'mdf: click to switch the current preview panel mode';
  context.subscriptions.push(item);

  function update(): void {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || doc.languageId !== 'markdown') {
      item.hide();
      return;
    }
    const state = getPreviewState(doc);
    if (!state) {
      item.hide();
      return;
    }
    item.text = `MDF: ${state.mode.toUpperCase()}`;
    item.show();
  }

  update();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update),
    onDidChangePreviewState(update),
  );
}
