# Presentation Composition

Existing simple web Presentation conditions remain valid. Compound responsive
meaning can now use typed `all`, `any`, and `not` branches, and container
conditions can additionally constrain `minAspectRatio`, `maxAspectRatio`, and
`orientation`.

Replace repeated named-container strings with one typed identity:

```ts
const workspace = createContainer("workspace");

const root = {
  layout: { container: { identity: workspace, axis: "inline" } },
};
const compact = {
  rules: [
    {
      when: { container: { identity: workspace, maxInlineSize: 620 } },
      use: { layout: { padding: 12 } },
    },
  ],
};
```

The optional `identity` field replaces `name`; omit it for nearest-container
queries.

Grid models may additionally use `columns: "subgrid"` or `rows: "subgrid"`.
Grid items may use `item.grid.inline` and `item.grid.block` with typed
`start`/`end` or `start`/`span` placement. Existing track-list and item
declarations remain unchanged.

Scrollable layout containers and items may use the additive `scroll` declaration
for native logical-axis snapping. Existing overflow declarations remain
unchanged. The container declaration may also set its scrollbar `indicator`;
gesture behavior remains owned by Components.

Text declarations may add `writing` with a semantic block-flow direction and
glyph orientation. Document language direction remains structural. They may
also add positive-integer `maxLines`; it cannot be combined with an explicit
layout model because the current compatible browser realization owns display.
