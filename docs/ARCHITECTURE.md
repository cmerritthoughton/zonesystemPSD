# Architecture

## Modules

| File | Role | Depends on |
|---|---|---|
| `plugin/js/zones.js` | Pure functions: zone scales, L\* and tone curves, gradient-map stops, development, placement and burn curves, zone histograms, scoring, practice stats, CSV, blur. | nothing (runs in Node and UXP) |
| `plugin/js/ps.js` | Photoshop operations. Everything that touches a document goes through here. | `zones.js`, `require("photoshop")` |
| `plugin/js/panel.js` | Panel state, rendering and events. Talks to Photoshop only through `ps.js`. | `zones.js`, `ps.js`, `localStorage`, `require("uxp")` for file export |

`index.html` loads the three files with plain `<script>` tags. Each one exposes a global (`VFZones`, `VFps`), so the same files can be concatenated into a UXP script for the Photoshop harness or loaded into jsdom for the panel tests.

## The layer pipeline

Every operation works inside one group named **Visualize First** at the top of the layer stack. Children are matched by name prefix (`VF · Filter`, `VF · Development`, and so on). After each creation they are put back in this order, top to bottom:

```text
VF · Overlay            gradient map: reads the finished print
VF · Zone ladder        pixel strip: sits under the overlay, so it becomes a legend
VF · Burn sky           curves + linear gradient mask
VF · Burn edges         curves + radial gradient mask
VF · Development        curves: N model or marker placement
VF · Filter             monochrome channel mixer
VF · Optical average    blurred pixel copy of the image
```

Layer names carry the current setting (`VF · Filter — Red (#25)`, `VF · Development — #1→III #2→VIII`). The panel reads its state back from the names, opacity and visibility, so it stays correct if the artist toggles layers in the Layers panel or switches documents.

## Operations

`inDoc(name, fn, { commit, docId })` wraps every document change:

- It runs `fn` inside `executeAsModal`, under one suspended-history entry, so each action is one undo step.
- With `commit: false` (measuring) the history entry is rolled back, so the document is unchanged and history shows nothing.
- It restores the artist's layer selection afterwards.
- With `docId` it switches to that document first. This lets the opportunities sheet apply a variant back to its source image.

## Measurement

- Markers are Photoshop Color Samplers. Their positions come from `document.colorSamplers`.
- Lightness comes from `imaging.getPixels({ colorSpace: "Lab" })` on the composite, with the overlay and ladder hidden for the duration of the read. The L channel gives exact L\*, independent of the document's profile.
- A spot reading averages linear luminance over the region and converts back to L\*, as a meter would.
- Frame statistics use a composite downsampled to 480 px on its long side.

## Zones and overlays

Zone *k* is centred at `black + k × (white − black) / 10` in L\*. The screen scale is black 0 and white 100. The ink scale uses the measured ink and paper.

Overlays are gradient maps. `zones.js` converts each zone's L\* edges into encoded values using the document profile's tone curve, then into gradient locations (0–4096):

- A coloured band is a pair of same-colour stops.
- A pass-through band is a dense grey ramp, so the image's own grey survives any interpolation method.

## Opportunities sheet

The sheet is built in one suspended-history scope on the source document. For each filter and development, the code sets the layers, then reads an sRGB thumbnail and a small Lab copy for the caption statistics. The scope is then **rolled back**, so the source ends exactly as it started. The thumbnails are composited into one buffer, placed in a new document with `putPixels`, and labelled with text layers.

## Photoshop and UXP behaviours this code relies on or works around

These were observed in Photoshop 2026 (27.10) on macOS while building the harness. Each one has a regression check in `test/ps-harness.js` or is noted in the code.

| Behaviour | Consequence here |
|---|---|
| `batchPlay` reports failures as `{ _obj: "error" }` results rather than throwing. | `bp()` throws on any error result, so failures can't pass silently. |
| Renaming a layer through the DOM makes it visible again. | Burn layers are renamed *before* their visibility is set. |
| `getPixels` on a composite with layers returns 16-bit values (0–32768) plus alpha, even in an 8-bit document. Requesting `componentSize: 8` fails with "Could not fill". | Readers normalise by array type (`Uint8Array` → 255, `Uint16Array` → 32768) and never request a component size. |
| `getPixels({ colorSpace: "Lab" })` works on composites. | Measurement is exact L\*. |
| An image buffer's `width`, `height` and `components` read as undefined after `dispose()`. | Metadata is read before disposing. |
| Gaussian Blur via `batchPlay` reported "not currently available" in every context tried from a UXP script. | The optical average is blurred in JavaScript (three box passes ≈ Gaussian) before `putPixels`. |
| A UXP script (`.psjs`) stopped running once its first `executeAsModal` scope closed: later awaits never ran. | The harness runs entirely inside one modal scope and injects it with `setModalRunner`. The panel isn't affected. |
| Inside a `.psjs` script, `documents.add()` and similar DOM creation calls return `null`. | The harness uses `app.activeDocument` after creating. `ps.js` creates layers with `batchPlay` and reads `activeLayers`. |
| `document.historyStates` reflects the *active* document. | The harness activates a document before counting its history. |
| New adjustment layers made with `batchPlay` came with a layer mask in testing. | `ensureMask` still checks, and adds a reveal-all mask if one is ever missing. |
| Apply Image reported "not currently available" when targeting a new layer inside a hidden group. | The optical average copies pixels with `getPixels`/`putPixels` instead. |

## Testing layers

1. `test/zones.test.js`: the zone math, including overlay stops mapped through a simulated gradient map, curve constraints (inputs 0–255, at least 3 apart, at most 14 points), the N model, placement and blur.
2. `test/panel.test.js`: the real `index.html` and `panel.js` in jsdom against `tools/mock-ps.js`. It covers training gates, reveal scoring and logging, overlays, interpret controls, the opportunities hand-off, ink calibration, the practice log and polling.
3. `test/ps-harness.js`: real Photoshop. It generates a test chart (an eleven-patch zone wedge plus sky, red and green patches with markers), runs every operation, and checks pixels and layer state. `tools/run-harness.sh` bundles it with `zones.js` and `ps.js`, runs it, and reads the results back from a document's caption.
