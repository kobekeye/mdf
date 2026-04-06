import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Bundled by esbuild at build time (resolved from ../../src/renderer.js)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderBodyHtmlFromString } = require('../../src/renderer') as {
  renderBodyHtmlFromString: (md: string) => string;
};

export function renderBodyHtml(content: string): string {
  return renderBodyHtmlFromString(content);
}

/**
 * Parse @mdf-fonts metadata from theme CSS content and build a Google Fonts URL.
 * e.g. "Inter:400,700; Noto Sans TC:400,700" → Google Fonts CSS2 URL
 */
function buildGoogleFontsUrl(themeCss: string): string | null {
  const match = themeCss.match(/\/\*\s*@mdf-fonts:\s*([^*]+?)\s*\*\//);
  if (!match) return null;

  const families = match[1].trim().split(';').map(s => s.trim()).filter(Boolean);
  const params = families.map(spec => {
    const colonIdx = spec.lastIndexOf(':');
    if (colonIdx === -1) return null;
    const family = spec.slice(0, colonIdx).trim().replace(/ /g, '+');
    const weights = spec.slice(colonIdx + 1).split(',').map(w => w.trim()).filter(Boolean);
    return `family=${family}:wght@${weights.join(';')}`;
  }).filter(Boolean);

  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

const AVAILABLE_THEMES = ['default', 'asterisk'];

export function buildWebviewHtml(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  bodyHtml: string,
  theme: string = 'default',
): string {
  const webview = panel.webview;
  const assetsDir = path.join(context.extensionPath, 'out', 'assets');

  const toAssetUri = (filename: string) =>
    webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, filename)));

  const katexCssUri = toAssetUri('katex.min.css');
  const hljsCssUri = toAssetUri('github-dark.css');
  const texmathCssUri = toAssetUri('texmath.css');
  const themeCssUri = toAssetUri(`${theme}.css`);

  const previewCssUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'preview.css')),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'html-preview.js')),
  );

  // Parse @mdf-fonts from theme CSS to build the correct Google Fonts link
  const themeCssPath = path.join(assetsDir, `${theme}.css`);
  const themeCssContent = fs.existsSync(themeCssPath) ? fs.readFileSync(themeCssPath, 'utf-8') : '';
  const fontsUrl = buildGoogleFontsUrl(themeCssContent);
  const fontsLink = fontsUrl
    ? `<link href="${fontsUrl}" rel="stylesheet">`
    : '';

  // Build theme options for the selector
  const themeOptions = AVAILABLE_THEMES
    .map(t => `<option value="${t}"${t === theme ? ' selected' : ''}>${t}</option>`)
    .join('');

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
  ${fontsLink}
</head>
<body>
  <div id="mdf-toolbar">
    <select id="mdf-theme-select">${themeOptions}</select>
  </div>
  <div id="mdf-content">${bodyHtml}</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
