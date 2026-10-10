/*
 * Photoshop integration harness. tools/run-harness.sh bundles this after
 * zones.js and ps.js into a UXP script, runs it in Photoshop, and reads the
 * results back from the caption of a document named VF_HARNESS_RESULTS.
 *
 * The test chart (660 × 440, sRGB):
 *   y   0–120  "sky"   RGB (70, 120, 200)
 *   y 120–240  red patch x 0–120, green patch x 120–240, white elsewhere
 *   y 300–440  eleven 60 px patches at the centre grey of Zones 0–X
 * Markers: #1 on Zone III, #2 on Zone VIII, #3 on Zone V.
 */
(function () {
  const ps = require("photoshop");
  const { app, core, action, imaging } = ps;
  const Z = globalThis.VFZones;
  const V = globalThis.VFps;
  const results = [];
  const W = 660;
  const H = 440;
  const SKY = [70, 120, 200];
  const RED = [200, 40, 40];
  const GREEN = [60, 140, 60];
  const patchX = (k) => k * 60 + 30;
  const PATCH_Y = 370;
  const greyAt = (k) => Math.round(Z.encodeL(Z.lOfZone(k)) * 255);

  // A UXP script ends when its first modal scope closes, so the whole
  // harness runs inside one, and the plugin's operations run nested in it.
  let outerContext = null;
  const modal = (name, fn) => fn(outerContext);
  const bp = (d) => action.batchPlay(Array.isArray(d) ? d : [d], {});
  const ok = (name, cond, detail) => results.push((cond ? "PASS " : "FAIL ") + name + (cond ? "" : ": " + detail));
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const nearRGB = (a, b, tol) => a.every((v, i) => near(v, b[i], tol));

  async function check(name, fn) {
    try {
      await fn();
    } catch (e) {
      results.push("FAIL " + name + ": threw " + (e && e.message ? e.message : e));
    }
  }

  // Composite colour of one pixel, 0..255.
  function pixel(doc, x, y) {
    return modal("read", async () => {
      const r = await imaging.getPixels({ documentID: doc.id, sourceBounds: { left: x, top: y, right: x + 1, bottom: y + 1 } });
      const d = await r.imageData.getData();
      const max = d instanceof Uint16Array ? 32768 : 255;
      const c = r.imageData.components;
      const out = [];
      for (let j = 0; j < Math.min(3, c); j++) out.push(Math.round((d[j] / max) * 255));
      while (out.length < 3) out.push(out[0]);
      r.imageData.dispose();
      return out;
    });
  }

  const fillRect = (l, t, r, b, rgb) =>
    bp([
      { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _obj: "rectangle", top: { _unit: "pixelsUnit", _value: t }, left: { _unit: "pixelsUnit", _value: l }, bottom: { _unit: "pixelsUnit", _value: b }, right: { _unit: "pixelsUnit", _value: r } } },
      { _obj: "fill", using: { _enum: "fillContents", _value: "color" }, color: { _obj: "RGBColor", red: rgb[0], grain: rgb[1], blue: rgb[2] }, opacity: { _unit: "percentUnit", _value: 100 }, mode: { _enum: "blendMode", _value: "normal" } },
      { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } },
    ]);

  const addMarker = (x, y) => bp({ _obj: "make", _target: [{ _ref: "colorSampler" }], position: { _obj: "paint", horizontal: { _unit: "pixelsUnit", _value: x }, vertical: { _unit: "pixelsUnit", _value: y } } });

  async function makeChart(name, opts = {}) {
    await modal("chart", async () => {
      await app.documents.add({ width: W, height: H, resolution: opts.resolution || 72, mode: opts.mode || "RGBColorMode", fill: "white", depth: opts.depth || 8, name });
      await fillRect(0, 0, W, 120, SKY);
      await fillRect(0, 120, 120, 240, RED);
      await fillRect(120, 120, 240, 240, GREEN);
      for (let k = 0; k <= 10; k++) {
        const g = greyAt(k);
        await fillRect(k * 60, 300, k * 60 + 60, 440, [g, g, g]);
      }
      if (opts.markers !== false) {
        await addMarker(patchX(3), PATCH_Y);
        await addMarker(patchX(8), PATCH_Y);
        await addMarker(patchX(5), PATCH_Y);
      }
    });
    return app.activeDocument;
  }

  const group = (doc) => doc.layers.find((l) => l.name === V.GROUP);
  const child = (doc, key) => {
    const g = group(doc);
    return g ? g.layers.find((l) => l.name.startsWith("VF · " + V.NAMES[key])) : null;
  };
  const historyCount = (doc) => doc.historyStates.length;

  async function run() {
    const doc = await makeChart("VF_HARNESS");

    await check("chart greys are what the zone math predicts", async () => {
      const g3 = await pixel(doc, patchX(3), PATCH_Y);
      ok("chart greys are what the zone math predicts", near(g3[0], greyAt(3), 1), JSON.stringify(g3));
    });

    await check("docInfo lists markers", async () => {
      const info = V.docInfo();
      ok("docInfo lists markers", info.markers.length === 3 && info.markers[0].x === patchX(3) && !info.hasGroup, JSON.stringify(info));
    });

    await check("markers meter at their zones", async () => {
      const m = await V.measureMarkers({ spot: "spot" });
      ok("markers meter at their zones", m.length === 3 && near(m[0].zone, 3, 0.1) && near(m[1].zone, 8, 0.1) && near(m[2].zone, 5, 0.1), JSON.stringify(m));
    });

    await check("measuring leaves no history and no group", async () => {
      const before = historyCount(doc);
      await V.measureMarkers({});
      await V.measureDistribution({});
      ok("measuring leaves no history and no group", historyCount(doc) === before && !group(doc), `history ${before}→${historyCount(doc)}, group ${!!group(doc)}`);
    });

    await check("distribution sees the chart", async () => {
      const d = await V.measureDistribution({});
      const sum = d.fractions.reduce((a, b) => a + b, 0);
      ok("distribution sees the chart", near(sum, 1, 1e-6) && d.fractions[3] > 0.02 && d.fractions[3] < 0.06 && d.analysis.hasBlack && d.analysis.hasWhite, JSON.stringify(d));
    });

    await check("zone overlay colours each patch", async () => {
      await modal("select bg", () => bp({ _obj: "select", _target: [{ _ref: "layer", _id: doc.layers[doc.layers.length - 1].id }], makeVisible: false }));
      const before = historyCount(doc);
      await V.setOverlay({ mode: "zones", opacity: 100 });
      const bad = [];
      for (let k = 0; k <= 10; k++) {
        const p = await pixel(doc, patchX(k), PATCH_Y);
        if (!nearRGB(p, Z.ZONE_COLORS[k], 2)) bad.push(`${k}:${p}`);
      }
      ok("zone overlay colours each patch", !bad.length, bad.join(" "));
      ok("one operation is one history step", historyCount(doc) === before + 1, `${before}→${historyCount(doc)}`);
      ok("the artist's layer selection is restored", doc.activeLayers.length === 1 && doc.activeLayers[0].name === "Background", doc.activeLayers.map((l) => l.name).join(","));
    });

    await check("group sits at the top", async () => {
      ok("group sits at the top", doc.layers[0].name === V.GROUP && doc.layers[0].kind === "group", doc.layers.map((l) => l.name).join(","));
    });

    await check("measuring ignores the overlay and restores it", async () => {
      const m = await V.measureMarkers({});
      ok("measuring ignores the overlay and restores it", near(m[0].zone, 3, 0.1) && child(doc, "overlay").visible, JSON.stringify(m.map((x) => x.zone)));
    });

    await check("light/shadow overlay splits at the chosen zone", async () => {
      await V.setOverlay({ mode: "notan", split: 6 });
      const five = await pixel(doc, patchX(5), PATCH_Y);
      const six = await pixel(doc, patchX(6), PATCH_Y);
      ok("light/shadow overlay splits at the chosen zone", five[0] === 0 && six[0] === 255, `${five} ${six}`);
    });

    await check("textured-darks overlay passes other greys through", async () => {
      await V.setOverlay({ mode: "darks" });
      const three = await pixel(doc, patchX(3), PATCH_Y);
      const six = await pixel(doc, patchX(6), PATCH_Y);
      ok("textured-darks overlay passes other greys through", nearRGB(three, Z.ZONE_COLORS[3], 2) && near(six[0], greyAt(6), 2) && six[0] === six[2], `${three} ${six}`);
    });

    await check("overlay off restores the image", async () => {
      await V.setOverlay({ mode: "off" });
      const p = await pixel(doc, 60, 60);
      ok("overlay off restores the image", nearRGB(p, SKY, 1) && !child(doc, "overlay").visible, `${p}`);
    });

    await check("monochrome preview uses luminance weights", async () => {
      await V.setMonochrome(true);
      const p = await pixel(doc, 60, 180);
      const expected = Math.round(0.3 * RED[0] + 0.59 * RED[1] + 0.11 * RED[2]);
      ok("monochrome preview uses luminance weights", near(p[0], expected, 2) && p[0] === p[2], `${p} vs ${expected}`);
    });

    await check("red filter darkens sky and lightens red", async () => {
      const skyNone = (await pixel(doc, 60, 60))[0];
      await V.setFilter("red");
      const skyRed = (await pixel(doc, 60, 60))[0];
      const red = (await pixel(doc, 60, 180))[0];
      const layer = child(doc, "filter");
      ok("red filter darkens sky and lightens red", skyRed < skyNone - 30 && red > 150 && layer.name.includes("Red"), `sky ${skyNone}→${skyRed}, red ${red}, ${layer.name}`);
      await V.setFilter("none");
    });

    await check("N+1 holds Zone III and lifts Zone VIII", async () => {
      await V.setDevelopment({ n: 1 });
      const m = await V.measureMarkers({});
      ok("N+1 holds Zone III and lifts Zone VIII", near(m[0].zone, 3, 0.2) && near(m[1].zone, 9, 0.3) && near(m[2].zone, 5.5, 0.3), JSON.stringify(m.map((x) => x.zone.toFixed(2))));
    });

    await check("placement puts markers on the chosen zones", async () => {
      const r = await V.placeMarkers({ placements: [{ index: 1, zone: 4 }, { index: 2, zone: 9 }] });
      const m = await V.measureMarkers({});
      ok("placement puts markers on the chosen zones", near(m[0].zone, 4, 0.2) && near(m[1].zone, 9, 0.2), JSON.stringify(m.map((x) => x.zone.toFixed(2))));
      ok("placement reports the exposure shift and development", near(r.shift, 1, 0.15) && near(r.development, 0, 0.2), JSON.stringify(r));
      ok("development layer names the placement", child(doc, "dev").name.includes("#1→IV"), child(doc, "dev").name);
    });

    await check("neutral print resets development", async () => {
      await V.resetPrint();
      const m = await V.measureMarkers({});
      ok("neutral print resets development", near(m[0].zone, 3, 0.15) && near(m[1].zone, 8, 0.15), JSON.stringify(m.map((x) => x.zone.toFixed(2))));
    });

    await check("burning the edges darkens corners only", async () => {
      await V.setBurnEdges(100);
      const corner = (await pixel(doc, W - 2, H - 2))[0];
      const centre = (await pixel(doc, 330, 200))[0];
      ok("burning the edges darkens corners only", corner < 225 && centre >= 250, `corner ${corner}, centre ${centre}`);
      await V.setBurnEdges(0);
      const after = (await pixel(doc, W - 2, H - 2))[0];
      ok("burn at zero hides the layer", after >= 254 && !child(doc, "burnEdges").visible, `corner ${after}`);
    });

    await check("burning the sky darkens the top only", async () => {
      const top0 = (await pixel(doc, 330, 4))[0];
      await V.setBurnSky({ amount: 100, depth: 0.5 });
      const top1 = (await pixel(doc, 330, 4))[0];
      const low = (await pixel(doc, 330, 280))[0];
      ok("burning the sky darkens the top only", top1 < top0 - 15 && low >= 254, `top ${top0}→${top1}, low ${low}`);
      await V.setBurnSky({ amount: 60, depth: 0.25 });
      const l = child(doc, "burnSky");
      ok("sky depth and strength are recorded", l.opacity === 60 && l.name.includes("25% down"), `${l.opacity} ${l.name}`);
      await V.setBurnSky({ amount: 0, depth: 0.25 });
    });

    await check("zone ladder runs X to 0 and doubles as a legend", async () => {
      await V.addLadder({});
      const top = await pixel(doc, W - 3, 3);
      const bottom = await pixel(doc, W - 3, H - 3);
      ok("zone ladder runs X to 0", top[0] >= 254 && bottom[0] <= 1, `${top} ${bottom}`);
      await V.setOverlay({ mode: "zones" });
      const mid = await pixel(doc, W - 3, Math.floor(H * (5.5 / 11)));
      ok("ladder doubles as a legend under the overlay", nearRGB(mid, Z.ZONE_COLORS[5], 2), `${mid}`);
      await V.removeLayer("ladder");
      await V.setOverlay({ mode: "off" });
    });

    await check("optical average blurs a copy at the bottom of the group", async () => {
      const r = await V.makeOpticalAverage({ mm: 2 });
      const g = group(doc);
      const last = g.layers[g.layers.length - 1];
      const edge = (await pixel(doc, 240, PATCH_Y))[0];
      const bg = await pixel(doc, 240, PATCH_Y);
      ok("optical average blurs a copy at the bottom of the group", last.name.startsWith("VF · Optical average") && edge > greyAt(3) && edge < greyAt(4) && near(r.radius, 5.67, 0.05), `${last.name} edge ${edge} (${greyAt(3)}..${greyAt(4)}) r ${r.radius} ${bg}`);
      ok("optical average keeps hidden layers hidden", !child(doc, "burnEdges").visible && !child(doc, "burnSky").visible && !child(doc, "overlay").visible, `burnEdges ${child(doc, "burnEdges").visible} burnSky ${child(doc, "burnSky").visible} overlay ${child(doc, "overlay").visible}`);
      await V.removeLayer("optical");
    });

    await check("layers stay in pipeline order", async () => {
      await V.setOverlay({ mode: "zones" });
      await V.setBurnEdges(30);
      const names = group(doc).layers.map((l) => l.name.replace(/ — .*/, ""));
      const expected = ["VF · Overlay", "VF · Burn sky", "VF · Burn edges", "VF · Development", "VF · Filter"];
      ok("layers stay in pipeline order", names.join("|") === expected.join("|"), names.join("|"));
    });

    await check("opportunities sheet leaves the source untouched", async () => {
      const before = historyCount(doc);
      const devName = child(doc, "dev").name;
      const filterName = child(doc, "filter").name;
      const overlayVisible = child(doc, "overlay").visible;
      const r = await V.makeOpportunitiesSheet({ thumb: 160 });
      const sheet = app.activeDocument;
      // historyStates reads the active document's history, so look at the
      // source's while it is active, then return to the sheet.
      app.activeDocument = doc;
      const sheetSnapshot = { history: historyCount(doc), dev: child(doc, "dev").name, filter: child(doc, "filter").name, overlay: child(doc, "overlay").visible };
      app.activeDocument = sheet;
      ok("opportunities sheet has every variant", r.variants.length === 20 && sheet.title.startsWith("Opportunities") && sheet.width === r.width, `${r.variants.length} ${sheet.title} ${sheet.width}x${sheet.height}`);
      const texts = sheet.layers.filter((l) => l.kind === "text").length;
      ok("opportunities sheet is labelled", texts === 2 + 4 + 5 + 20, `text layers ${texts}`);
      ok("sheet reports its source image", r.sourceId === doc.id, `${r.sourceId} vs ${doc.id}`);
      await V.applyVariant({ filterId: "green", n: -1, docId: doc.id });
      ok("applying a variant from the sheet returns to the source", app.activeDocument.id === doc.id && child(doc, "filter").name.includes("Green") && child(doc, "dev").name.endsWith("N−1"), `${app.activeDocument.title} ${child(doc, "filter").name} ${child(doc, "dev").name}`);
      await V.applyVariant({ filterId: "none", n: 0 });
      ok(
        "opportunities sheet leaves the source untouched",
        sheetSnapshot.history === before && sheetSnapshot.dev === devName && sheetSnapshot.filter === filterName && sheetSnapshot.overlay === overlayVisible,
        `history ${before}→${sheetSnapshot.history} dev ${devName}→${sheetSnapshot.dev} filter ${filterName}→${sheetSnapshot.filter}`
      );
    });

    await check("applying a variant sets filter and development", async () => {
      await V.applyVariant({ filterId: "red", n: 2 });
      ok("applying a variant sets filter and development", child(doc, "filter").name.includes("Red") && child(doc, "dev").name.endsWith("N+2"), `${child(doc, "filter").name} ${child(doc, "dev").name}`);
    });

    await check("clear markers", async () => {
      await V.clearMarkers();
      ok("clear markers", V.docInfo().markers.length === 0, JSON.stringify(V.docInfo().markers));
    });

    await check("grayscale documents work without filters", async () => {
      const gdoc = await makeChart("VF_HARNESS_GRAY", { mode: "grayscaleMode" });
      await V.setMonochrome(true);
      await V.setOverlay({ mode: "notan", split: 6 });
      const five = await pixel(gdoc, patchX(5), PATCH_Y);
      const m = await V.measureMarkers({});
      await V.makeOpticalAverage({ mm: 1 });
      await V.addLadder({});
      let filterRefused = false;
      try {
        await V.setFilter("red");
      } catch (e) {
        filterRefused = /Grayscale/.test(e.message);
      }
      ok("grayscale documents work without filters", five[0] === 0 && near(m[0].zone, 3, 0.15) && !child(gdoc, "filter") && filterRefused && !!child(gdoc, "optical") && !!child(gdoc, "ladder"), `${five} ${m.map((x) => x.zone.toFixed(2))} refused ${filterRefused}`);
    });

    await check("16-bit documents", async () => {
      const d16 = await makeChart("VF_HARNESS_16", { depth: 16 });
      await V.makeOpticalAverage({ mm: 1 });
      await V.addLadder({});
      await V.setOverlay({ mode: "zones" });
      const p = await pixel(d16, patchX(8), PATCH_Y);
      const m = await V.measureMarkers({});
      ok("16-bit documents", nearRGB(p, Z.ZONE_COLORS[8], 2) && near(m[1].zone, 8, 0.15), `${p} ${m.map((x) => x.zone.toFixed(2))}`);
    });

    await check("ink scale moves the zones", async () => {
      app.activeDocument = doc;
      await V.setOverlay({ mode: "off" });
      await V.resetPrint();
      await V.setBurnEdges(0);
      await modal("markers", () => addMarker(patchX(3), PATCH_Y));
      const m = await V.measureMarkers({ scale: Z.INK_SCALE });
      ok("ink scale moves the zones", near(m[0].zone, (30 - 15) / 7.9, 0.1), JSON.stringify(m));
    });
  }

  async function finish() {
    const passed = results.filter((r) => r.startsWith("PASS")).length;
    const failed = results.length - passed;
    results.unshift(`SUMMARY ${passed} passed, ${failed} failed`);
    await modal("results", async () => {
      await app.documents.add({ width: 10, height: 10, resolution: 72, mode: "RGBColorMode", fill: "white", name: "VF_HARNESS_RESULTS" });
      await bp({ _obj: "set", _target: [{ _ref: "property", _property: "fileInfo" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "fileInfo", caption: results.join("\n") } });
    });
  }

  core.executeAsModal(
    async (ctx) => {
      outerContext = ctx;
      V.setModalRunner((name, fn) => fn(ctx));
      try {
        await run();
      } catch (e) {
        results.push("FAIL harness: " + (e && e.stack ? e.stack : e));
      }
      await finish();
    },
    { commandName: "Visualize First harness" }
  );
})();
