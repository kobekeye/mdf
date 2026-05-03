import * as vscode from 'vscode';

interface MathEntry {
  snippet?: string;
  detail: string;
}
type MathData = Record<string, MathEntry>;

/**
 * Build completion items from a math-data map. `keyToLabel` controls how the
 * completion is presented and what `filterText` matches against — LaTeX mode
 * prepends `\`, Typst mode uses the raw key.
 */
function buildMathItems(
  data: MathData,
  keyToLabel: (key: string) => string,
): vscode.CompletionItem[] {
  return Object.entries(data).map(([key, entry]) => {
    const label = keyToLabel(key);
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
    const body = entry.snippet !== undefined ? entry.snippet : key;
    item.insertText = new vscode.SnippetString(body);
    item.filterText = label;
    item.detail = entry.detail;
    item.documentation = new vscode.MarkdownString(`\`${label}\``);
    return item;
  });
}

function currentMode(): string {
  return vscode.workspace.getConfiguration('mdf').get<string>('mode', 'html');
}

export function registerMathCompletions(context: vscode.ExtensionContext): void {
  const latexData = require('../data/latex-math.json') as MathData;
  const typstData = require('../data/typst-math.json') as MathData;

  // LaTeX mode: triggered by '\'. The trigger character stays in the document,
  // and the replace range covers the word after it.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'markdown',
      {
        provideCompletionItems(): vscode.CompletionItem[] {
          if (currentMode() !== 'html') return [];
          return buildMathItems(latexData, (key) => '\\' + key);
        },
      },
      '\\',
    ),
  );

  // Typst mode: no backslash prefix, Ctrl+Space inside $...$
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', {
      provideCompletionItems(): vscode.CompletionItem[] {
        if (currentMode() !== 'typst') return [];
        return buildMathItems(typstData, (key) => key);
      },
    }),
  );
}
