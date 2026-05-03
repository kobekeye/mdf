// @mdf-fonts: Inter:400,700; Noto Sans TC:400,700; JetBrains Mono:400,700
// ── Page setup ────────────────────────────────────────────────────────────────
#set page(
  paper: "a4",
  margin: 20mm,
  footer: context align(center)[
    #text(size: 10pt, fill: rgb("#888"), font: "Times New Roman")[
      #counter(page).display()
    ]
  ],
)

// ── Typography ────────────────────────────────────────────────────────────────
#set text(font: ("Inter", "Noto Sans TC"), size: 10.5pt, lang: "en")
#set par(justify: true, leading: 1.2em)

// ── Headings ──────────────────────────────────────────────────────────────────
#show heading.where(level: 1): it => {
  set text(size: 22.5pt, weight: "bold")
  block(above: 2em, below: 1em)[
    #box(width: 100%, stroke: (bottom: 1.5pt + rgb("#e8eaf0")), inset: (bottom: 10pt))[#it.body]
  ]
}
#show heading.where(level: 2): it => {
  set text(size: 16pt, weight: "bold")
  block(above: 2em, below: 1em)[
    #box(width: 100%, stroke: (bottom: 1pt + rgb("#e8eaf0")), inset: (bottom: 9pt))[#it.body]
  ]
}
#show heading.where(level: 3): it => {
  set text(size: 13pt, weight: "bold")
  block(above: 2em, below: 1em)[#it.body]
}
#show heading.where(level: 4): it => {
  set text(size: 12pt, weight: "bold")
  block(above: 2em, below: 1em)[#it.body]
}

// ── Code ──────────────────────────────────────────────────────────────────────
#let _code-inline-bg = rgb("#ebebeb")
#let _code-inline-fg = rgb("#1a1a1a")
#let _code-block-bg = rgb("#1e1e2e")
#let _code-block-fg = rgb("#cdd6f4")
#let _code-block-border = rgb("#2a2a3e")
#let _code-token-styles = (
  keyword:  (fill: rgb("#ff7b72"), weight: none,   style: none,     bg: none),
  title:    (fill: rgb("#d2a8ff"), weight: none,   style: none,     bg: none),
  constant: (fill: rgb("#79c0ff"), weight: none,   style: none,     bg: none),
  string:   (fill: rgb("#a5d6ff"), weight: none,   style: none,     bg: none),
  variable: (fill: rgb("#ffa657"), weight: none,   style: none,     bg: none),
  comment:  (fill: rgb("#8b949e"), weight: none,   style: "italic", bg: none),
  tag:      (fill: rgb("#7ee787"), weight: none,   style: none,     bg: none),
  section:  (fill: rgb("#1f6feb"), weight: "bold", style: none,     bg: none),
  bullet:   (fill: rgb("#f2cc60"), weight: none,   style: none,     bg: none),
  emphasis: (fill: _code-block-fg, weight: none,   style: "italic", bg: none),
  strong:   (fill: _code-block-fg, weight: "bold", style: none,     bg: none),
  addition: (fill: rgb("#aff5b4"), weight: none,   style: none,     bg: rgb("#033a16")),
  deletion: (fill: rgb("#ffdcd7"), weight: none,   style: none,     bg: rgb("#67060c")),
)

