import * as vscode from 'vscode';
import * as path from 'path';

// Bundled by esbuild at build time (resolved from ../../src/renderer.js)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderBodyHtmlFromString } = require('../../src/renderer') as {
  renderBodyHtmlFromString: (md: string) => string;
};

export function renderBodyHtml(content: string): string {
  return renderBodyHtmlFromString(content);
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function buildWebviewHtml(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  bodyHtml: string,
): string {
  const webview = panel.webview;
  const assetsDir = path.join(context.extensionPath, 'out', 'assets');

  const toAssetUri = (filename: string) =>
    webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, filename)));

  const katexCssUri = toAssetUri('katex.min.css');
  const hljsCssUri = toAssetUri('github-dark.css');
  const texmathCssUri = toAssetUri('texmath.css');
  const themeCssUri = toAssetUri('default.css');

  const previewCssUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'preview.css')),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'html-preview.js')),
  );

  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${webview.cspSource} https://fonts.gstatic.com`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} https: data:`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${katexCssUri}">
  <link rel="stylesheet" href="${hljsCssUri}">
  <link rel="stylesheet" href="${texmathCssUri}">
  <link rel="stylesheet" href="${themeCssUri}">
  <link rel="stylesheet" href="${previewCssUri}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Noto+Sans+TC:wght@400;700&display=swap" rel="stylesheet">
</head>
<body>
  <div id="mdf-content">${bodyHtml}</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
