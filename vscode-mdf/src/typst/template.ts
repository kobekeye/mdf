import * as path from 'path';
import * as fs from 'fs';

// Bundled by esbuild from the CLI's renderer.
type MdTypstRenderer = { renderToTypstFromString: (md: string) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const typstRenderer = require('../../../src/typst-renderer') as MdTypstRenderer;

let cachedTemplate: string | null = null;
let cachedTemplatePath: string | null = null;

function getTemplate(extensionPath: string): string {
  const templatePath = path.join(extensionPath, 'out', 'assets', 'default.typ');
  if (cachedTemplate && cachedTemplatePath === templatePath) return cachedTemplate;
  cachedTemplate = fs.readFileSync(templatePath, 'utf-8');
  cachedTemplatePath = templatePath;
  return cachedTemplate;
}

export function buildFullTypst(extensionPath: string, content: string): string {
  return getTemplate(extensionPath) + '\n' + typstRenderer.renderToTypstFromString(content);
}
