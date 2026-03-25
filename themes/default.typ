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
#set text(font: ("Inter", "Noto Sans TC"), size: 11pt, lang: "en")
#set par(justify: true, leading: 0.8em)

// ── Headings ──────────────────────────────────────────────────────────────────
#show heading.where(level: 1): it => {
  set text(size: 24pt, weight: "bold")
  block(above: 1.5em, below: 0.8em)[#it.body]
}
#show heading.where(level: 2): it => {
  set text(size: 20pt, weight: "bold")
  block(above: 1.2em, below: 0.6em)[#it.body]
}
#show heading.where(level: 3): it => {
  set text(size: 16pt, weight: "bold")
  block(above: 1em, below: 0.5em)[#it.body]
}
#show heading.where(level: 4): it => {
  set text(size: 13pt, weight: "bold")
  block(above: 0.8em, below: 0.4em)[#it.body]
}

// ── Code ──────────────────────────────────────────────────────────────────────
#show raw.where(block: false): it => box(
  fill: rgb("#f0f0f0"),
  inset: (x: 3pt, y: 1pt),
  radius: 2pt,
)[#it]

#show raw.where(block: true): it => block(
  fill: rgb("#1e1e1e"),
  stroke: none,
  radius: 6pt,
  inset: 14pt,
  width: 100%,
)[#text(fill: white, size: 10pt)[#it]]

// ── Callout function ──────────────────────────────────────────────────────────
#let _callout-colors = (
  info:    (bg: rgb("#e8f4fd"), border: rgb("#2196f3")),
  warning: (bg: rgb("#fff8e6"), border: rgb("#ff9800")),
  danger:  (bg: rgb("#fdecea"), border: rgb("#f44336")),
  success: (bg: rgb("#e9f7ef"), border: rgb("#4caf50")),
)

#let callout(type, title: none, body) = {
  let c = _callout-colors.at(type, default: _callout-colors.info)
  block(
    fill: c.bg,
    stroke: (left: 3pt + c.border),
    inset: (left: 14pt, right: 12pt, top: 10pt, bottom: 10pt),
    radius: (right: 4pt),
    width: 100%,
  )[
    #if title != none { text(weight: "bold")[#title]; parbreak() }
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
