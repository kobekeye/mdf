#outline(title: none)

= Heading 1

#v(-1.4em)
== Heading 2

#v(-1.4em)
=== Heading 3

#v(-1.4em)
==== Heading 4

A paragraph with *bold*, _italic_, and `inline code`.

Another paragraph with #link("https://example.com")[a link] in it.

#line(length: 100%)

== Code Blocks

#mdf-code-block(lang: "javascript")[#mdf-code-token("keyword")[#text("function")]#text(" ")#mdf-code-token("title")[#text("hello")]#text("(")#text(") {")#linebreak()#text("    ")#mdf-code-token("keyword")[#text("console")]#text(".")#mdf-code-token("title")[#text("log")]#text("(")#mdf-code-token("string")[#text("\"world\"")]#text(");")#linebreak()#text("}")#linebreak()]

#mdf-code-block(lang: "python")[#mdf-code-token("keyword")[#text("def")]#text(" ")#mdf-code-token("title")[#text("fibonacci")]#text("(")#text("n")#text("):")#linebreak()#text("    ")#mdf-code-token("keyword")[#text("if")]#text(" n <= ")#mdf-code-token("constant")[#text("1")]#text(":")#linebreak()#text("        ")#mdf-code-token("keyword")[#text("return")]#text(" n")#linebreak()#text("    ")#mdf-code-token("keyword")[#text("return")]#text(" fibonacci(n - ")#mdf-code-token("constant")[#text("1")]#text(") + fibonacci(n - ")#mdf-code-token("constant")[#text("2")]#text(")")#linebreak()]

#mdf-code-block(lang: none)[#text("indented code block line 1")#linebreak()#text("indented code block line 2")#linebreak()]

== Math

Inline math: $E = mc^2$ and $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

Block math:

$$
\int_0^\infty e^{-x} , dx = 1
$$

== Table

#table(
  columns: 3,
  [Name],
  [Age],
  [Role],
  [Alice],
  [30],
  [Engineer],
  [Bob],
  [25],
  [Designer],
)

== Lists

- Bullet item 1

- Bullet item 2
  - Nested bullet 2a

  - Nested bullet 2b
    - Deep nested item






+ Ordered item 1

+ Ordered item 2

+ Ordered item 3


== Task Lists

- ☐ Unchecked task

- ☑ Checked task

- ☐ Another unchecked task


== Callouts

#callout("info")[
This is an info callout.

]

#callout("warning", title: [Custom Warning Title])[
This is a warning callout with a custom title.

]

#callout("danger")[
This is a danger callout.

]

#callout("success")[
This is a success callout.

]

#callout("info")[
Blue is an alias for info.

]

#spoiler([Click to reveal])[
This is hidden content inside a spoiler.

]

== GitHub Alerts

#gh-alert("note")[
This is a note alert.

]

#gh-alert("tip")[
This is a tip alert.

]

#gh-alert("important")[
This is an important alert.

]

#gh-alert("warning")[
This is a warning alert.

]

#gh-alert("caution")[
This is a caution alert.

]

== Blockquote

#quote[
This is a blockquote.
It can span multiple lines.

]

== Image

#image("test-image.png", alt: "Alt text")

== Page Break

#pagebreak()

== CJK Text

這是一段中文測試文字。日本語テスト。한국어 테스트.

== Mixed Content

Here is a paragraph with *bold*, _italic_, `code`, and math $x^2 + y^2 = r^2$ all together.

+ List with *bold* and $math$

+ List with `code` and _italic_
  - Nested with #link("https://example.com")[link]




