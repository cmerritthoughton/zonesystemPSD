/*
 * Generates the figures and measurements for docs/WALKTHROUGH.md.
 *
 * tools/make-walkthrough.sh opens a copy of the photograph titled WALK.title, then runs
 * this after zones.js and ps.js with the config in globalThis.WALK. Every
 * image here comes from the plugin's own operations on that document; each
 * figure is assembled into a VF_FIG_<name> document for the shell script to
 * export. Measurements go back as JSON in the caption of VF_WALK_RESULTS.
 */
(function () {
  const ps = require("photoshop");
  const { app, core, action, imaging } = ps;
  const Z = globalThis.VFZones;
  const V = globalThis.VFps;
  const CFG = globalThis.WALK;
  const bp = (d) => action.batchPlay(Array.isArray(d) ? d : [d], {});
  const r3 = (v) => Math.round(v * 1000) / 1000;

  const PANEL = 300;
  const INK = [11, 11, 11];
  const INK_2 = [82, 81, 78];
  const out = { image: null, markers: [], variants: {}, placements: {}, order: [] };
  const errors = [];

  // ---- Capturing ---------------------------------------------------------------

  async function capture(doc, width) {
    const res = await imaging.getPixels({ documentID: doc.id, targetSize: { width }, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
    const img = res.imageData;
    const { width: w, height: h, components: c } = img;
    try {
      const data = await img.getData();
      const max = data instanceof Uint16Array ? 32768 : 255;
      const pix = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) for (let j = 0; j < 3; j++) pix[i * 3 + j] = Math.round((data[i * c + j] / max) * 255);
      return { data: pix, width: w, height: h };
    } finally {
      img.dispose();
    }
  }

  function record(key, label, dist, extra) {
    const a = dist.analysis;
    out.variants[key] = Object.assign(
      {
        label,
        fractions: dist.fractions.map(r3),
        dark: r3(a.dark),
        light: r3(a.light),
        middle: r3(a.middle),
        texturedDark: r3(a.texturedDark),
        texturedLight: r3(a.texturedLight),
        dead: r3(a.dead),
        key: a.key,
        range: a.range,
      },
      extra || {}
    );
    out.order.push(key);
  }

  // Put the source into a print state through the plugin's own operations.
  async function setState(src, s) {
    app.activeDocument = src;
    const st = Object.assign({ mono: true, filter: "none", n: 0, placement: null, overlay: "off", split: 6, burnEdges: 0, burnSky: 0, depth: 0.4 }, s);
    await V.setMonochrome(st.mono);
    if (st.mono) await V.setFilter(st.filter);
    let summary = null;
    if (st.placement) summary = await V.placeMarkers({ placements: st.placement, spot: "spot" });
    else await V.setDevelopment({ n: st.n });
    await V.setBurnEdges(st.burnEdges);
    await V.setBurnSky({ amount: st.burnSky, depth: st.depth });
    await V.setOverlay({ mode: st.overlay, split: st.split });
    return summary;
  }

  // One print state: measure it, then capture it plain and as a zone map.
  async function shoot(src, key, label, state, extra) {
    const summary = await setState(src, state);
    record(key, label, await V.measureDistribution({}), extra);
    const plain = await capture(src, PANEL);
    await V.setOverlay({ mode: "zones" });
    const zones = await capture(src, PANEL);
    await V.setOverlay({ mode: "off" });
    return { plain, zones, summary };
  }

  // ---- Composing figures -----------------------------------------------------------

  // Point text; with center, x is the centre of the line.
  async function addText(doc, text, x, y, size, color, bold, center) {
    await bp({
      _obj: "make",
      _target: [{ _ref: "textLayer" }],
      using: {
        _obj: "textLayer",
        textKey: text,
        textClickPoint: { _obj: "paint", horizontal: { _unit: "percentUnit", _value: (x / doc.width) * 100 }, vertical: { _unit: "percentUnit", _value: (y / doc.height) * 100 } },
        textStyleRange: [
          {
            _obj: "textStyleRange",
            from: 0,
            to: text.length,
            textStyle: {
              _obj: "textStyle",
              fontPostScriptName: bold ? "MyriadPro-Bold" : "MyriadPro-Regular",
              fontName: "Myriad Pro",
              fontStyleName: bold ? "Bold" : "Regular",
              size: { _unit: "pointsUnit", _value: size },
              color: { _obj: "RGBColor", red: color[0], grain: color[1], blue: color[2] },
            },
          },
        ],
        paragraphStyleRange: [
          { _obj: "paragraphStyleRange", from: 0, to: text.length, paragraphStyle: { _obj: "paragraphStyle", align: { _enum: "alignmentType", _value: center ? "center" : "left" } } },
        ],
      },
    });
  }

  function disc(buf, W, cx, cy, r, rgb) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && x >= 0 && y >= 0 && x < W) {
          const i = (y * W + x) * 3;
          if (i + 2 < buf.length) buf.set(rgb, i);
        }
      }
    }
  }

  // rows: [[{ pic, label }]]. Options: legend (zone colours), markers (on the first panel).
  async function figure(name, rows, { legend = false, markers = null } = {}) {
    const M = 28;
    const gap = 16;
    const capH = rows.some((r) => r.some((p) => p.label)) ? 30 : 0;
    const legendH = legend ? 52 : 0;
    const cols = Math.max(...rows.map((r) => r.length));
    const pw = rows[0][0].pic.width;
    const ph = rows[0][0].pic.height;
    const W = M * 2 + cols * pw + (cols - 1) * gap;
    const H = M * 2 + rows.length * (ph + capH) + (rows.length - 1) * gap + legendH;
    const buf = new Uint8Array(W * H * 3).fill(255);
    const at = (ri, ci) => [M + ci * (pw + gap), M + ri * (ph + capH + gap)];
    rows.forEach((row, ri) =>
      row.forEach((p, ci) => {
        const [x0, y0] = at(ri, ci);
        for (let y = 0; y < p.pic.height; y++) buf.set(p.pic.data.subarray(y * p.pic.width * 3, (y + 1) * p.pic.width * 3), ((y0 + y) * W + x0) * 3);
      })
    );
    const labels = [];
    if (markers) {
      const [x0, y0] = at(0, 0);
      const s = rows[0][0].pic.width / out.image.width;
      markers.forEach((m, i) => {
        const cx = x0 + m.x * s;
        const cy = y0 + m.y * s;
        disc(buf, W, cx, cy, 15, [255, 255, 255]);
        disc(buf, W, cx, cy, 12.5, [20, 20, 20]);
        labels.push([String(i + 1), cx, cy + 5.5, 15, [255, 255, 255], true, true]);
      });
    }
    let chips = [];
    if (legend) {
      const top = H - M - legendH + 14;
      const cw = Math.min(48, Math.floor((W - 2 * M - 10 * 4) / 11));
      const x0 = Math.round((W - (11 * cw + 10 * 4)) / 2);
      for (let k = 0; k <= 10; k++) {
        const x = x0 + k * (cw + 4);
        for (let y = top; y < top + 16; y++) for (let xx = x; xx < x + cw; xx++) buf.set(Z.ZONE_COLORS[k], (y * W + xx) * 3);
        chips.push([Z.ROMAN[k], x + cw / 2, top + 32, 12, INK_2, false, true]);
      }
    }
    await app.documents.add({ width: W, height: H, resolution: 72, mode: "RGBColorMode", fill: "white", name: "VF_FIG_" + name });
    const fig = app.activeDocument;
    await bp({ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: "Panels" } });
    const layer = fig.activeLayers[0];
    const img = await imaging.createImageDataFromBuffer(buf, { width: W, height: H, components: 3, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
    try {
      await imaging.putPixels({ documentID: fig.id, layerID: layer.id, imageData: img, targetBounds: { left: 0, top: 0 } });
    } finally {
      img.dispose();
    }
    rows.forEach((row, ri) =>
      row.forEach((p, ci) => {
        if (!p.label) return;
        const [x0, y0] = at(ri, ci);
        labels.push([p.label, x0 + pw / 2, y0 + ph + 21, 14, INK, false, true]);
      })
    );
    for (const t of labels.concat(chips)) await addText(fig, t[0], t[1], t[2], t[3], t[4], t[5], t[6]);
  }

  // ---- The walkthrough ------------------------------------------------------------------

  async function run(ctx) {
    V.setModalRunner((n, fn) => fn(ctx));
    const src = app.documents.find((d) => d.title === CFG.title);
    if (!src) throw new Error(CFG.title + " is not open");
    app.activeDocument = src;
    out.image = { width: src.width, height: src.height, profile: src.colorProfileName };

    for (const m of CFG.markers) {
      await bp({ _obj: "make", _target: [{ _ref: "colorSampler" }], position: { _obj: "paint", horizontal: { _unit: "pixelsUnit", _value: m.x }, vertical: { _unit: "pixelsUnit", _value: m.y } } });
    }

    // The scene as metered: colour, no interpretation.
    await setState(src, { mono: false });
    const metered = await V.measureMarkers({ spot: "spot" });
    out.markers = metered.map((m, i) => ({ index: m.index, x: m.x, y: m.y, L: r3(m.L), zone: r3(m.zone), label: CFG.markers[i].label, role: CFG.markers[i].role || "" }));
    record("colour", "Colour, as metered", await V.measureDistribution({}));
    const colourBig = await capture(src, 600);
    const colour = await capture(src, PANEL);

    // Monochrome, zone map, isolations and value groupings.
    const base = await shoot(src, "mono", "Monochrome preview, no filter", {});
    const overlays = {};
    for (const mode of ["darks", "lights", "middle", "dead", "families", "four", "notan"]) {
      await V.setOverlay({ mode, split: 6 });
      overlays[mode] = await capture(src, PANEL);
    }
    await V.setOverlay({ mode: "off" });

    // Filters: every one measured, the shown ones captured.
    const filterShots = {};
    for (const f of Z.FILTERS) {
      const label = f.label;
      if (CFG.filtersShown.includes(f.id)) filterShots[f.id] = await shoot(src, "filter-" + f.id, label, { filter: f.id });
      else {
        await setState(src, { filter: f.id });
        record("filter-" + f.id, label, await V.measureDistribution({}));
      }
    }

    // Development.
    const devShots = {};
    for (const n of CFG.developments) devShots[n] = await shoot(src, "dev-" + n, Z.devLabel(n), { n });

    // Placement.
    const placeShots = {};
    for (const p of CFG.placements) {
      const shot = await shoot(src, "place-" + p.key, p.label + ": " + p.detail, { placement: p.placements });
      placeShots[p.key] = shot;
      const s = shot.summary;
      out.placements[p.key] = { label: p.label, detail: p.detail, shift: r3(s.shift), development: s.development === null ? null : r3(s.development), markers: s.markers.map((m) => ({ index: m.index, from: r3(m.from), to: m.zone })) };
    }

    // Burning, on top of one placement.
    const bp0 = CFG.placements.find((p) => p.key === CFG.burn.placement);
    const burned = await shoot(src, "burned", bp0.label + " + edges and sky burned", { placement: bp0.placements, burnEdges: CFG.burn.edges, burnSky: CFG.burn.sky, depth: CFG.burn.depth });

    // Opportunities sheets, from the neutral print.
    await setState(src, {});
    const sheets = [];
    for (const masses of [false, true]) {
      app.activeDocument = src;
      await V.makeOpportunitiesSheet({ thumb: 200, masses });
      const sheet = app.activeDocument;
      sheets.push(await capture(sheet, sheet.width));
      await sheet.closeWithoutSaving();
    }

    // Figures.
    const fl = (id) => Z.filterById(id).label;
    await figure("01-scene-markers", [[{ pic: colourBig }]], { markers: CFG.markers });
    await figure("02-mono-zone-map", [[{ pic: colour, label: "Colour" }, { pic: base.plain, label: "Monochrome preview" }, { pic: base.zones, label: "Zone map" }]], { legend: true });
    await figure(
      "03-isolations",
      [
        [
          { pic: overlays.darks, label: "Textured darks (II–III)" },
          { pic: overlays.lights, label: "Textured lights (VII–VIII)" },
          { pic: overlays.middle, label: "Middle (IV–VI)" },
          { pic: overlays.dead, label: "No texture (0–I, IX–X)" },
        ],
      ],
      { legend: true }
    );
    await figure("04-value-masses", [[{ pic: overlays.families, label: "Ink families" }, { pic: overlays.four, label: "Four values" }, { pic: overlays.notan, label: "Light / shadow, split at VI" }]]);
    await figure("05-filters", [CFG.filtersShown.map((id) => ({ pic: filterShots[id].plain, label: fl(id) })), CFG.filtersShown.map((id) => ({ pic: filterShots[id].zones, label: fl(id) + ", zones" }))], { legend: true });
    await figure("06-development", [CFG.developments.map((n) => ({ pic: devShots[n].plain, label: Z.devLabel(n) })), CFG.developments.map((n) => ({ pic: devShots[n].zones, label: Z.devLabel(n) + ", zones" }))], { legend: true });
    const placeRow = (kind) => [{ pic: devShots[0][kind], label: kind === "plain" ? "As metered (N)" : "As metered, zones" }].concat(CFG.placements.map((p) => ({ pic: placeShots[p.key][kind], label: kind === "plain" ? p.label : p.label + ", zones" })));
    await figure("07-placement", [placeRow("plain"), placeRow("zones")], { legend: true });
    await figure("08-burning", [[{ pic: placeShots[CFG.burn.placement].plain, label: "Before burning" }, { pic: burned.plain, label: "Edges and sky burned" }, { pic: burned.zones, label: "Burned, zones" }]], { legend: true });
    await figure("09-opportunities", [[{ pic: sheets[0] }]]);
    await figure("10-opportunities-masses", [[{ pic: sheets[1] }]]);
  }

  core.executeAsModal(
    async (ctx) => {
      try {
        await run(ctx);
      } catch (e) {
        errors.push(String((e && e.stack) || e));
      }
      out.errors = errors;
      await app.documents.add({ width: 10, height: 10, resolution: 72, mode: "RGBColorMode", fill: "white", name: "VF_WALK_RESULTS" });
      await bp({ _obj: "set", _target: [{ _ref: "property", _property: "fileInfo" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "fileInfo", caption: JSON.stringify(out) } });
    },
    { commandName: "Visualize First walkthrough" }
  );
})();
