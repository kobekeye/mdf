# mdf
<img width="370" height="527" alt="mdfintro1" src="https://github.com/user-attachments/assets/30436af4-2f05-4678-ad80-64daa47a5f7c" />
<img width="372" height="526" alt="mdfintro2" src="https://github.com/user-attachments/assets/bed40213-f5b3-4781-baa0-4eba09a000f3" />


Convert Markdown to beautiful PDFs — free, open-source, and zero-config.
Welcome to mdf! Please note that this project is currently in the MVP (Minimum Viable Product) stage. Any feedback, suggestions, or contributions are highly appreciated!
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
npm install -g @kobekeye/mdf
```

Or run without installing:

```bash
npx @kobekeye/mdf input.md
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
