import * as vscode from 'vscode';
import * as path from 'path';
import { buildPreviewControls } from '../themes';

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function getNonce(): string {
  let text = '';
  for (let i = 0; i < 32; i++) text += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  return text;
}

const STYLES = `
  html, body { background: #2a2a2a; margin: 0; padding: 0; }
  #typst-container {
    width: fit-content;
    min-width: 100%;
    margin: 0 auto;
    padding: 24px 16px 32px;
    box-sizing: border-box;
    position: relative;
  }
  #typst-container > svg {
    display: block;
    background: transparent;
    border-radius: 2px;
    box-shadow: none;
    margin: 0 auto 24px;
  }
  #typst-status {
    position: fixed;
    top: 56px;
    right: 12px;
    max-width: calc(100% - 24px);
    z-index: 10;
    pointer-events: none;
  }
  #typst-status.hidden { display: none; }
  #typst-status .typst-error {
    color: #c0392b; background: #fff; padding: 16px 20px;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
    border-radius: 4px; box-shadow: 0 2px 12px rgba(0,0,0,0.35);
    pointer-events: auto;
  }
  #typst-status .typst-error a { color: #2980b9; }
  #typst-status .typst-loading {
    color: #ddd; background: rgba(0,0,0,0.55); padding: 8px 14px;
    border-radius: 4px; font-size: 12px;
  }
  #typst-zoom-indicator {
    position: fixed;
    right: 12px;
    bottom: 72px;
    z-index: 11;
    padding: 8px 12px;
    border-radius: 4px;
    background: rgba(0,0,0,0.72);
    color: #fff;
    font: 12px/1.2 ui-sans-serif, system-ui, sans-serif;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 120ms ease, transform 120ms ease;
    pointer-events: none;
  }
  #typst-zoom-indicator.visible {
    opacity: 1;
    transform: translateY(0);
  }
  #mdf-controls {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }
  #mdf-menu-panel {
    min-width: 188px;
    padding: 12px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
    opacity: 0;
    transform: translateY(8px) scale(0.98);
    transform-origin: bottom right;
    pointer-events: none;
    transition: opacity 0.16s ease, transform 0.16s ease;
    backdrop-filter: blur(12px);
  }
  #mdf-controls.open #mdf-menu-panel {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
  #mdf-menu-toggle {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.88);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.2);
    transition: transform 0.16s ease, background 0.16s ease;
  }
  #mdf-menu-toggle:hover {
    background: rgba(15, 23, 42, 0.96);
    transform: translateY(-1px);
  }
  #mdf-menu-toggle:focus-visible {
    outline: 2px solid rgba(59, 130, 246, 0.9);
    outline-offset: 2px;
  }
  .mdf-menu-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mdf-menu-field + .mdf-menu-field {
    margin-top: 10px;
  }
  .mdf-menu-field > span {
    color: #64748b;
    font: 600 10px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  #mdf-theme-select, #mdf-mode-select {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    background-color: rgba(248, 250, 252, 0.92);
    border: 1px solid #d0d7e2;
    border-radius: 8px;
    padding: 7px 28px 7px 10px;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #333;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
  }
  #mdf-theme-select:hover, #mdf-mode-select:hover {
    background-color: #fff;
    border-color: #b8c2cf;
  }
  #mdf-theme-select:focus, #mdf-mode-select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }
`;

export function buildTypstWebviewHtml(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  theme: string,
  mode: string,
): string {
  const webview = panel.webview;

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'media', 'typst-preview.js')),
  );
  const rendererWasmUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'media', 'typst_ts_renderer_bg.wasm')),
  );

  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `img-src ${webview.cspSource} data:`,
    // Webview needs to fetch() its own wasm asset from the extension origin.
    `connect-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${STYLES}</style>
</head>
<body>
${buildPreviewControls(theme, mode)}
<div id="typst-container"></div>
<div id="typst-status"><div class="typst-loading">Loading renderer…</div></div>
<script nonce="${nonce}">
  window.TYPST_WASM_URI = ${JSON.stringify(String(rendererWasmUri))};
</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
