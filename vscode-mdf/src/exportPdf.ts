import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { compileToPdf } from './typst';

export function registerExportPdfCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mdf.exportPdf', () => exportPdf(context)),
  );
}

async function exportPdf(context: vscode.ExtensionContext): Promise<void> {
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
          await exportTypstPdf(context, doc, outputUri);
        } else {
          await exportHtmlPdf(doc, outputUri);
        }
        vscode.window.showInformationMessage(`mdf: PDF saved to ${outputUri.fsPath}`);
      } catch (err) {
        vscode.window.showErrorMessage(`mdf: Export failed — ${String(err)}`);
      }
    },
  );
}

async function exportTypstPdf(
  context: vscode.ExtensionContext,
  doc: vscode.TextDocument,
  outputUri: vscode.Uri,
): Promise<void> {
  const workspace = path.dirname(doc.uri.fsPath);
  const pdfBuffer = compileToPdf(context.extensionPath, doc.getText(), workspace, context);
  fs.writeFileSync(outputUri.fsPath, pdfBuffer);
}

async function exportHtmlPdf(doc: vscode.TextDocument, outputUri: vscode.Uri): Promise<void> {
  const theme = vscode.workspace.getConfiguration('mdf').get<string>('theme', 'default');
  const cliArgs = [doc.uri.fsPath, outputUri.fsPath];
  if (theme !== 'default') cliArgs.push('--theme', theme);

  await new Promise<void>((resolve, reject) => {
    execFile('mdf', cliArgs, (err) => {
      if (err) reject(new Error('mdf CLI not found. Install it: npm install -g @kobekeye/mdf'));
      else resolve();
    });
  });
}
