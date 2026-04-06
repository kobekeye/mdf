# mdf
📢 **v1.2.0** — VSCode extension with preview, new themes.

<img width="371" height="527" alt="default1" src="https://github.com/user-attachments/assets/e42d7753-5ea4-4af0-bf71-524f22d61fc6" />
<img width="371" height="527" alt="default2" src="https://github.com/user-attachments/assets/a6398353-5e38-4515-9e36-12cc5477637b" />
<img width="371" height="527" alt="asterisk1" src="https://github.com/user-attachments/assets/b80e8bdd-0062-4be1-8b11-4dd48d8bfda9" />
<img width="371" height="527" alt="asterisk2" src="https://github.com/user-attachments/assets/8d9a76f1-21c0-4742-b037-48b8cdf8a06c" />



Convert Markdown to beautiful PDFs — free, open-source, and zero-config.
Welcome to mdf! Please note that this project is currently in the MVP (Minimum Viable Product) stage. Any feedback, suggestions, or contributions are highly appreciated!
## Features
- **Syntax highlighting** — fenced code blocks with language detection (via highlight.js)
- **Math formulas** — inline and block LaTeX via KaTeX (`$...$` and `$$...$$`)
- **Table of contents** — insert `[TOC]` anywhere in your document
- **Callout blocks** — `:::info`, `:::warning`, `:::danger`, `:::success`
- **Syntactical sugar** — `:::center`, `:::right`, `:::left`
- **Task lists** — `- [ ]` and `- [x]`
- **Tables, images, blockquotes**
- **Manual page breaks** — insert `==page==` on its own line
- **CJK support** — uses Inter + Noto Sans TC via Google Fonts for the default theme (requires download on first run)

## Installation

### Linux / macOS
It is highly recommended to use [nvm](https://github.com/nvm-sh/nvm)/[fnm](https://github.com/Schniz/fnm) to manage permissions. Using sudo with global npm installs is not recommended. Below shows an example for the [nvm](https://github.com/nvm-sh/nvm) one.
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

### Windows
If you haven't install nodejs, click [here](https://nodejs.org) to install. Or if you want to use [nvm-windows](https://github.com/coreybutler/nvm-windows) is also available. After installing nodejs/nvm, type
```bash
npm install -g @kobekeye/mdf
```
## Usage
`mdf <input.md> [output.pdf] [-w|--watch] [--theme <name>]`
#### Examples: 
```bash
mdf input.md              # outputs input.pdf
mdf input.md output.pdf   # custom output name
mdf input.md --theme asterisk # outputs input.pdf with theme "asterisk"
```
To watch the output pdf file, use 
```bash
mdf input.md -w             # outputs input.pdf and watches for changes
mdf input.md output.pdf -w  # custom output name and watches for changes
mdf input.md -w --theme asterisk # watches input.pdf with theme "asterisk"
```
Or, if you want to try without installation, 
```bash
npx @kobekeye/mdf input.md               # outputs input.pdf
npx @kobekeye/mdf input.md output.pdf    # custom output name
npx @kobekeye/mdf input.md -w            # outputs input.pdf and watches for changes
npx @kobekeye/mdf input.md output.pdf -w # custom output name and watches for changes
```

## VSCode Extension

Install **mdf** from the VSCode marketplace for live preview and PDF export directly in the editor.

- Live Markdown preview in side panel
- Syntax highlighting for mdf-specific syntax (`:::callouts`, `==page==`, `[TOC]`)
- LaTeX math snippets

## Update
```bash
npm update -g @kobekeye/mdf
```
If you only use `npx` to run mdf, make sure to run the latest version by using:
```bash
npx @kobekeye/mdf@latest
```
Otherwise, `npx` might use a cached version, causing you to encounter bugs that have already been fixed.
## Syntax Guide

### Table of Contents

```markdown
[TOC]
```

### Math

```latex
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
