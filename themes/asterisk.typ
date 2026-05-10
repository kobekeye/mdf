// @mdf-fonts: Tinos:400,400i,700,700i; Noto Serif TC:400,700; Noto Sans TC:400,700; JetBrains Mono:400,400i,700,700i
// ── Page setup ────────────────────────────────────────────────────────────────
#set page(
  paper: "a4",
  margin: 20mm,
  footer: context align(center)[
    #text(size: 10pt, fill: rgb("#8b8175"), font: ("Tinos", "Noto Serif TC"))[
      #counter(page).display()
    ]
  ],
)

// ── Typography ────────────────────────────────────────────────────────────────
#let _asterisk-text = rgb("#333333")
#let _asterisk-heading = rgb("#1a1a1a")
#let _asterisk-rule = rgb("#d4d0c8")
#let _asterisk-muted = rgb("#555555")

#set text(font: ("Tinos", "Noto Sans TC"), size: 10.5pt, fill: _asterisk-text, lang: "en")
#set par(justify: false, leading: 1.2em)

// ── Task lists ────────────────────────────────────────────────────────────────
#let _mdf-task-checkbox(checked) = {
  let size = 0.95em
  if checked {
    box(
      width: size,
      height: size,
      baseline: 0.15em,
      fill: _asterisk-heading,
      stroke: 1pt + _asterisk-heading,
      radius: 1pt,
    )[
      #set align(center + horizon)
      #text(fill: white, size: 0.7em, weight: "bold")[\u{2713}]
    ]
  } else {
    box(
      width: size,
      height: size,
      baseline: 0.15em,
      stroke: 1pt + _asterisk-rule,
      radius: 1pt,
    )
  }
}


#let mdf-task-item(checked: false, body) = block(above: 0.35em, below: 0.35em)[
  #set par(hanging-indent: 1.5em, first-line-indent: 0pt)
  #_mdf-task-checkbox(checked)#h(0.5em)#body
]

// ── Headings ──────────────────────────────────────────────────────────────────
#show heading.where(level: 1): it => {
  set text(font: ("Noto Serif TC", "Tinos"), size: 21pt, weight: "bold", fill: _asterisk-heading)
  block(above: 2em, below: 1em)[
    #box(width: 100%, stroke: (bottom: 1.5pt + _asterisk-rule), inset: (bottom: 9pt))[#it.body]
  ]
}
#show heading.where(level: 2): it => {
  set text(font: ("Noto Serif TC", "Tinos"), size: 16pt, weight: "bold", fill: _asterisk-heading)
  block(above: 2em, below: 1em)[
    #box(width: 100%, stroke: (bottom: 1pt + _asterisk-rule), inset: (bottom: 6pt))[#it.body]
  ]
}
#show heading.where(level: 3): it => {
  set text(font: ("Noto Serif TC", "Tinos"), size: 13pt, weight: "bold", fill: _asterisk-heading)
  block(above: 2em, below: 1em)[#it.body]
}
#show heading.where(level: 4): it => {
  set text(font: ("Noto Serif TC", "Tinos"), size: 12pt, weight: "bold", fill: _asterisk-muted)
  block(above: 2em, below: 1em)[#it.body]
}

// ── Emphasis ──────────────────────────────────────────────────────────────────
#show strong: it => text(weight: "bold", fill: _asterisk-heading)[#it.body]

// ── Code ──────────────────────────────────────────────────────────────────────
#let _code-inline-bg = rgb("#f5f3f0")
#let _code-inline-fg = rgb("#4a3f30")
#let _code-inline-border = rgb("#e5e0d8")
#let _code-block-bg = rgb("#141413")
#let _code-block-fg = rgb("#eae7df")
#let _code-block-border = rgb("#252320")
#let _code-token-styles = (
  keyword:  (fill: rgb("#c197ff"), weight: none,   style: none,     bg: none),
  title:    (fill: rgb("#ffc1a6"), weight: none,   style: none,     bg: none),
  type:     (fill: rgb("#e2a48b"), weight: none,   style: none,     bg: none),
  constant: (fill: rgb("#f4dc90"), weight: none,   style: none,     bg: none),
  string:   (fill: rgb("#b5e6a0"), weight: none,   style: none,     bg: none),
  regexp:   (fill: rgb("#fbe7aa"), weight: none,   style: none,     bg: none),
  variable: (fill: rgb("#f0cdba"), weight: none,   style: none,     bg: none),
  property: (fill: rgb("#f6ddcd"), weight: none,   style: none,     bg: none),
  comment:  (fill: rgb("#918981"), weight: none,   style: "italic", bg: none),
  tag:      (fill: rgb("#d9645b"), weight: none,   style: none,     bg: none),
  section:  (fill: rgb("#ffc1a6"), weight: none,   style: none,     bg: none),
  bullet:   (fill: rgb("#9b87f5"), weight: none,   style: none,     bg: none),
  operator: (fill: rgb("#c6bdb2"), weight: none,   style: none,     bg: none),
  emphasis: (fill: _code-block-fg, weight: none,   style: "italic", bg: none),
  strong:   (fill: _code-block-fg, weight: "bold", style: none,     bg: none),
  addition: (fill: rgb("#b5e6a0"), weight: none,   style: none,     bg: none),
  deletion: (fill: rgb("#ffb19d"), weight: none,   style: none,     bg: none),
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
  inset: (left: 20pt, right: 20pt, top: 16pt, bottom: 16pt),
  width: 100%,
)[
  #set text(font: "JetBrains Mono", size: 10pt, fill: _code-block-fg)
  #set par(leading: 1.05em, justify: false)
  #body
]

