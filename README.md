# mdf

Convert Markdown to beautiful PDFs — free, open-source, and zero-config.

## Features

- **Syntax highlighting** — fenced code blocks with language detection (via highlight.js)
- **Math formulas** — inline and block LaTeX via KaTeX (`$...$` and `$$...$$`)
- **Table of contents** — insert `[TOC]` anywhere in your document
- **Callout blocks** — `:::info`, `:::warning`, `:::danger`, `:::success`
- **Task lists** — `- [ ]` and `- [x]`
- **Tables, images, blockquotes**
- **Manual page breaks** — insert `==page==` on its own line
- **CJK support** — uses Inter + Noto Sans TC via Google Fonts (requires internet on first run)

## Installation

```bash
npm install -g mdf
```

Or run without installing:

```bash
npx mdf input.md
```

## Usage

```bash
mdf input.md              # outputs input.pdf
mdf input.md output.pdf   # custom output name
```

## Syntax Guide

### Table of Contents

```markdown
[TOC]
```

### Math

```markdown
Inline: $E = mc^2$

Block:
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

### Callout Blocks

```markdown
:::info Title
This is an info callout.
:::

:::warning
Watch out!
:::

:::danger Critical
This is dangerous.
:::

:::success
Operation completed.
:::
```

### Manual Page Break

```markdown
==page==
```

## License

MIT