#let _mdf-code-text(style, body) = {
  if style.weight != none and style.style != none {
    text(fill: style.fill, weight: style.weight, style: style.style)[#body]
  } else if style.weight != none {
    text(fill: style.fill, weight: style.weight)[#body]
  } else if style.style != none {
    text(fill: style.fill, style: style.style)[#body]
  } else {
    text(fill: style.fill)[#body]
  }
}

#let mdf-code-token(kind, body) = {
  let style = _code-token-styles.at(kind, default: none)
  if style == none {
    body
  } else if style.bg != none {
    box(fill: style.bg, radius: 2pt, inset: (x: 1.5pt, y: 0.5pt))[
      #_mdf-code-text(style, body)
    ]
  } else {
    _mdf-code-text(style, body)
  }
}

#let mdf-code-block(lang: none, body) = block(
  fill: _code-block-bg,
  stroke: 0.8pt + _code-block-border,
  radius: 3pt,
  inset: (left: 18pt, right: 18pt, top: 15pt, bottom: 15pt),
  width: 100%,
)[
  #set text(font: "JetBrains Mono", size: 8.8pt, fill: _code-block-fg)
  #set par(leading: 1.45em, justify: false)
  #body
]

#show raw.where(block: false): it => box(
  fill: _code-inline-bg,
  inset: (x: 4pt, y: 1.5pt),
  radius: 3pt,
  baseline: 40%,
)[#text(font: "JetBrains Mono", size: 9pt, fill: _code-inline-fg)[#it]]

#show raw.where(block: true): it => mdf-code-block[#it]

// ── Blockquote ───────────────────────────────────────────────────────────────
#show quote: it => block(
  fill: rgb("#f0f6ff"),
  stroke: (left: 2pt + rgb("#3b82f6")),
  inset: (left: 14pt, right: 12pt, top: 10pt, bottom: 10pt),
  radius: (right: 4pt),
  width: 100%,
)[#text(fill: rgb("#334155"))[#it.body]]

// ── Callout function ──────────────────────────────────────────────────────────
#let _callout-colors = (
  info:    (bg: rgb("#eff6ff"), border: rgb("#3b82f6"), text: rgb("#1e3a5f"), title: rgb("#2563eb")),
  warning: (bg: rgb("#fffbeb"), border: rgb("#f59e0b"), text: rgb("#78350f"), title: rgb("#d97706")),
  danger:  (bg: rgb("#fef2f2"), border: rgb("#ef4444"), text: rgb("#7f1d1d"), title: rgb("#dc2626")),
  success: (bg: rgb("#f0fdf4"), border: rgb("#22c55e"), text: rgb("#14532d"), title: rgb("#16a34a")),
)

#let callout(type, title: none, body) = {
  let c = _callout-colors.at(type, default: _callout-colors.info)
  block(
    fill: c.bg,
    stroke: (left: 2pt + c.border),
    inset: (left: 14pt, right: 12pt, top: 10pt, bottom: 10pt),
    radius: (right: 4pt),
    width: 100%,
  )[
    #set text(fill: c.text)
    #if title != none { text(weight: "bold", fill: c.title)[#title]; parbreak() }
    #body
  ]
}

// ── GitHub-style alerts (> [!NOTE], > [!TIP], etc.) ──────────────────────────
#let _gh-alert-colors = (
  note:      (bg: rgb("#eff6ff"), border: rgb("#3b82f6"), text: rgb("#1e3a5f"), title: rgb("#2563eb")),
  tip:       (bg: rgb("#f0fdf4"), border: rgb("#22c55e"), text: rgb("#14532d"), title: rgb("#16a34a")),
  important: (bg: rgb("#f5f3ff"), border: rgb("#8b5cf6"), text: rgb("#3b0764"), title: rgb("#7c3aed")),
  warning:   (bg: rgb("#fffbeb"), border: rgb("#f59e0b"), text: rgb("#78350f"), title: rgb("#d97706")),
  caution:   (bg: rgb("#fef2f2"), border: rgb("#ef4444"), text: rgb("#7f1d1d"), title: rgb("#dc2626")),
)

#let _gh-alert-titles = (
  note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution",
)

#let gh-alert(type, title: none, body) = {
  let c = _gh-alert-colors.at(type, default: _gh-alert-colors.note)
  let title = if title != none { title } else { _gh-alert-titles.at(type, default: "Note") }
  block(
    fill: c.bg,
    stroke: (left: 2pt + c.border),
    inset: (left: 14pt, right: 12pt, top: 10pt, bottom: 10pt),
    radius: (right: 4pt),
    width: 100%,
  )[
    #set text(fill: c.text)
    #text(weight: "bold", fill: c.title)[#title]
    #parbreak()
    #body
  ]
}

// ── Spoiler (PDF: non-interactive block with title) ───────────────────────────
#let spoiler(title, body) = block(
  stroke: (left: 3pt + rgb("#aaa")),
  fill: rgb("#f7f7f7"),
  inset: (left: 14pt, right: 12pt, top: 10pt, bottom: 10pt),
  radius: (right: 4pt),
  width: 100%,
)[
  #text(weight: "bold", fill: rgb("#666"))[#title]
  #parbreak()
  #body
]

// ── Horizontal rule ───────────────────────────────────────────────────────────
#show line: it => {
  v(0.5em)
  it
  v(0.5em)
}

// ── Links ─────────────────────────────────────────────────────────────────────
#show link: it => text(fill: rgb("#0969da"))[#it]
