/*
 * Visualize First — Photoshop operations.
 *
 * Everything the panel does to a document happens inside one layer group,
 * "Visualize First", at the top of the stack. The image's own layers are
 * never edited. Each operation is a single history step, and measurements
 * roll back so they leave no trace.
 */
(function (root) {
  "use strict";
  const Z = root.VFZones;

  const GROUP = "Visualize First";
  const PREFIX = "VF · ";
  const NAMES = {
    overlay: "Overlay",
    ladder: "Zone ladder",
    burnSky: "Burn sky",
    burnEdges: "Burn edges",
    dev: "Development",
    filter: "Filter",
    optical: "Optical average",
  };
  // Top to bottom inside the group. Overlays read the finished print; the
  // ladder sits under the overlay so it doubles as a legend.
  const ORDER = ["overlay", "ladder", "burnSky", "burnEdges", "dev", "filter", "optical"];
  const HELPERS = ["overlay", "ladder"];
  const PRINT = ["dev", "burnEdges", "burnSky"];

  const layerName = (key, detail) => PREFIX + NAMES[key] + (detail ? " — " + detail : "");

  class VFError extends Error {}

  const PS = () => require("photoshop");
  // batchPlay reports failures as result objects rather than throwing.
  async function bp(descs) {
    const list = Array.isArray(descs) ? descs : [descs];
    const results = await PS().action.batchPlay(list, {});
    const err = (results || []).find((r) => r && r._obj === "error");
    if (err) throw new VFError(String(err.message || "Photoshop couldn't complete that step.").replace(/^[^:]*\.psjs: /, ""));
    return results;
  }

  let runModal = (name, fn) => PS().core.executeAsModal(fn, { commandName: name });
  function setModalRunner(fn) {
    runModal = fn;
  }

  // ---- Descriptors ----------------------------------------------------------

  const pct = (v) => ({ _unit: "percentUnit", _value: v });
  const pxu = (v) => ({ _unit: "pixelsUnit", _value: v });
  const rgbDesc = (c) => ({ _obj: "RGBColor", red: c[0], grain: c[1], blue: c[2] });
  const point = (x, y) => ({ _obj: "paint", horizontal: pxu(x), vertical: pxu(y) });

  const mixerType = (w) => ({
    _obj: "channelMixer",
    presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
    monochromatic: true,
    gray: { _obj: "channelMatrix", red: pct(w[0]), grain: pct(w[1]), blue: pct(w[2]), constant: pct(0) },
  });

  const curvesType = (pts) => ({
    _obj: "curves",
    presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
    adjustment: [
      {
        _obj: "curvesAdjustment",
        channel: { _ref: "channel", _enum: "channel", _value: "composite" },
        curve: pts.map((p) => ({ _obj: "paint", horizontal: p[0], vertical: p[1] })),
      },
    ],
  });

  const gradientDesc = (stops) => ({
    _obj: "gradientClassEvent",
    name: GROUP,
    gradientForm: { _enum: "gradientForm", _value: "customStops" },
    interfaceIconFrameDimmed: 4096,
    colors: stops.map((s) => ({
      _obj: "colorStop",
      color: rgbDesc(s.rgb),
      type: { _enum: "colorStopType", _value: "userStop" },
      location: s.loc,
      midpoint: 50,
    })),
    transparency: [
      { _obj: "transferSpec", opacity: pct(100), location: 0, midpoint: 50 },
      { _obj: "transferSpec", opacity: pct(100), location: 4096, midpoint: 50 },
    ],
  });

  const gradientMapType = (stops) => ({ _obj: "gradientMapClass", gradient: gradientDesc(stops) });
  const makeAdjustment = (name, type) => ({ _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", name, type } });
  const setAdjustment = (id, type) => ({ _obj: "set", _target: [{ _ref: "adjustmentLayer", _id: id }], to: type });
  const makePixelLayer = (name) => ({ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name } });
  const select = (id) => bp({ _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false });

  // ---- Document checks ------------------------------------------------------

  const isRGB = (doc) => /rgb/i.test(String(doc.mode));
  const isGray = (doc) => /gray/i.test(String(doc.mode));
  const bitsOf = (doc) => (/16/.test(String(doc.bitsPerChannel)) ? 16 : /32/.test(String(doc.bitsPerChannel)) ? 32 : 8);
  const transferOf = (doc) => Z.transferFor(doc.colorProfileName);
  const titleOf = (doc) => doc.title || doc.name || "Untitled";

  function checkDoc(doc) {
    if (!doc) throw new VFError("Open an image first.");
    if (!isRGB(doc) && !isGray(doc)) throw new VFError("Visualize First works on RGB or Grayscale images. Use Image ▸ Mode to convert a copy.");
    if (bitsOf(doc) === 32) throw new VFError("32-bit images aren't supported. Use Image ▸ Mode ▸ 16 Bits/Channel on a copy.");
  }

  function activeDoc() {
    try {
      return PS().app.activeDocument || null;
    } catch (e) {
      return null;
    }
  }

  // ---- Group and layer bookkeeping --------------------------------------------

  const findGroup = (doc) => doc.layers.find((l) => l.kind === "group" && l.name === GROUP) || null;
  const findChild = (group, key) => (group ? group.layers.find((l) => l.name.startsWith(PREFIX + NAMES[key])) || null : null);

  async function ensureGroup(doc) {
    const existing = findGroup(doc);
    if (existing) return existing;
    await select(doc.layers[0].id);
    await bp({ _obj: "make", _target: [{ _ref: "layerSection" }], using: { _obj: "layerSection", name: GROUP } });
    const g = doc.activeLayers[0];
    if (g.parent) g.move(doc.layers[0], PS().constants.ElementPlacement.PLACEBEFORE);
    return findGroup(doc) || g;
  }

  function orderGroup(group) {
    const present = ORDER.map((k) => findChild(group, k)).filter(Boolean);
    // Moving each to the top of the group, bottom-most first, leaves ORDER.
    for (let i = present.length - 1; i >= 0; i--) present[i].move(group, PS().constants.ElementPlacement.PLACEINSIDE);
  }

  async function createChild(doc, group, key, descriptor) {
    // New layers land above the selected layer, inside its group; with the
    // empty group itself selected they land inside it.
    await select(group.layers.length ? group.layers[0].id : group.id);
    await bp(descriptor);
    const layer = doc.activeLayers[0];
    if (!layer.parent || layer.parent.id !== group.id) layer.move(group, PS().constants.ElementPlacement.PLACEINSIDE);
    orderGroup(group);
    return findChild(group, key) || layer;
  }

  async function restoreSelection(doc, ids) {
    const alive = ids.filter((id) => doc.layers && findById(doc.layers, id));
    if (!alive.length) return;
    await select(alive[0]);
    for (const id of alive.slice(1)) {
      await bp({
        _obj: "select",
        _target: [{ _ref: "layer", _id: id }],
        selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" },
        makeVisible: false,
      });
    }
  }

  function findById(layers, id) {
    for (const l of layers) {
      if (l.id === id) return l;
      if (l.layers) {
        const hit = findById(l.layers, id);
        if (hit) return hit;
      }
    }
    return null;
  }

  // Run fn(doc) as one modal, single-history-step operation. With commit
  // false the document is rolled back afterwards (used for measuring).
  function inDoc(name, fn, { commit = true, docId = null } = {}) {
    return runModal(name, async (ctx) => {
      if (docId !== null) {
        const target = PS().app.documents.find((d) => d.id === docId);
        if (!target) throw new VFError("That image is no longer open.");
        if (activeDoc() && activeDoc().id !== docId) PS().app.activeDocument = target;
      }
      const doc = activeDoc();
      checkDoc(doc);
      const host = ctx && ctx.hostControl;
      let sid = null;
      if (host && host.suspendHistory) {
        try {
          sid = await host.suspendHistory({ documentID: doc.id, name: GROUP + ": " + name });
        } catch (e) {
          sid = null;
        }
      }
      const prevSel = doc.activeLayers.map((l) => l.id);
      let ok = false;
      try {
        const result = await fn(doc);
        ok = true;
        return result;
      } finally {
        if (commit && ok) await restoreSelection(doc, prevSel).catch(() => {});
        if (sid !== null) await host.resumeHistory(sid, commit && ok).catch(() => {});
      }
    });
  }

  // Make sure the artist can see our work if they hid the group.
  function showGroup(group) {
    if (!group.visible) group.visible = true;
  }

  function hide(group, keys) {
    const prev = [];
    for (const k of keys) {
      const l = findChild(group, k);
      if (l && l.visible) {
        prev.push(l);
        l.visible = false;
      }
    }
    return () => prev.forEach((l) => (l.visible = true));
  }

  // ---- Reading pixels -----------------------------------------------------------

  const maxOf = (data) => (data instanceof Uint16Array ? 32768 : data instanceof Float32Array ? 1 : 255);

  // Lightness (L*) of the composite, optionally a region and/or downsampled.
  async function readLightness(doc, { bounds, targetSize } = {}) {
    const opts = { documentID: doc.id, colorSpace: "Lab" };
    if (bounds) opts.sourceBounds = bounds;
    if (targetSize) opts.targetSize = targetSize;
    const res = await PS().imaging.getPixels(opts);
    const img = res.imageData;
    try {
      const data = await img.getData();
      const max = maxOf(data);
      const c = img.components;
      const n = img.width * img.height;
      const L = new Float32Array(n);
      for (let i = 0; i < n; i++) L[i] = (data[i * c] / max) * 100;
      return { L, width: img.width, height: img.height };
    } finally {
      img.dispose();
    }
  }

  // 8-bit sRGB pixels of the composite (for thumbnails).
  async function readRGB8(doc, targetSize) {
    const res = await PS().imaging.getPixels({ documentID: doc.id, targetSize, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
    const img = res.imageData;
    try {
      const data = await img.getData();
      const max = maxOf(data);
      const c = img.components;
      const n = img.width * img.height;
      const out = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 3; j++) out[i * 3 + j] = Math.round((data[i * c + Math.min(j, c - 1)] / max) * 255);
      }
      return { data: out, width: img.width, height: img.height };
    } finally {
      img.dispose();
    }
  }

  const SPOTS = {
    spot: (doc) => Math.max(1, Math.round(Math.max(doc.width, doc.height) * 0.01)),
    small: () => 2,
    pixel: () => 0,
  };

  function listMarkers(doc) {
    try {
      return doc.colorSamplers.map((s, i) => ({ index: i + 1, x: Math.round(s.position.x), y: Math.round(s.position.y) }));
    } catch (e) {
      return [];
    }
  }

  async function meterAt(doc, x, y, r) {
    const W = doc.width;
    const H = doc.height;
    const bounds = {
      left: Z.clamp(x - r, 0, W - 1),
      top: Z.clamp(y - r, 0, H - 1),
      right: Z.clamp(x + r + 1, 1, W),
      bottom: Z.clamp(y + r + 1, 1, H),
    };
    const { L } = await readLightness(doc, { bounds });
    return Z.meterAverage(L);
  }

  async function meterMarkers(doc, spot, onlyIndexes) {
    const r = (SPOTS[spot] || SPOTS.spot)(doc);
    const out = [];
    for (const m of listMarkers(doc)) {
      if (onlyIndexes && !onlyIndexes.includes(m.index)) continue;
      out.push(Object.assign({}, m, { L: await meterAt(doc, m.x, m.y, r) }));
    }
    return out;
  }

  // ---- Snapshot (no modal needed) ----------------------------------------------

  function docInfo() {
    const doc = activeDoc();
    if (!doc) return null;
    const group = findGroup(doc);
    const layers = {};
    for (const k of ORDER) {
      const l = findChild(group, k);
      if (l) layers[k] = { visible: l.visible, opacity: l.opacity, name: l.name };
    }
    return {
      id: doc.id,
      title: titleOf(doc),
      width: doc.width,
      height: doc.height,
      resolution: doc.resolution,
      isRGB: isRGB(doc),
      isGray: isGray(doc),
      bits: bitsOf(doc),
      profile: doc.colorProfileName,
      markers: listMarkers(doc),
      hasGroup: !!group,
      groupVisible: group ? group.visible : false,
      layers,
    };
  }

  // ---- Print layers -----------------------------------------------------------

  async function applyFilter(doc, group, filterId, visible = true) {
    if (!isRGB(doc)) return null;
    const f = Z.filterById(filterId);
    let layer = findChild(group, "filter");
    if (!layer) layer = await createChild(doc, group, "filter", makeAdjustment(layerName("filter", f.label), mixerType(f.weights)));
    else await bp(setAdjustment(layer.id, mixerType(f.weights)));
    layer.name = layerName("filter", f.label);
    layer.visible = visible;
    return layer;
  }

  async function applyCurve(doc, group, key, points, detail) {
    let layer = findChild(group, key);
    if (!layer) layer = await createChild(doc, group, key, makeAdjustment(layerName(key, detail), curvesType(points)));
    else await bp(setAdjustment(layer.id, curvesType(points)));
    layer.name = layerName(key, detail);
    layer.visible = true;
    return layer;
  }

  const devPoints = (doc, n, scale) => Z.toCurvePoints(Z.developmentPairs(n, scale), transferOf(doc));

  async function ensureMask(layer) {
    await select(layer.id);
    const r = await bp({ _obj: "get", _target: [{ _property: "hasUserMask" }, { _ref: "layer", _id: layer.id }] });
    if (!(r && r[0] && r[0].hasUserMask)) {
      await bp({
        _obj: "make",
        new: { _class: "channel" },
        at: { _ref: "channel", _enum: "channel", _value: "mask" },
        using: { _enum: "userMaskEnabled", _value: "revealAll" },
      });
    }
  }

  async function paintMaskGradient(layer, from, to, type, stops) {
    await ensureMask(layer);
    await bp({ _obj: "select", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }], makeVisible: false });
    await bp({
      _obj: "gradientClassEvent",
      from: point(from[0], from[1]),
      to: point(to[0], to[1]),
      type: { _enum: "gradientType", _value: type },
      dither: true,
      useMask: true,
      reverse: false,
      gradient: gradientDesc(stops),
    });
    await select(layer.id);
  }

  const BLACK = [0, 0, 0];
  const WHITE = [255, 255, 255];

  async function edgeMask(doc, layer) {
    // White (burn) at the corners, untouched through the middle.
    await paintMaskGradient(layer, [doc.width / 2, doc.height / 2], [0, 0], "radial", [
      { loc: 0, rgb: BLACK },
      { loc: 1850, rgb: BLACK },
      { loc: 4096, rgb: WHITE },
    ]);
  }

  async function skyMask(doc, layer, depth) {
    await paintMaskGradient(layer, [doc.width / 2, 0], [doc.width / 2, Math.max(1, doc.height * depth)], "linear", [
      { loc: 0, rgb: WHITE },
      { loc: 4096, rgb: BLACK },
    ]);
  }

  // ---- Public operations ----------------------------------------------------------

  function setOverlay({ mode, opacity = 100, split = 6, scale = Z.SCREEN_SCALE }) {
    return inDoc("Overlay", async (doc) => {
      const group = await ensureGroup(doc);
      let layer = findChild(group, "overlay");
      if (mode === "off") {
        if (layer) layer.visible = false;
        return;
      }
      const label = (Z.OVERLAY_MODES.find((m) => m.id === mode) || {}).label || mode;
      const stops = Z.overlayStops(mode, { scale, transfer: transferOf(doc), split });
      if (!layer) layer = await createChild(doc, group, "overlay", makeAdjustment(layerName("overlay", label), gradientMapType(stops)));
      else await bp(setAdjustment(layer.id, gradientMapType(stops)));
      layer.name = layerName("overlay", label);
      layer.opacity = Z.clamp(opacity, 0, 100);
      layer.visible = true;
      showGroup(group);
    });
  }

  function hideOverlay() {
    const doc = activeDoc();
    const layer = doc && findChild(findGroup(doc), "overlay");
    if (!layer || !layer.visible) return Promise.resolve();
    return inDoc("Hide overlay", async (d) => {
      const l = findChild(findGroup(d), "overlay");
      if (l) l.visible = false;
    });
  }

  function setMonochrome(on) {
    return inDoc(on ? "Monochrome on" : "Monochrome off", async (doc) => {
      if (!isRGB(doc)) return;
      const group = await ensureGroup(doc);
      const layer = findChild(group, "filter");
      if (layer) layer.visible = on;
      else if (on) await applyFilter(doc, group, "none", true);
      showGroup(group);
    });
  }

  function setFilter(filterId) {
    return inDoc("Filter", async (doc) => {
      if (!isRGB(doc)) throw new VFError("Filters need colour. This image is Grayscale.");
      const group = await ensureGroup(doc);
      await applyFilter(doc, group, filterId, true);
      showGroup(group);
    });
  }

  function setDevelopment({ n, scale = Z.SCREEN_SCALE }) {
    return inDoc("Development " + Z.devLabel(n), async (doc) => {
      const group = await ensureGroup(doc);
      await applyCurve(doc, group, "dev", devPoints(doc, n, scale), Z.devLabel(n));
      showGroup(group);
    });
  }

  // Place one marker on a zone, and optionally let another fall on a second
  // zone: Adams's exposure-then-development decision, as one curve.
  function placeMarkers({ placements, scale = Z.SCREEN_SCALE, spot = "spot" }) {
    return inDoc("Place and develop", async (doc) => {
      const group = await ensureGroup(doc);
      const restore = hide(group, HELPERS.concat(PRINT));
      let metered;
      try {
        metered = await meterMarkers(doc, spot, placements.map((p) => p.index));
      } finally {
        restore();
      }
      if (metered.length !== placements.length) throw new VFError("Couldn't find those markers. Check the Color Sampler markers on the image.");
      const markers = placements.map((p) => ({ index: p.index, zone: p.zone, L: metered.find((m) => m.index === p.index).L }));
      const pairs = Z.placementPairs(markers, scale);
      const summary = Z.placementSummary(markers, scale);
      const detail = markers.map((m) => "#" + m.index + "→" + Z.roman(m.zone)).join(" ");
      await applyCurve(doc, group, "dev", Z.toCurvePoints(pairs, transferOf(doc)), detail);
      showGroup(group);
      return Object.assign(summary, { markers: markers.map((m) => Object.assign({}, m, { from: Z.zoneValue(m.L, scale) })) });
    });
  }

  function setBurnEdges(amount) {
    return inDoc("Burn edges", async (doc) => {
      const group = await ensureGroup(doc);
      let layer = findChild(group, "burnEdges");
      if (!layer) {
        if (amount <= 0) return;
        const pts = Z.toCurvePoints(Z.burnPairs(), transferOf(doc));
        layer = await createChild(doc, group, "burnEdges", makeAdjustment(layerName("burnEdges"), curvesType(pts)));
        await edgeMask(doc, layer);
      }
      // Rename first: renaming a layer makes it visible again.
      layer.name = layerName("burnEdges", Math.round(amount) + "%");
      layer.opacity = Z.clamp(Math.round(amount), 0, 100);
      layer.visible = amount > 0;
      showGroup(group);
    });
  }

  function setBurnSky({ amount, depth = 0.4 }) {
    return inDoc("Burn sky", async (doc) => {
      const group = await ensureGroup(doc);
      let layer = findChild(group, "burnSky");
      const fresh = !layer;
      if (fresh) {
        if (amount <= 0) return;
        const pts = Z.toCurvePoints(Z.burnPairs(), transferOf(doc));
        layer = await createChild(doc, group, "burnSky", makeAdjustment(layerName("burnSky"), curvesType(pts)));
      }
      const depthLabel = Math.round(depth * 100) + "% down";
      if (fresh || !layer.name.includes(depthLabel)) await skyMask(doc, layer, depth);
      layer.name = layerName("burnSky", Math.round(amount) + "%, " + depthLabel);
      layer.opacity = Z.clamp(Math.round(amount), 0, 100);
      layer.visible = amount > 0;
      showGroup(group);
    });
  }

  // Back to the scene as metered: no filter, N development, no burning.
  function resetPrint() {
    return inDoc("Neutral print", async (doc) => {
      const group = findGroup(doc);
      if (!group) return;
      const filter = findChild(group, "filter");
      if (filter) await applyFilter(doc, group, "none", filter.visible);
      const dev = findChild(group, "dev");
      if (dev) await applyCurve(doc, group, "dev", devPoints(doc, 0, Z.SCREEN_SCALE), "N");
      for (const k of ["burnEdges", "burnSky"]) {
        const l = findChild(group, k);
        if (l) l.visible = false;
      }
    });
  }

  function measureMarkers({ scale = Z.SCREEN_SCALE, spot = "spot" } = {}) {
    return inDoc(
      "Measure",
      async (doc) => {
        const group = findGroup(doc);
        const restore = group ? hide(group, HELPERS) : () => {};
        try {
          const metered = await meterMarkers(doc, spot);
          return metered.map((m) => Object.assign(m, { zone: Z.zoneValue(m.L, scale) }));
        } finally {
          restore();
        }
      },
      { commit: false }
    );
  }

  function measureDistribution({ scale = Z.SCREEN_SCALE } = {}) {
    return inDoc(
      "Measure",
      async (doc) => {
        const group = findGroup(doc);
        const restore = group ? hide(group, HELPERS) : () => {};
        try {
          const size = Math.min(480, Math.max(doc.width, doc.height));
          const targetSize = doc.width >= doc.height ? { width: size } : { height: size };
          const { L } = await readLightness(doc, { targetSize });
          const fractions = Z.zoneFractions(L, scale);
          return { fractions, analysis: Z.analyze(fractions) };
        } finally {
          restore();
        }
      },
      { commit: false }
    );
  }

  // Copy composite pixels into a layer, matching the document's depth and
  // mode, optionally Gaussian-blurred (sigma in pixels).
  async function putComposite(doc, layer, res, bounds, sigma) {
    const img = res.imageData;
    const { width, height, components: c } = img;
    let data;
    try {
      data = await img.getData();
    } finally {
      img.dispose();
    }
    const srcMax = maxOf(data);
    const bits = bitsOf(doc);
    const outComps = isRGB(doc) ? 3 : 1;
    const n = width * height;
    const out = bits === 16 ? new Uint16Array(n * outComps) : new Uint8Array(n * outComps);
    const outMax = bits === 16 ? 32768 : 255;
    const k = outMax / srcMax;
    for (let i = 0; i < n; i++) for (let j = 0; j < outComps; j++) out[i * outComps + j] = Math.round(data[i * c + j] * k);
    data = null;
    if (sigma) Z.blurPixels(out, width, height, outComps, outComps, sigma);
    const options = { width, height, components: outComps, colorSpace: isRGB(doc) ? "RGB" : "Grayscale", colorProfile: doc.colorProfileName };
    if (bits === 16) options.componentSize = 16;
    const put = await PS().imaging.createImageDataFromBuffer(out, options);
    try {
      await PS().imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: put, targetBounds: bounds });
    } finally {
      put.dispose();
    }
  }

  // Blur a copy of the image until hatching merges, the way a drawing reads
  // from across the room. Overlays then show the zones the marks produce.
  function makeOpticalAverage({ mm = 1 }) {
    return inDoc("Optical average", async (doc) => {
      const group = await ensureGroup(doc);
      const old = findChild(group, "optical");
      if (old) old.delete();
      // Copy the image as it looks without any of our layers.
      const restore = hide(group, ORDER);
      let res;
      try {
        res = await PS().imaging.getPixels({ documentID: doc.id });
      } finally {
        restore();
      }
      const radius = Math.max(0.5, (mm * (doc.resolution || 72)) / 25.4);
      const layer = await createChild(doc, group, "optical", makePixelLayer(layerName("optical", mm.toFixed(1) + " mm")));
      await putComposite(doc, layer, res, { left: 0, top: 0 }, radius);
      return { radius };
    });
  }

  // An eleven-step strip down the right edge, from Zone X at the top to 0.
  function addLadder({ scale = Z.SCREEN_SCALE }) {
    return inDoc("Zone ladder", async (doc) => {
      const group = await ensureGroup(doc);
      const old = findChild(group, "ladder");
      if (old) old.delete();
      const t = transferOf(doc);
      const W = doc.width;
      const H = doc.height;
      const sw = Math.max(12, Math.round(Math.max(W, H) * 0.035));
      const bits = bitsOf(doc);
      const comps = isRGB(doc) ? 3 : 1;
      const max = bits === 16 ? 32768 : 255;
      const buf = bits === 16 ? new Uint16Array(sw * H * comps) : new Uint8Array(sw * H * comps);
      for (let y = 0; y < H; y++) {
        const k = 10 - Math.min(10, Math.floor((y / H) * 11));
        const v = Math.round(Z.encodeL(Z.lOfZone(k, scale), t) * max);
        for (let x = 0; x < sw; x++) for (let j = 0; j < comps; j++) buf[(y * sw + x) * comps + j] = v;
      }
      const layer = await createChild(doc, group, "ladder", makePixelLayer(layerName("ladder")));
      const options = { width: sw, height: H, components: comps, colorSpace: comps === 3 ? "RGB" : "Grayscale", colorProfile: doc.colorProfileName };
      if (bits === 16) options.componentSize = 16;
      const img = await PS().imaging.createImageDataFromBuffer(buf, options);
      try {
        await PS().imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: img, targetBounds: { left: W - sw, top: 0 } });
      } finally {
        img.dispose();
      }
    });
  }

  function removeLayer(key) {
    return inDoc("Remove " + NAMES[key], async (doc) => {
      const l = findChild(findGroup(doc), key);
      if (l) l.delete();
    });
  }

  function clearMarkers() {
    return inDoc("Clear markers", async (doc) => {
      try {
        doc.colorSamplers.removeAll();
      } catch (e) {
        for (const s of Array.from(doc.colorSamplers).reverse()) s.remove();
      }
    });
  }

  function convertToRGB() {
    return inDoc("Convert to RGB", async () => {
      await bp({ _obj: "convertMode", to: { _class: "RGBColorMode" } });
    });
  }

  function applyVariant({ filterId, n, scale = Z.SCREEN_SCALE, docId = null }) {
    return inDoc(
      "Apply variant",
      async (doc) => {
        const group = await ensureGroup(doc);
        if (isRGB(doc)) await applyFilter(doc, group, filterId, true);
        await applyCurve(doc, group, "dev", devPoints(doc, n, scale), Z.devLabel(n));
        showGroup(group);
      },
      { docId }
    );
  }

  // ---- Opportunities sheet ---------------------------------------------------------

  async function addText(doc, text, x, y, size, color, bold) {
    await bp({
      _obj: "make",
      _target: [{ _ref: "textLayer" }],
      using: {
        _obj: "textLayer",
        textKey: text,
        textClickPoint: { _obj: "paint", horizontal: pct((x / doc.width) * 100), vertical: pct((y / doc.height) * 100) },
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
              color: rgbDesc(color),
            },
          },
        ],
      },
    });
  }

  const shortKey = { low: "Low key", middle: "Middle key", high: "High key" };
  const shortRange = { full: "full scale", "no-white": "no white", "no-black": "no black", compressed: "no black or white" };

  // Render every filter × development combination of the image into a new
  // document: one scene, many possible performances.
  function makeOpportunitiesSheet({ filters = Z.SHEET_FILTERS, devs = Z.SHEET_DEVS, thumb = 320, includeBurns = true, masses = false, scale = Z.SCREEN_SCALE } = {}) {
    return runModal("Opportunities sheet", async (ctx) => {
      const ps = PS();
      const doc = activeDoc();
      checkDoc(doc);
      const host = ctx && ctx.hostControl;
      const rgb = isRGB(doc);
      const rows = rgb ? filters : ["none"];
      const cells = [];
      const sid = await host.suspendHistory({ documentID: doc.id, name: GROUP + ": Opportunities" });
      try {
        const group = await ensureGroup(doc);
        hide(group, ["ladder"]);
        if (!includeBurns) hide(group, ["burnEdges", "burnSky"]);
        const t = transferOf(doc);
        if (masses) {
          const stops = Z.overlayStops("four", { scale, transfer: t });
          const ov = findChild(group, "overlay");
          if (ov) await bp(setAdjustment(ov.id, gradientMapType(stops)));
          else await createChild(doc, group, "overlay", makeAdjustment(layerName("overlay"), gradientMapType(stops)));
          const layer = findChild(group, "overlay");
          layer.opacity = 100;
          layer.visible = true;
        } else {
          hide(group, ["overlay"]);
        }
        showGroup(group);
        const targetSize = doc.width >= doc.height ? { width: thumb } : { height: thumb };
        for (const f of rows) {
          if (rgb) await applyFilter(doc, group, f, true);
          for (const n of devs) {
            await applyCurve(doc, group, "dev", devPoints(doc, n, scale), Z.devLabel(n));
            const pic = await readRGB8(doc, targetSize);
            const { L } = await readLightness(doc, { targetSize: doc.width >= doc.height ? { width: 160 } : { height: 160 } });
            cells.push({ filter: f, n, pic, analysis: Z.analyze(Z.zoneFractions(L, scale)) });
          }
        }
      } finally {
        await host.resumeHistory(sid, false);
      }

      const tw = cells[0].pic.width;
      const th = cells[0].pic.height;
      const M = 36;
      const labelW = 150;
      const headerH = 104;
      const gap = 20;
      const capH = 26;
      const cols = devs.length;
      const W = M * 2 + labelW + cols * tw + (cols - 1) * gap;
      const H = M * 2 + headerH + rows.length * (th + capH) + (rows.length - 1) * gap;
      const buf = new Uint8Array(W * H * 3).fill(255);
      const cellX = (ci) => M + labelW + ci * (tw + gap);
      const cellY = (ri) => M + headerH + ri * (th + capH + gap);
      cells.forEach((cell, i) => {
        const ri = Math.floor(i / cols);
        const ci = i % cols;
        const x0 = cellX(ci);
        const y0 = cellY(ri);
        const { data, width, height } = cell.pic;
        for (let y = 0; y < height && y0 + y < H; y++) {
          const src = y * width * 3;
          const dst = ((y0 + y) * W + x0) * 3;
          buf.set(data.subarray(src, src + Math.min(width, W - x0) * 3), dst);
        }
      });

      await ps.app.documents.add({ width: W, height: H, resolution: 72, mode: "RGBColorMode", fill: "white", name: "Opportunities — " + titleOf(doc) });
      const sheet = activeDoc();
      await bp(makePixelLayer("Thumbnails"));
      const layer = sheet.activeLayers[0];
      const img = await ps.imaging.createImageDataFromBuffer(buf, { width: W, height: H, components: 3, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
      try {
        await ps.imaging.putPixels({ documentID: sheet.id, layerID: layer.id, imageData: img, targetBounds: { left: 0, top: 0 } });
      } finally {
        img.dispose();
      }

      const ink = [35, 35, 35];
      const soft = [110, 110, 110];
      try {
        await addText(sheet, "Opportunities — " + titleOf(doc), M, M + 22, 22, ink, true);
        await addText(sheet, "One scene, many performances. Rows: filter. Columns: development (Zone III held, highlights moved).", M, M + 48, 13, soft, false);
        const colNames = { "-2": "N−2 · compress more", "-1": "N−1 · compress", 0: "N · as metered", 1: "N+1 · expand", 2: "N+2 · expand more" };
        for (let ci = 0; ci < cols; ci++) await addText(sheet, colNames[devs[ci]] || Z.devLabel(devs[ci]), cellX(ci), M + headerH - 14, 14, ink, true);
        for (let ri = 0; ri < rows.length; ri++) {
          await addText(sheet, rgb ? Z.filterById(rows[ri]).label : "Grayscale", M, cellY(ri) + 20, 14, ink, true);
        }
        for (let i = 0; i < cells.length; i++) {
          const a = cells[i].analysis;
          const text = `${shortKey[a.key]} · ${shortRange[a.range]} · ${Math.round(a.dark * 100)}% dark`;
          await addText(sheet, text, cellX(i % cols), cellY(Math.floor(i / cols)) + th + 17, 11, soft, false);
        }
      } catch (e) {
        // Labels are a convenience; the sheet is still useful without them.
      }
      return { variants: cells.map((c) => ({ filterId: c.filter, n: c.n })), width: W, height: H, sourceId: doc.id, sourceTitle: titleOf(doc) };
    });
  }

  root.VFps = {
    GROUP,
    NAMES,
    ORDER,
    VFError,
    setModalRunner,
    docInfo,
    setOverlay,
    hideOverlay,
    setMonochrome,
    setFilter,
    setDevelopment,
    placeMarkers,
    setBurnEdges,
    setBurnSky,
    resetPrint,
    measureMarkers,
    measureDistribution,
    makeOpticalAverage,
    addLadder,
    removeLayer,
    clearMarkers,
    convertToRGB,
    applyVariant,
    makeOpportunitiesSheet,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
