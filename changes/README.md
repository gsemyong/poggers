# Change Records

Every externally observable change gets one short Markdown file. Start it with:

```text
kind: breaking | feature | fix
summary: One sentence written for a framework user.
```

When a public TypeScript declaration or package export changes, update the
reviewed API manifest with:

```sh
nub run api:update -- --intent changes/<change>.md
```

The normal check fails when public declarations change without an updated
manifest and a valid change record.
