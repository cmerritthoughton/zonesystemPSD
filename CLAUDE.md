# zonesystemPSD — Claude Code instructions

## What this is

**Visualize First** is a Photoshop UXP panel that trains Ansel Adams's visualize-first Zone System habit, for photographers and pen-and-ink illustrators. It's a practice loop (visualize → predict → reveal → interpret → opportunities), not a filter that makes images "look like Adams". The product is a better eye; the panel is the means.

- Users start with [QUICKSTART.md](QUICKSTART.md). [README.md](README.md) is the overview.
- [docs/TRAINING.md](docs/TRAINING.md) explains the pedagogy.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the layer pipeline and the Photoshop/UXP behaviours the code depends on. **Read it before changing `plugin/js/ps.js`.**

## Layout

```text
plugin/js/zones.js   pure zone math; no Photoshop, runs in Node and UXP
plugin/js/ps.js      every Photoshop operation (batchPlay, imaging API)
plugin/js/panel.js   panel state, rendering, events; talks to Photoshop only via ps.js
plugin/index.html    panel markup and styles; loads the three files as plain scripts
test/                zones.test.js (Node), panel.test.js (jsdom + tools/mock-ps.js), ps-harness.js (real Photoshop)
tools/               run-harness.sh, package.sh, mock-ps.js, build-preview.js, make-icons.py
```

## Invariants

- Never edit the artist's own layers. Everything lives in the **Visualize First** group; child layers are named `VF · <Name> — <setting>` and kept in the documented pipeline order.
- Every document change goes through `inDoc()` and is one history step. Measurements use `commit: false`, so they leave no trace.
- Zones are equal steps of CIE L\*: on screen Zone V = L\* 50; in ink mode the scale runs from measured ink to measured paper. Measure through `getPixels({ colorSpace: "Lab" })`, never through the document's encoded values.
- In training mode, nothing measured may be visible before the artist has written a visualization and made a prediction.
- New overlay modes, filters or readings belong in `zones.js` as pure functions with unit tests, and are rendered by `ps.js`/`panel.js`.
- UI text is artist-facing: Adams's and photographers' vocabulary (zones, placement, development, burning, key), never implementation terms.

## Photoshop gotchas (details in docs/ARCHITECTURE.md)

- `batchPlay` returns errors instead of throwing, so always go through `bp()`, which throws.
- Renaming a layer makes it visible: rename *before* setting visibility.
- Composite `getPixels` returns 16-bit (0–32768) RGBA. Never request `componentSize: 8`; normalise by array type.
- Read `imageData` width, height and components *before* `dispose()`.
- Gaussian Blur isn't available from scripts; use `Z.blurPixels`.
- A `.psjs` script stops after its first modal scope; the harness runs inside a single one.

## Quality gate

Run before calling a change done:

```bash
npm test                 # zone math + panel flows (jsdom)
npm run test:photoshop   # required for any change to ps.js; needs Photoshop 2026 running (macOS)
tools/package.sh         # the .ccx still builds
```

The harness creates and closes only its own `VF_HARNESS*` documents; never close or modify the user's other documents. For panel UI changes, run `npm run preview` and open the `panel-preview` server at `/test/.build/preview.html`, with the browser at about 340 px wide.

Known gap: the panel UI hasn't been verified by hand in Photoshop's live UXP runtime. Say so when it matters, and don't claim it as tested.

## Workflow

- Use `gh` for issues and pull requests. The repository is `cmerritthoughton/zonesystemPSD`, and `main` is protected by convention: work on `issue-<n>-<slug>` branches, one PR per issue, with `Closes #<n>` in the description.
- Don't merge your own PR unless asked.
- Update `CHANGELOG.md` for user-visible changes, and `QUICKSTART.md` when steps or UI labels change.
- When releasing, bump the version in `plugin/manifest.json` and `package.json` together.
- The commit identity is set in this repository's git config (Charles Merritt); don't change it.
