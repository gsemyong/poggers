# Visual System Verification

Updated 2026-07-09.

## Automated Evidence

| Gate                          | Evidence                                                   |
| ----------------------------- | ---------------------------------------------------------- |
| Kit unit/integration suite    | 324 tests pass across 20 files                             |
| Visual compiler/runtime focus | Focused compiler, UI, HMR, and race regressions pass       |
| Visual-lab browser suite      | 11 Playwright journeys pass                                |
| Fresh generated app           | install, sync, check, typecheck, and production build pass |
| First-party apps              | chat, site, and visual-lab typecheck and production build  |

The final uncached workspace run used:

```text
bun run typecheck --force  # 4 tasks pass with TypeScript 7.0.2
bun run lint --force       # 5 tasks pass, no warnings or errors
bun run fmt:check          # 116 files pass
bun run test --force       # 324 kit tests + 11 browser journeys pass
bun run build --force      # chat, site, and visual-lab binaries build
```

A fresh app generated against the local package installed TypeScript `7.0.2`,
ran postinstall sync, convention checks, typecheck, and build, then served its
HTML, JavaScript, and CSS from the compiled binary. Native TypeScript 7 owns
checking and editor services; the visual AST analyzer explicitly uses the
official TypeScript 6 compatibility package while TypeScript 7.0 has no stable
programmatic API.

The browser suite covers three distinct preset fingerprints over one semantic
component, typed theme switching, keyboard search and selection, loading/empty/
error states, native focus return, compact drag settle/dismiss, preset HMR,
WCAG A/AA Axe checks, reduced motion, forced colors, RTL, 320px reflow, 200%
text, long content, rapid open/close, resize, and preset interruption.

The keyed-list regression also executes filter, selection, close, preset
replacement, theme replacement, and reopen. It proves a retained DOM entry
keeps reactive ARIA and preset classes rather than retaining a stale class set.

## Structural Evidence

- Repository search finds no application or template import of StyleX,
  Anime.js, or PreText.
- Generated component factories accept only input and variants.
- Application UI files contain no component state/action/derived overrides.
- `.poggers`, Playwright output, coverage, and production output are ignored.
- The generic JSX runtime contains no layout-projection selector or motion
  adapter.
- The production visual path emits StyleX CSS and leaves no style-injection
  runtime in the browser bundle.
- Concurrent JavaScript and stylesheet requests share one StyleX build per HMR
  generation; consecutive save races return successful assets.

## Browser Residue Checks

After entry, exit, drag settle, filtering, theme/preset replacement, and rapid
interruption, tests assert that the dialog is unique and no runtime-owned inline
`transform`, `will-change`, inertness, or lifecycle marker remains. Browser page
errors and console errors are collected during the interruption journey.

## Review Evidence

Final desktop and compact captures for precision, tactile, and editorial live
under `screenshots/`. Each uses the same app definition, state, actions, UI
structure, and part contract. Their composition, density, typography, surfaces,
focus treatment, responsive arrangement, and motion tokens differ.

All desktop captures are `1440x900`; compact captures are `390x844`. Review
confirmed in-bounds geometry, legible selected/unselected states, coherent open
and closed compositions, and no accidental ellipse, clipping, mixed-preset
class, inline transform, `will-change`, inertness, or lifecycle residue.

The final production binary journey filtered and executed a command, returned
focus to the trigger, switched preset and theme, reopened on compact geometry,
and completed without browser console, page, or server errors.

## Honest Limits

- Axe is an automated audit, not a substitute for assistive-technology review.
- Chromium is the current automated browser target.
- PreText assists declared text geometry; the benchmark does not need data
  virtualization.
- Browser layout cannot be made universally compositor-only. Declared geometry
  work is component-scoped and batched.
- Timeline sequencing and scroll-linked motion are not public v2 primitives.
- TypeScript 7.0's programmatic API is not stable; the analyzer compatibility
  dependency can be removed only after migrating to a stable TypeScript 7 API.
