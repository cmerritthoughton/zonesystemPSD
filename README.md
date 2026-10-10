# Visualize First

**A Zone System trainer for Photoshop.** A panel that builds Ansel Adams's core habit: decide what the finished print should feel like *before* you measure anything, then use placement, development, filters and burning to get there.

It's for photographers, and for illustrators who use reference photos or work in pen and ink and want Adams's command of light in their drawings. It doesn't make an image "look like Adams". It's a practice loop that trains your eye.

## Why

The Zone System is usually taught as metering, which undersells it. What made it powerful was the order of decisions:

1. **Visualize first.** The print is a statement, not a record. Decide how it should feel before you measure.
2. **Place one value and let the rest fall.** Commit to an anchor, usually the darkest shadow that must keep its texture (Zone III).
3. **Treat the tonal range as a budget.** Expand flat scenes (N+) and compress harsh ones (N−) so the range fits the print you visualized.
4. **Aim for separation, not contrast.** Avoid both "mud" (everything in the middle) and "chalk and soot" (black and white with nothing between).
5. **The scene is the score; the print is the performance.** Adams's own analogy: the same negative can be performed many ways.

The panel turns each of those into something you practise and get scored on. [docs/TRAINING.md](docs/TRAINING.md) covers the thinking behind it, including how the zones translate to ink coverage.

## The loop

