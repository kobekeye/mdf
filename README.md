# mdf
<img width="370" height="527" alt="mdfintro1" src="https://github.com/user-attachments/assets/30436af4-2f05-4678-ad80-64daa47a5f7c" />
<img width="372" height="527" alt="mdfintro2" src="https://github.com/user-attachments/assets/79bab5be-2ea6-430c-8075-42870caa41bc" />



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
### Windows
If one hasn't install nodejs, click [here](https://nodejs.org) to install. After installing nodejs, type
```bash
npm install -g @kobekeye/mdf
```
### Linux / macOS
It is highly recommended to use [nvm](https://github.com/nvm-sh/nvm) to manage permissions. Using sudo with global npm installs is not recommended.
#### 1. Install nvm
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```
#### 2. Install nodejs
```bash
nvm install --lts
```
#### 3. Install mdf
```bash
npm install -g @kobekeye/mdf
```
## Usage
```bash
mdf input.md              # outputs input.pdf
mdf input.md output.pdf   # custom output name
```
To watch the output pdf file, use 
```bash
mdf input.md -w             # outputs input.pdf and watches for changes
mdf input.md output.pdf -w  # custom output name and watches for changes
```
Or, if you want to try without installation, 
```bash
npx @kobekeye/mdf input.md               # outputs input.pdf
npx @kobekeye/mdf input.md output.pdf    # custom output name
npx @kobekeye/mdf input.md -w            # outputs input.pdf and watches for changes
npx @kobekeye/mdf input.md output.pdf -w # custom output name and watches for changes
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

### Manual Page Break!

```markdown
==page==
```

## License

MIT
