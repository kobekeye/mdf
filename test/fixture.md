[TOC]

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

A paragraph with **bold**, *italic*, and `inline code`.

Another paragraph with [a link](https://example.com) in it.

---

## Code Blocks

```javascript
function hello() {
    console.log("world");
}
```

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
```

    indented code block line 1
    indented code block line 2

## Math

Inline math: $E = mc^2$ and $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

Block math:

$$
\int_0^\infty e^{-x} \, dx = 1
$$

## Table

| Name | Age | Role |
|------|-----|------|
| Alice | 30 | Engineer |
| Bob | 25 | Designer |

## Lists

- Bullet item 1
- Bullet item 2
  - Nested bullet 2a
  - Nested bullet 2b
    - Deep nested item

1. Ordered item 1
2. Ordered item 2
3. Ordered item 3

## Task Lists

- [ ] Unchecked task
- [x] Checked task
- [ ] Another unchecked task

## Callouts

:::info
This is an info callout.
:::

:::warning Custom Warning Title
This is a warning callout with a custom title.
:::

:::danger
This is a danger callout.
:::

:::success
This is a success callout.
:::

:::blue
Blue is an alias for info.
:::

:::spoiler Click to reveal
This is hidden content inside a spoiler.
:::

## GitHub Alerts

> [!NOTE]
> This is a note alert.

> [!TIP]
> This is a tip alert.

> [!IMPORTANT]
> This is an important alert.

> [!WARNING]
> This is a warning alert.

> [!CAUTION]
> This is a caution alert.

## Blockquote

> This is a blockquote.
> It can span multiple lines.

## Image

![Alt text](test-image.png)

## Page Break

==page==

## CJK Text

這是一段中文測試文字。日本語テスト。한국어 테스트.

## Mixed Content

Here is a paragraph with **bold**, *italic*, `code`, and math $x^2 + y^2 = r^2$ all together.

1. List with **bold** and $math$
2. List with `code` and *italic*
   - Nested with [link](https://example.com)
