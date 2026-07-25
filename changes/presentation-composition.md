kind: feature
summary: Add semantic Presentation condition, container, grid, scroll, and typography composition.

# Presentation Composition

Web Presentation conditions preserve the existing simple condition object and
now compose without declaration duplication through typed `all`, `any`, and
`not` branches. The web adapter lowers compound meaning to deterministic native
selectors, container queries, and media queries. Container conditions now cover
size ranges, aspect-ratio ranges, and portrait/landscape orientation through the
same typed condition object. Named containers now use one `createContainer`
identity shared by the declaring layout and its queries; raw repeated names are
removed.

Nested grid layouts can now align their columns or rows to parent tracks with
the additive `"subgrid"` value. Grid items can use one logical `item.grid`
relation to select inline/block start, end, or span without authored CSS line
syntax. Existing explicit track lists are unchanged.
Scrollable layouts can declare logical snap policy and padding, while their
items declare logical snap alignment, stop behavior, and margin. The same
scroll declaration controls scrollbar size, visibility, and typed colors.
Typography can declare visual block flow and glyph orientation without changing
structural language direction. Semantic `maxLines` provides bounded multi-line
text while the web adapter owns compatibility artifacts.

See
[`docs/migrations/0002-presentation-composition.md`](../docs/migrations/0002-presentation-composition.md).
