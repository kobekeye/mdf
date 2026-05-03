import * as vscode from 'vscode';
import * as path from 'path';

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
    top: 12px;
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
    bottom: 12px;
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
`;

export function buildTypstWebviewHtml(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
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
<div id="typst-container"></div>
<div id="typst-status"><div class="typst-loading">Loading renderer…</div></div>
<script nonce="${nonce}">
  window.TYPST_WASM_URI = ${JSON.stringify(String(rendererWasmUri))};
</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
