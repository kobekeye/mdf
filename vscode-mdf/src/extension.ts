import * as vscode from 'vscode';
import { openOrRevealPreview, disposeAll, outputChannel } from './previewProvider';
import { registerExportPdfCommand } from './exportPdf';
import { registerMathCompletions } from './completions';

export function activate(context: vscode.ExtensionContext): void {
  applyMarkdownEditorDefaults();
  registerStatusBar(context);
  registerExportPdfCommand(context);
  registerMathCompletions(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('mdf.switchMode', async () => {
      const cfg = vscode.workspace.getConfiguration('mdf');
      const current = cfg.get<string>('mode', 'html');
      const next = current === 'html' ? 'typst' : 'html';
      await cfg.update('mode', next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`mdf: switched to ${next.toUpperCase()} mode`);
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

// Mode-toggle status bar item. Visible only while a markdown file is active;
// clicking it cycles HTML ⇄ Typst via the `mdf.switchMode` command.
function registerStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'mdf.switchMode';
  item.tooltip = 'mdf: click to switch HTML / Typst mode';
  context.subscriptions.push(item);

  function update(): void {
    const mode = vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
    item.text = `MDF: ${mode.toUpperCase()}`;
  }

  function syncVisibility(): void {
    const lang = vscode.window.activeTextEditor?.document.languageId;
    if (lang === 'markdown') item.show();
    else item.hide();
  }

  update();
  syncVisibility();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(syncVisibility),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mdf.mode')) update();
    }),
  );
}
