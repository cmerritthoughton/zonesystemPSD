/*
 * Visualize First — Photoshop operations.
 *
 * Everything the panel does to a document happens inside one layer group,
 * "Visualize First", at the top of the stack. The image's own layers are
 * never edited. Each operation is a single history step, and measurements
 * roll back so they leave no trace.
 *
 * Safety rules, because a plugin runs inside the artist's Photoshop:
 *  - pixel work is done in bands under a fixed memory budget;
 *  - long operations report progress and honour Esc, rolling back fully;
 *  - every value is sanitised before it reaches batchPlay or the DOM;
 *  - an active selection is set aside so it can't mask new layers.
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
  const CANCELLED = "Cancelled. Nothing was changed.";

  const PS = () => require("photoshop");

  function requireApis() {
    const ps = PS();
    const ok = ps && ps.core && typeof ps.core.executeAsModal === "function" && ps.imaging && typeof ps.imaging.getPixels === "function";
    if (!ok || typeof ps.imaging.getSelection !== "function") throw new VFError("This panel needs Photoshop 2024 (25.0) or later.");
  }

  // Turn Photoshop's own failures into something an artist can act on.
  function friendlyError(e) {
    if (e instanceof VFError) return e;
    const msg = String((e && e.message) || e || "");
    if (/cancel/i.test(msg)) return new VFError(CANCELLED);
    if (/modal/i.test(msg)) return new VFError("Photoshop is busy. Close any open dialog, finish text editing or a transform, then try again.");
    return e;
  }

  // Between steps of a long operation: honour Esc and show progress.
  function checkpoint(ctx, value) {
    if (ctx && ctx.isCancelled) throw new VFError(CANCELLED);
    if (ctx && typeof ctx.reportProgress === "function" && Number.isFinite(value)) {
      try {
        ctx.reportProgress({ value: Math.min(1, Math.max(0, value)) });
      } catch (e) {
        /* progress is cosmetic */
      }
    }
  }
  // batchPlay reports failures as result objects rather than throwing.
  async function bp(descs) {
    const list = Array.isArray(descs) ? descs : [descs];
    const results = await PS().action.batchPlay(list, {});
    const err = (results || []).find((r) => r && r._obj === "error");
    if (err) throw new VFError(String(err.message || "Photoshop couldn't complete that step.").replace(/^[^:]*\.psjs: /, ""));
    return results;
  }

  let runModal = async (name, fn) => {
    try {
      return await PS().core.executeAsModal(fn, { commandName: GROUP + ": " + name });
    } catch (e) {
      throw friendlyError(e);
    }
  };
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

  // A new adjustment layer takes its mask from an active selection, and
  // gradients are clipped to it. Copy the selection's mask (just its own
  // bounds), deselect, and return { restore, release }: restore puts it back,
  // release frees the copy when history rollback restores it instead.
  // (Saving to a channel isn't available to plugins in Photoshop 2026.)
  async function setSelectionAside(doc) {
    let bounds = null;
    try {
      const r = await bp({ _obj: "get", _target: [{ _property: "selection" }, { _ref: "document", _id: doc.id }] });
      const b = r && r[0] && r[0].selection;
      if (b && b.left && b.right) {
        bounds = { left: Math.floor(b.left._value), top: Math.floor(b.top._value), right: Math.ceil(b.right._value), bottom: Math.ceil(b.bottom._value) };
      }
    } catch (e) {
      bounds = null;
    }
    if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;
    const saved = await PS().imaging.getSelection({ documentID: doc.id, sourceBounds: bounds });
    let held = true;
    const release = () => {
      if (held) saved.imageData.dispose();
      held = false;
    };
    try {
      await bp({ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } });
    } catch (e) {
      release();
      throw e;
    }
    const at = saved.sourceBounds || bounds;
    return {
      release,
      async restore() {
        try {
          await PS().imaging.putSelection({ documentID: doc.id, imageData: saved.imageData, targetBounds: { left: at.left, top: at.top } });
        } finally {
          release();
        }
      },
    };
  }

  // Run fn(doc, ctx) as one modal, single-history-step operation. With commit
  // false the document is rolled back afterwards (used for measuring). Any
  // failure, including Esc, rolls the document back completely.
  function inDoc(name, fn, { commit = true, docId = null } = {}) {
    requireApis();
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
      let aside = null;
      try {
        aside = commit ? await setSelectionAside(doc) : null;
        const result = await fn(doc, ctx);
        // Restoring inside the try means a failure here rolls everything back.
        if (aside) await aside.restore();
        ok = true;
        return result;
      } finally {
        if (aside) {
          // Rollback restores the selection itself, except when history
          // couldn't be suspended; then put it back by hand.
          if (!ok && sid === null) await aside.restore().catch(() => {});
          aside.release();
        }
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

  function setOverlay({ mode, opacity = 100, split = 6, scale = Z.SCREEN_SCALE } = {}) {
    if (!Z.OVERLAY_MODES.some((m) => m.id === mode)) return Promise.reject(new VFError("Unknown overlay."));
    opacity = Z.num(opacity, 0, 100, 100);
    split = Math.round(Z.num(split, 1, 10, 6));
    scale = Z.safeScale(scale);
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
      layer.opacity = opacity;
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
    on = !!on;
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

  function setDevelopment({ n, scale = Z.SCREEN_SCALE } = {}) {
    n = Math.round(Z.num(n, -3, 3, 0));
    scale = Z.safeScale(scale);
    return inDoc("Development " + Z.devLabel(n), async (doc) => {
      const group = await ensureGroup(doc);
      await applyCurve(doc, group, "dev", devPoints(doc, n, scale), Z.devLabel(n));
      showGroup(group);
    });
  }

  // Place one marker on a zone, and optionally let another fall on a second
  // zone: Adams's exposure-then-development decision, as one curve.
  function placeMarkers({ placements, scale = Z.SCREEN_SCALE, spot = "spot" } = {}) {
    const list = Array.isArray(placements) ? placements : [];
    const clean = list.map((p) => ({ index: Math.round(Z.num(p && p.index, 1, 99, NaN)), zone: Math.round(Z.num(p && p.zone, 0, 10, NaN)) }));
    const distinct = new Set(clean.map((p) => p.index)).size === clean.length;
    if (!clean.length || clean.length > 2 || !distinct || clean.some((p) => !Number.isFinite(p.index) || !Number.isFinite(p.zone))) {
      return Promise.reject(new VFError("Choose one or two different markers and a zone for each."));
    }
    placements = clean;
    scale = Z.safeScale(scale);
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
    amount = Math.round(Z.num(amount, 0, 100, 0));
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
      layer.name = layerName("burnEdges", amount + "%");
      layer.opacity = amount;
      layer.visible = amount > 0;
      showGroup(group);
    });
  }

  function setBurnSky({ amount, depth = 0.4 } = {}) {
    amount = Math.round(Z.num(amount, 0, 100, 0));
    depth = Z.num(depth, 0.05, 0.95, 0.4);
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
      layer.name = layerName("burnSky", amount + "%, " + depthLabel);
      layer.opacity = amount;
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
    scale = Z.safeScale(scale);
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
    scale = Z.safeScale(scale);
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

  // Pixel work runs in pieces no larger than these, so memory stays bounded
  // whatever the image size (about 100 MB at the peak of a blur band).
  const BAND_PIXELS = 4e6;
  const CHUNK_PIXELS = 2e6;
  const MAX_BLUR_PX = 64;
  const MAX_LADDER_WIDTH = 600;

  async function putBuffer(doc, layer, buf, width, height, comps, at) {
    const options = { width, height, components: comps, colorSpace: comps === 3 ? "RGB" : "Grayscale", colorProfile: doc.colorProfileName };
    if (buf instanceof Uint16Array) options.componentSize = 16;
    const img = await PS().imaging.createImageDataFromBuffer(buf, options);
    try {
      // replace: false keeps what earlier pieces already wrote to the layer.
      await PS().imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: img, targetBounds: at, replace: false });
    } finally {
      img.dispose();
    }
  }

  // Composite pixels -> the document's channel layout and depth, alpha dropped.
  function toDocPixels(doc, data, n, srcComps) {
    const comps = isRGB(doc) ? 3 : 1;
    const out = bitsOf(doc) === 16 ? new Uint16Array(n * comps) : new Uint8Array(n * comps);
    const k = (bitsOf(doc) === 16 ? 32768 : 255) / maxOf(data);
    for (let i = 0; i < n; i++) for (let j = 0; j < comps; j++) out[i * comps + j] = Math.round(data[i * srcComps + j] * k);
    return { buf: out, comps };
  }

  // Fill a rectangle of a layer with one grey, a chunk of rows at a time.
  async function fillRegion(doc, layer, left, top, width, height, grey) {
    const comps = isRGB(doc) ? 3 : 1;
    const Ctor = bitsOf(doc) === 16 ? Uint16Array : Uint8Array;
    const rowsPerChunk = Math.max(1, Math.floor(CHUNK_PIXELS / width));
    for (let y = top; y < top + height; y += rowsPerChunk) {
      const h = Math.min(rowsPerChunk, top + height - y);
      await putBuffer(doc, layer, new Ctor(width * h * comps).fill(grey), width, h, comps, { left, top: y });
    }
  }

  // Blur one band: read its rows plus context, blur, write back its own rows.
  async function blurBand(doc, layer, band, sigma) {
    const W = Math.round(doc.width);
    const res = await PS().imaging.getPixels({ documentID: doc.id, sourceBounds: { left: 0, top: band.top, right: W, bottom: band.bottom } });
    const img = res.imageData;
    const { width, height, components } = img;
    let pixels;
    try {
      if (width !== W || height !== band.bottom - band.top) throw new VFError("Photoshop returned an unexpected image size. Nothing was changed.");
      pixels = toDocPixels(doc, await img.getData(), width * height, components);
    } finally {
      img.dispose();
    }
    Z.blurPixels(pixels.buf, width, height, pixels.comps, pixels.comps, sigma);
    const rowLen = width * pixels.comps;
    const core = pixels.buf.slice((band.y0 - band.top) * rowLen, (band.y1 - band.top) * rowLen);
    await putBuffer(doc, layer, core, width, band.y1 - band.y0, pixels.comps, { left: 0, top: band.y0 });
  }

  // Blur a copy of the image until hatching merges, the way a drawing reads
  // from across the room. Overlays then show the zones the marks produce.
  function makeOpticalAverage({ mm = 1, bandPixels = BAND_PIXELS } = {}) {
    const distance = Z.num(mm, 0.1, 5, 1);
    return inDoc("Optical average", async (doc, ctx) => {
      const wanted = (distance * (doc.resolution || 72)) / 25.4;
      const sigma = Z.clamp(wanted, 0.5, MAX_BLUR_PX);
      const plan = Z.bandPlan({ width: Math.round(doc.width), height: Math.round(doc.height), margin: Z.blurSupport(sigma), budget: bandPixels });
      if (!plan) throw new VFError("This image is too wide to blur at that distance. Lower the merge distance, or work on a smaller copy (Image ▸ Image Size).");
      const group = await ensureGroup(doc);
      const old = findChild(group, "optical");
      if (old) old.delete();
      // Read the image as it looks without our layers. The new layer stays
      // hidden while it fills, so later bands never read earlier results.
      const restore = hide(group, ORDER);
      let layer;
      try {
        layer = await createChild(doc, group, "optical", makePixelLayer(layerName("optical", distance.toFixed(1) + " mm")));
        layer.visible = false;
        for (let i = 0; i < plan.length; i++) {
          checkpoint(ctx, i / plan.length);
          await blurBand(doc, layer, plan[i], sigma);
        }
      } finally {
        restore();
      }
      layer.visible = true;
      return { radius: sigma, capped: wanted > MAX_BLUR_PX, bands: plan.length };
    });
  }

  // An eleven-step strip down the right edge, from Zone X at the top to 0.
  function addLadder({ scale = Z.SCREEN_SCALE } = {}) {
    const sc = Z.safeScale(scale);
    return inDoc("Zone ladder", async (doc, ctx) => {
      const group = await ensureGroup(doc);
      const old = findChild(group, "ladder");
      if (old) old.delete();
      const t = transferOf(doc);
      const W = Math.round(doc.width);
      const H = Math.round(doc.height);
      const sw = Z.clamp(Math.round(Math.max(W, H) * 0.035), Math.min(12, W), Math.min(MAX_LADDER_WIDTH, W));
      const max = bitsOf(doc) === 16 ? 32768 : 255;
      const layer = await createChild(doc, group, "ladder", makePixelLayer(layerName("ladder")));
      for (let i = 0; i <= 10; i++) {
        checkpoint(ctx, i / 11);
        const y0 = Math.round((i * H) / 11);
        const y1 = Math.round(((i + 1) * H) / 11);
        if (y1 <= y0) continue;
        const grey = Math.round(Z.encodeL(Z.lOfZone(10 - i, sc), t) * max);
        await fillRegion(doc, layer, W - sw, y0, sw, y1 - y0, grey);
      }
    });
  }

  function removeLayer(key) {
    if (!NAMES[key]) return Promise.reject(new VFError("Unknown layer."));
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

  function applyVariant({ filterId, n, scale = Z.SCREEN_SCALE, docId = null } = {}) {
    n = Math.round(Z.num(n, -3, 3, 0));
    scale = Z.safeScale(scale);
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
    const known = new Set(Z.FILTERS.map((f) => f.id));
    filters = (Array.isArray(filters) ? filters : []).filter((f) => known.has(f)).slice(0, 7);
    devs = Array.from(new Set((Array.isArray(devs) ? devs : []).map((n) => Math.round(Z.num(n, -3, 3, NaN))).filter(Number.isFinite))).slice(0, 6);
    if (!filters.length || !devs.length) return Promise.reject(new VFError("Choose at least one filter and one development."));
    thumb = Math.round(Z.num(thumb, 120, 600, 320));
    scale = Z.safeScale(scale);
    requireApis();
    return runModal("Opportunities sheet", async (ctx) => {
      const ps = PS();
      const doc = activeDoc();
      checkDoc(doc);
      const host = ctx && ctx.hostControl;
      const rgb = isRGB(doc);
      const rows = rgb ? filters : ["none"];
      const total = rows.length * devs.length;
      const cells = [];
      // Every change below is rolled back, so the source ends exactly as it
      // started, including the artist's selection.
      const sid = await host.suspendHistory({ documentID: doc.id, name: GROUP + ": Opportunities" });
      try {
        // Deselect can be unavailable when nothing is selected; that's fine.
        await bp({ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } }).catch(() => {});
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
            checkpoint(ctx, cells.length / total);
            await applyCurve(doc, group, "dev", devPoints(doc, n, scale), Z.devLabel(n));
            const pic = await readRGB8(doc, targetSize);
            // Captions describe the print, so measure it without the masses.
            const showMasses = masses ? hide(group, ["overlay"]) : () => {};
            let L;
            try {
              ({ L } = await readLightness(doc, { targetSize: doc.width >= doc.height ? { width: 160 } : { height: 160 } }));
            } finally {
              showMasses();
            }
            cells.push({ filter: f, n, pic, analysis: Z.analyze(Z.zoneFractions(L, scale)) });
          }
        }
      } finally {
        await host.resumeHistory(sid, false);
      }

      checkpoint(ctx, 1);
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
    CANCELLED,
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
