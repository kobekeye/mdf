import * as path from 'path';
import * as fs from 'fs';

// Bundled by esbuild from the CLI's renderer.
type MdTypstRenderer = { renderToTypstFromString: (md: string) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const typstRenderer = require('../../../src/typst-renderer') as MdTypstRenderer;

type CachedTemplate = {
  content: string;
  mtimeMs: number;
};

const templateCache = new Map<string, CachedTemplate>();

function getTemplatePath(extensionPath: string, theme: string): string {
  const templatePath = path.join(extensionPath, 'out', 'assets', `${theme}.typ`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Typst theme template not found: ${theme}`);
  }
  return templatePath;
}

function getTemplate(extensionPath: string, theme: string): string {
  const templatePath = getTemplatePath(extensionPath, theme);
  const mtimeMs = fs.statSync(templatePath).mtimeMs;
  const cached = templateCache.get(templatePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.content;
  const content = fs.readFileSync(templatePath, 'utf-8');
  templateCache.set(templatePath, { content, mtimeMs });
  return content;
}

export function buildFullTypst(extensionPath: string, content: string, theme = 'default'): string {
  return getTemplate(extensionPath, theme) + '\n' + typstRenderer.renderToTypstFromString(content);
}