| Step | You do | The panel does |
|---|---|---|
| **Visualize** | Write one sentence about the light and the feeling; choose low key, full scale or high key. | Keeps all measurements hidden (training mode). |
| **Predict** | Put Color Sampler markers on the image (#1 = textured shadow, #2 = textured light) and guess each one's zone. Estimate how much of the frame is dark. | Locks **Reveal** until you've committed. |
| **Reveal** | Compare. | Meters each marker like a 1° spot meter, scores your guesses and your bias, charts the frame's zones, reads key and range, and suggests moves toward your visualization. Shows a false-colour zone map. |
| **Interpret** | Choose a filter, a development (N−2 … N+2), or **place** marker #1 on a zone and let #2 fall on another. Burn edges and sky. | Builds the print as non-destructive adjustment layers and tells you the exposure shift and N you just chose. |
| **Opportunities** | Look across many interpretations at once. | Renders a sheet of 20 performances (5 filters × 4 developments), each captioned with its key, range and dark share. Apply any of them back to the image. |
| **Ink** | Check a scanned drawing. | Blurs a copy to a viewing distance (optical average), measures zones against *your* ink black and paper white, estimates ink coverage, and adds a zone ladder. |
| **Practice** | Watch yourself improve. | Logs every session: average miss, bias (do you see values lighter than they are?), dark-share error. Exports CSV. |

The overlay offers these views: zones in false colour, textured darks (II–III), textured lights (VII–VIII), the middle "mud" range (IV–VI), no-texture extremes, five ink families, four values, and a two-value light/shadow split.

## Install

Requires Photoshop 2024 (25.0) or later. It was developed and tested on Photoshop 2026 (27.10) on macOS.

**Option A: install the package**

```bash
npm run package
```

This writes `dist/visualize-first-1.0.0.ccx`. Double-click it to install it through Creative Cloud. Plugins installed this way show an "unverified" notice because they don't come from the Adobe marketplace. Then open **Plugins ▸ Visualize First**.

**Option B: load for development**

Install the [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) from Creative Cloud, choose **Add Plugin**, select `plugin/manifest.json`, then **Load**.

## A five-minute session

1. Open a reference photo. In **Visualize**, look at it in colour and write the drawing you want, for example: "Late storm light breaking onto the tower; the street below still in rain."
2. In **Predict**, press <kbd>I</kbd> for the Color Sampler and click the shadow that must keep its texture (#1) and the brightest light that must keep its texture (#2). Guess their zones.
3. **Reveal.** Note your miss and which direction you erred.
4. In **Interpret**, place #1 on Zone III and let #2 fall on Zone VIII. Try a red filter. Burn the edges.
5. Make an **Opportunities** sheet and find the version that matches your sentence, plus one that surprises you.

## How it measures

- **Zones** are eleven equal steps of CIE L\* (perceived lightness). On screen, Zone 0 is L\* 0, Zone V is L\* 50 (18% grey) and Zone X is L\* 100. In **Ink** mode the scale runs from your measured ink black to your measured paper white instead.
- **Metering** reads Photoshop's own Lab conversion of the visible image. Each marker averages luminance over a spot about 2% of the frame wide (like a 1° spot meter), or over 5 × 5 pixels or a single pixel.
- **Filters** are monochrome channel mixes that approximate Wratten filters on panchromatic film: yellow #8, orange #21, red #25, deep red #29 (the *Monolith* filter), green #58 and blue #47.
- **Development** follows Adams's N model: Zone III is held, and Zone VII moves one zone per step of N.
- **Placement** builds one curve through your two markers. It reports the exposure shift (one zone ≈ one stop) and the resulting N.

## Non-destructive by design

Everything the panel makes lives in one layer group, **Visualize First**, at the top of the layer stack, and your own layers are never edited. Each action is a single history step. Measuring leaves no trace in history. The opportunities sheet opens as a new document.

| Layer (top to bottom) | Purpose |
|---|---|
| VF · Overlay | Gradient map: zone map, isolations, value groupings |
| VF · Zone ladder | Reference strip that doubles as a legend under the overlay |
| VF · Burn sky / Burn edges | Curves with gradient masks |
| VF · Development | Curves: N development or marker placement |
| VF · Filter | Monochrome channel mixer |
| VF · Optical average | Blurred copy for reading ink drawings |

## Limitations

- Works on RGB and Grayscale documents at 8 or 16 bits. CMYK, Lab and 32-bit are not supported.
- False-colour overlays need RGB, so Grayscale scans can convert from the Ink step. Light/shadow, four values and ink families work in Grayscale.
- Overlay band edges assume the document profile's tone curve (sRGB, Adobe RGB or ProPhoto families). Marker and frame measurements use Photoshop's Lab conversion and don't depend on that assumption.
- The filters are approximations of colour filters, not spectral simulations.

## Development

```text
plugin/            the UXP plugin (manifest, panel HTML, icons)
  js/zones.js      pure zone math: scales, overlays, curves, scoring (no Photoshop)
  js/ps.js         Photoshop operations (batchPlay, imaging API)
  js/panel.js      panel state, rendering and events
test/
  zones.test.js    unit tests for the zone math
  panel.test.js    the real panel driven in jsdom against tools/mock-ps.js
  ps-harness.js    integration checks run inside Photoshop on a generated test chart
tools/
  run-harness.sh   bundle and run the Photoshop harness, print results
  package.sh       build dist/*.ccx
  mock-ps.js       Photoshop stand-in for panel tests and the browser preview
  build-preview.js write test/.build/preview.html for viewing the panel in a browser
  make-icons.py    regenerate the zone-ladder icons
docs/              training guide and architecture notes
```

```bash
npm install          # jsdom for the panel tests
npm test             # zone math + panel flows
npm run test:photoshop
```

`npm run test:photoshop` needs macOS with Photoshop 2026 running. Pass a different app name to `tools/run-harness.sh` for other versions. The script runs the harness through AppleScript, so macOS may ask once for permission to control Photoshop. It creates and closes its own documents and leaves yours alone.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the layer pipeline and records the Photoshop and UXP behaviours this code works around.

### Test status

- Zone math: 28 unit tests.
- Panel flows: 13 tests in jsdom against a Photoshop stand-in.
- Photoshop operations: 39 pixel-level checks in Photoshop 2026 (27.10). They cover RGB, Grayscale and 16-bit documents, overlays, filters, development, placement, burning, the optical average, the ladder and the opportunities sheet.
- The panel's interface hasn't yet been exercised by hand inside Photoshop's own UXP runtime. Its operations have, through the harness. Please [open an issue](https://github.com/cmerritthoughton/zonesystemPSD/issues) if anything in the panel renders or behaves differently there.

## Credits

The Zone System was developed by Ansel Adams and Fred Archer around 1940. The zone descriptions here are paraphrased from Adams's published scale, and the pen-and-ink mappings are this project's own. This project isn't affiliated with Adobe or with the Ansel Adams Publishing Rights Trust.

## License

No license has been chosen yet, so all rights are reserved by default.