#show raw.where(block: false): it => box(
  fill: _code-inline-bg,
  stroke: 0.6pt + _code-inline-border,
  inset: (x: 4pt, y: 0.5pt),
  outset: (top: 1.8pt, bottom: 2.2pt),
  radius: 3pt,
)[#text(font: "JetBrains Mono", size: 9pt, fill: _code-inline-fg)[#it]]

#show raw.where(block: true): it => mdf-code-block[#it]

// ── Blockquote ───────────────────────────────────────────────────────────────
#show quote: it => block(
  stroke: (left: 3pt + rgb("#d1d9e0")),
  inset: (left: 16pt, right: 4pt, top: 1pt, bottom: 1pt),
  width: 100%,
)[#text(fill: rgb("#656d76"))[#it.body]]

// ── Callout function ──────────────────────────────────────────────────────────
#let _callout-colors = (
  info:    (bg: rgb("#f5f7fa"), border: rgb("#7b9bb8"), text: rgb("#3b4f63"), title: rgb("#5a7d9b")),
  warning: (bg: rgb("#fdf8f0"), border: rgb("#d4a04a"), text: rgb("#6b5020"), title: rgb("#b8872e")),
  danger:  (bg: rgb("#fcf4f2"), border: rgb("#c46050"), text: rgb("#6e302a"), title: rgb("#b04a3a")),
  success: (bg: rgb("#f5f9f5"), border: rgb("#7ba87b"), text: rgb("#2f4a2f"), title: rgb("#5a8a5a")),
)

#let callout(type, title: none, body) = {
  let c = _callout-colors.at(type, default: _callout-colors.info)
  block(
    fill: c.bg,
    stroke: (left: 2pt + c.border),
    inset: (left: 16pt, right: 16pt, top: 12pt, bottom: 12pt),
    radius: (right: 6pt),
    width: 100%,
  )[
    #set text(fill: c.text)
    #if title != none { text(weight: "bold", fill: c.title)[#title]; parbreak() }
    #body
  ]
}

// ── GitHub-style alerts (> [!NOTE], > [!TIP], etc.) ──────────────────────────
#let _gh-alert-colors = (
  note:      (bg: rgb("#f5f7fa"), border: rgb("#7b9bb8"), text: rgb("#3b4f63"), title: rgb("#5a7d9b")),
  tip:       (bg: rgb("#f5f9f5"), border: rgb("#7ba87b"), text: rgb("#2f4a2f"), title: rgb("#5a8a5a")),
  important: (bg: rgb("#f7f5fa"), border: rgb("#9b8bb8"), text: rgb("#3e2f5a"), title: rgb("#7a6a9b")),
  warning:   (bg: rgb("#fdf8f0"), border: rgb("#d4a04a"), text: rgb("#6b5020"), title: rgb("#b8872e")),
  caution:   (bg: rgb("#fcf4f2"), border: rgb("#c46050"), text: rgb("#6e302a"), title: rgb("#b04a3a")),
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
    inset: (left: 16pt, right: 16pt, top: 12pt, bottom: 12pt),
    radius: (right: 6pt),
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
  stroke: (left: 3.5pt + rgb("#b8ad96")),
  fill: rgb("#faf8f5"),
  inset: (left: 16pt, right: 16pt, top: 12pt, bottom: 12pt),
  radius: (right: 6pt),
  width: 100%,
)[
  #text(weight: "bold", fill: rgb("#6b6050"))[#title]
  #parbreak()
  #body
]

// ── Tables ────────────────────────────────────────────────────────────────────
#let _table-header-bg = rgb("#f7f5f2")
#let _table-header-stroke = rgb("#d4d0c8")
#let _table-body-stroke = rgb("#e0dcd5")
#let _table-body-stripe = rgb("#faf9f7")
#let _table-header-text = rgb("#1a1a1a")
#let _table-body-text = rgb("#444444")

#show table: it => block(above: 1.4em, below: 1.4em)[#it]

#set table(
  stroke: (_, y) => {
    if y == 0 {
      (
        top: 0.8pt + _table-header-stroke,
        bottom: 1.5pt + _table-header-stroke,
        left: 0.8pt + _table-header-stroke,
        right: 0.8pt + _table-header-stroke,
      )
    } else {
      0.8pt + _table-body-stroke
    }
  },
  fill: (_, y) => {
    if y == 0 {
      _table-header-bg
    } else if calc.rem(y, 2) == 0 {
      _table-body-stripe
    }
  },
  inset: (x: 16pt, y: 11pt),
  align: left,
)

#show table.cell: set text(fill: _table-body-text)
#show table.cell.where(y: 0): set text(weight: "bold", fill: _table-header-text)

// ── Horizontal rule ───────────────────────────────────────────────────────────
#show line: it => {
  v(0.5em)
  line(length: 100%, stroke: 1pt + _asterisk-rule)
  v(0.5em)
}

// ── Links ─────────────────────────────────────────────────────────────────────
#show link: it => text(fill: rgb("#b35c2a"))[#it]
