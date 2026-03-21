import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type TypstRenderer = { renderToTypstFromString: (md: string) => string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeCompilerInstance = { svg: (opts: { mainFileContent: string }) => string; pdf: (opts: { mainFileContent: string }) => Buffer };

// Bundled by esbuild at build time
// eslint-disable-next-line @typescript-eslint/no-require-imports
const typstRenderer = require('../../src/typst-renderer') as TypstRenderer;

function getTemplate(extensionPath: string): string {
  const templatePath = path.join(extensionPath, 'out', 'assets', 'default.typ');
  return fs.readFileSync(templatePath, 'utf-8');
}

// ── Auto-install compiler to globalStorage ──────────────────────────────

let installDirCache: string | undefined;

async function ensureCompiler(context: vscode.ExtensionContext): Promise<void> {
  const installDir = path.join(context.globalStorageUri.fsPath, 'typst-compiler');
  installDirCache = installDir;

  const modulePath = path.join(installDir, 'node_modules', '@myriaddreamin', 'typst-ts-node-compiler');
  if (fs.existsSync(modulePath)) {
    return; // already installed
  }

  // Create install directory
  fs.mkdirSync(installDir, { recursive: true });

  // Write a minimal package.json so npm install works
  const pkgJsonPath = path.join(installDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: 'typst-compiler-install', private: true }, null, 2));
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'mdf: Installing Typst compiler (first time only)…',
      cancellable: false,
    },
    async () => {
      const { execSync } = require('child_process') as typeof import('child_process');
      const home = process.env.HOME || process.env.USERPROFILE || '';

      // For nvm users: source nvm.sh so that npm is available in child process
      const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
      const nvmSh = path.join(nvmDir, 'nvm.sh');
      const useNvm = fs.existsSync(nvmSh);
      const cmd = useNvm
        ? `. "${nvmSh}" && npm install @myriaddreamin/typst-ts-node-compiler`
        : 'npm install @myriaddreamin/typst-ts-node-compiler';

      execSync(cmd, {
        cwd: installDir,
        stdio: 'pipe',
        shell: '/bin/bash',
        env: { ...process.env, npm_config_loglevel: 'error' },
      } as any);
    },
  );

  vscode.window.showInformationMessage('mdf: Typst compiler installed successfully.');
}

function makeCompiler(workspace: string): NodeCompilerInstance {
  if (!installDirCache) {
    throw new Error('ensureCompiler() must be called before makeCompiler()');
  }
  const compilerPath = path.join(installDirCache, 'node_modules', '@myriaddreamin', 'typst-ts-node-compiler');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeCompiler } = require(compilerPath) as {
    NodeCompiler: { create: (opts: { workspace: string }) => NodeCompilerInstance };
  };
  return NodeCompiler.create({ workspace });
}

function buildFullTypst(extensionPath: string, content: string): string {
  const template = getTemplate(extensionPath);
  const body = typstRenderer.renderToTypstFromString(content);
  return template + '\n' + body;
}

export async function compileToSvg(
  context: vscode.ExtensionContext,
  content: string,
  workspace: string,
): Promise<string> {
  await ensureCompiler(context);
  const fullTypst = buildFullTypst(context.extensionPath, content);
  const $typst = makeCompiler(workspace);
  return $typst.svg({ mainFileContent: fullTypst });
}

export async function compileToPdf(
  context: vscode.ExtensionContext,
  content: string,
  workspace: string,
): Promise<Buffer> {
  await ensureCompiler(context);
  const fullTypst = buildFullTypst(context.extensionPath, content);
  const $typst = makeCompiler(workspace);
  return $typst.pdf({ mainFileContent: fullTypst });
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function buildTypstWebviewHtml(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  svgContent: string,
): string {
  const webview = panel.webview;

  const previewCssUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'preview.css')),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'typst-preview.js')),
  );

  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${previewCssUri}">
  <style>
    #typst-pages { max-width: 780px; margin: 0 auto; }
    #typst-pages svg { width: 100%; height: auto; display: block; background: #fff;
      box-shadow: 0 2px 12px rgba(0,0,0,0.10); border-radius: 4px;
      margin-bottom: 24px; }
    .typst-error { color: #c0392b; background: #fff; padding: 24px;
      font-family: monospace; white-space: pre-wrap; border-radius: 4px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.10); }
  </style>
</head>
<body>
  <div id="typst-pages">${svgContent}</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
