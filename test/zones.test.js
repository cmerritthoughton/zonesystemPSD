const test = require("node:test");
const assert = require("node:assert/strict");
const Z = require("../plugin/js/zones.js");

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b} ±${tol}, got ${a}`);

// Apply a gradient's stops to an encoded grey (0..255) the way a gradient map
// does, using linear interpolation between stops.
function mapThrough(stops, v) {
  const loc = (v / 255) * Z.LOC_MAX;
  if (loc <= stops[0].loc) return stops[0].rgb;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (loc <= b.loc) {
      const t = b.loc === a.loc ? 1 : (loc - a.loc) / (b.loc - a.loc);
      return a.rgb.map((c, j) => Math.round(c + (b.rgb[j] - c) * t));
    }
  }
  return stops[stops.length - 1].rgb;
}

// Encoded grey at the centre of zone k.
const greyAt = (k, scale = Z.SCREEN_SCALE, t = "srgb") => Math.round(Z.encodeL(Z.lOfZone(k, scale), t) * 255);

test("Zone V on screen is middle grey (L* 50, 18% luminance)", () => {
  near(Z.lOfZone(5), 50, 1e-9);
  near(Z.yFromL(50), 0.184, 0.001);
  near(greyAt(5), 119, 1, "sRGB grey for L* 50");
});

test("L* and luminance round-trip, including the linear toe", () => {
  for (const L of [0, 3, 8, 8.5, 25, 50, 75, 100]) near(Z.lFromY(Z.yFromL(L)), L, 1e-6, `L*=${L}`);
});

test("encodeL and decodeToL invert each other in every working space", () => {
  for (const t of ["srgb", "gamma22", "gamma18"]) {
    for (const L of [2, 15, 50, 85, 99]) near(Z.decodeToL(Z.encodeL(L, t), t), L, 1e-6, `${t} L*=${L}`);
  }
});

test("zone indices round to the nearest zone and clamp to 0–X", () => {
  assert.equal(Z.zoneIndex(29), 3);
  assert.equal(Z.zoneIndex(35.1), 4);
  assert.equal(Z.zoneIndex(-5), 0);
  assert.equal(Z.zoneIndex(130), 10);
  assert.equal(Z.roman(8), "VIII");
});

test("an ink scale spreads ten zones between ink black and paper white", () => {
  const s = Z.INK_SCALE;
  near(Z.lOfZone(0, s), 15, 1e-9);
  near(Z.lOfZone(10, s), 94, 1e-9);
  near(Z.zoneValue(30, s), 1.9, 0.01);
  assert.equal(Z.zoneIndex(30, s), 2);
});

test("ink coverage matches the article's table at the anchor zones", () => {
  const s = { black: 15, white: 94 };
  near(Z.inkCoverage(Z.lOfZone(0, s), s), 1, 1e-9);
  near(Z.inkCoverage(Z.lOfZone(10, s), s), 0, 1e-9);
  near(Z.inkCoverage(Z.lOfZone(3, s), s), 0.9, 0.02, "Zone III");
  near(Z.inkCoverage(Z.lOfZone(5, s), s), 0.75, 0.03, "Zone V");
  near(Z.inkCoverage(Z.lOfZone(7, s), s), 0.53, 0.03, "Zone VII");
});

test("transferFor picks the tone curve from the profile name", () => {
  assert.equal(Z.transferFor("sRGB IEC61966-2.1"), "srgb");
  assert.equal(Z.transferFor("Display P3"), "srgb");
  assert.equal(Z.transferFor("Adobe RGB (1998)"), "gamma22");
  assert.equal(Z.transferFor("ProPhoto RGB"), "gamma18");
  assert.equal(Z.transferFor(undefined), "srgb");
});

test("zone overlay maps each zone's centre grey to that zone's colour", () => {
  for (const t of ["srgb", "gamma22"]) {
    const stops = Z.overlayStops("zones", { transfer: t });
    for (let k = 0; k <= 10; k++) assert.deepEqual(mapThrough(stops, greyAt(k, Z.SCREEN_SCALE, t)), Z.ZONE_COLORS[k], `${t} zone ${k}`);
  }
});

test("zone overlay follows an ink scale", () => {
  const scale = Z.INK_SCALE;
  const stops = Z.overlayStops("zones", { scale });
  for (let k = 0; k <= 10; k++) assert.deepEqual(mapThrough(stops, greyAt(k, scale)), Z.ZONE_COLORS[k], `zone ${k}`);
});

test("gradient stops stay inside 0..4096 and strictly increase", () => {
  for (const m of Z.OVERLAY_MODES) {
    if (m.id === "off") continue;
    const stops = Z.overlayStops(m.id, { split: 4 });
    assert.ok(stops.length >= 2, m.id);
    assert.equal(stops[0].loc, 0, m.id);
    assert.equal(stops[stops.length - 1].loc, Z.LOC_MAX, m.id);
    for (let i = 1; i < stops.length; i++) assert.ok(stops[i].loc > stops[i - 1].loc, `${m.id} stop ${i}`);
  }
});

test("isolate overlays colour only their zones and pass other greys through", () => {
  const stops = Z.overlayStops("darks");
  assert.deepEqual(mapThrough(stops, greyAt(3)), Z.ZONE_COLORS[3]);
  assert.deepEqual(mapThrough(stops, greyAt(2)), Z.ZONE_COLORS[2]);
  for (const k of [0, 5, 7, 10]) {
    const g = greyAt(k);
    const out = mapThrough(stops, g);
    assert.ok(Math.abs(out[0] - g) <= 1 && out[0] === out[1] && out[1] === out[2], `zone ${k} passes through as grey`);
  }
});

test("four values and notan group zones as documented", () => {
  const four = Z.overlayStops("four");
  const g = (k) => mapThrough(four, greyAt(k))[0];
  assert.equal(g(0), 0);
  assert.equal(g(1), 0);
  assert.equal(g(2), g(5), "II–V share the shadow value");
  assert.equal(g(6), g(9), "VI–IX share the light value");
  assert.equal(g(10), 255);
  const notan = Z.overlayStops("notan", { split: 6 });
  assert.equal(mapThrough(notan, greyAt(5))[0], 0);
  assert.equal(mapThrough(notan, greyAt(6))[0], 255);
});

test("N development holds Zone III and moves Zone VII a zone per step", () => {
  for (const n of [-2, -1, 1, 2]) {
    const pairs = Z.developmentPairs(n);
    const at = (L) => {
      for (let i = 1; i < pairs.length; i++) {
        const [a0, b0] = pairs[i - 1];
        const [a1, b1] = pairs[i];
        if (L <= a1) return b0 + ((L - a0) * (b1 - b0)) / (a1 - a0);
      }
      return pairs[pairs.length - 1][1];
    };
    near(at(30), 30, 1e-9, `N${n} holds III`);
    near(at(70), Z.clamp(70 + 10 * n, 0, 100), 1e-9, `N${n} moves VII`);
    for (let i = 1; i < pairs.length; i++) assert.ok(pairs[i][1] >= pairs[i - 1][1] && pairs[i][0] > pairs[i - 1][0], `N${n} monotone`);
  }
  assert.deepEqual(Z.developmentPairs(0).map((p) => p[1]), Z.developmentPairs(0).map((p) => p[0]), "N is identity");
});

test("N− leaves paper white unreached; N+ shoulders into white", () => {
  const minus = Z.developmentPairs(-1);
  near(minus[minus.length - 1][1], 94, 1e-9);
  const plus = Z.developmentPairs(2);
  assert.deepEqual(plus[plus.length - 1], [100, 100]);
  assert.ok(plus.slice(0, -1).every((p) => p[1] < 99.5));
});

test("placement puts the markers exactly on the chosen zones", () => {
  const markers = [
    { L: 42, zone: 3 },
    { L: 71, zone: 8 },
  ];
  const pairs = Z.placementPairs(markers);
  const anchor = (L) => pairs.find((p) => p[0] === L);
  assert.deepEqual(anchor(42).slice(0, 2), [42, 30]);
  assert.deepEqual(anchor(71).slice(0, 2), [71, 80]);
  const sum = Z.placementSummary(markers);
  near(sum.shift, 3 - 4.2, 1e-9, "placement moved the shadow down 1.2 zones");
  near(sum.development, 5 - 2.9, 1e-9, "development expanded the interval");
});

test("placement rejects crossed or coincident markers", () => {
  assert.throws(() => Z.placementPairs([{ L: 40, zone: 6 }, { L: 70, zone: 4 }]), /darker marker/);
  assert.throws(() => Z.placementPairs([{ L: 0, zone: 2 }]), /pure black or white/);
});

test("curve points are 0..255, increasing, and capped at Photoshop's limit", () => {
  const sets = [
    Z.developmentPairs(2),
    Z.developmentPairs(-2),
    Z.placementPairs([{ L: 12, zone: 3 }, { L: 92, zone: 8 }]),
    Z.placementPairs([{ L: 55, zone: 4 }]),
    Z.burnPairs(),
  ];
  for (const pairs of sets) {
    const pts = Z.toCurvePoints(pairs, "srgb");
    assert.ok(pts.length >= 2 && pts.length <= 14, `point count ${pts.length}`);
    assert.deepEqual(pts[0], [0, pts[0][1]]);
    assert.equal(pts[pts.length - 1][0], 255);
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i][0] - pts[i - 1][0] >= 3, "inputs at least 3 apart");
      assert.ok(pts[i][1] >= pts[i - 1][1], "outputs never fall");
    }
  }
});

test("placement curve keeps the anchor points when thinning", () => {
  const pairs = Z.placementPairs([{ L: 12, zone: 2 }, { L: 92, zone: 9 }]);
  const pts = Z.toCurvePoints(pairs, "srgb");
  const x1 = Math.round(Z.encodeL(12) * 255);
  const x2 = Math.round(Z.encodeL(92) * 255);
  assert.ok(pts.some((p) => p[0] === x1 && p[1] === greyAt(2)), "first anchor kept");
  assert.ok(pts.some((p) => p[0] === x2 && p[1] === greyAt(9)), "second anchor kept");
});

test("analysis reads key, range and separation from zone fractions", () => {
  const low = Z.analyze([0.05, 0.1, 0.2, 0.2, 0.15, 0.1, 0.05, 0.05, 0.05, 0.03, 0.02]);
  assert.equal(low.key, "low");
  assert.equal(low.range, "full");
  near(low.texturedDark, 0.4, 1e-9);
  const flat = Z.analyze([0, 0, 0, 0.1, 0.3, 0.3, 0.2, 0.1, 0, 0, 0]);
  assert.equal(flat.key, "middle");
  assert.equal(flat.range, "compressed");
  near(flat.middle, 0.8, 1e-9);
});

test("suggestions respond to the gap between intent and scene", () => {
  const flat = Z.analyze([0, 0, 0, 0.1, 0.3, 0.3, 0.2, 0.1, 0, 0, 0]);
  const full = Z.suggestions("full", flat).join(" ");
  assert.match(full, /Zone 0–I/);
  assert.match(full, /Zone IX–X/);
  assert.match(full, /mud/);
  assert.match(Z.suggestions("low", flat).join(" "), /low-key/);
  assert.match(Z.suggestions("high", flat).join(" "), /high-key/);
});

test("zone fractions and meter averaging", () => {
  const fr = Z.zoneFractions(new Float32Array([0, 30, 31, 50, 100]));
  assert.equal(fr[0], 0.2);
  assert.equal(fr[3], 0.4);
  assert.equal(fr[10], 0.2);
  near(Z.meterAverage([50, 50]), 50, 1e-9);
  assert.ok(Z.meterAverage([0, 100]) > 50, "luminance averaging favours the light patch");
});

test("prediction scoring reports miss, bias and hit counts", () => {
  const s = Z.scorePredictions([
    { guess: 3, actual: 4.2 },
    { guess: 8, actual: 7.6 },
    { guess: null, actual: 5 },
  ]);
  assert.equal(s.count, 2);
  near(s.mae, 0.8, 1e-9);
  near(s.bias, -0.4, 1e-9);
  assert.equal(s.withinHalf, 1);
  assert.equal(s.withinOne, 1);
});

test("practice stats compare recent sessions with earlier ones", () => {
  const entries = [];
  for (let i = 0; i < 20; i++) entries.push({ mae: i < 10 ? 1.5 : 0.5, bias: 0.4, darkGuess: 40, darkActual: 55 });
  const st = Z.practiceStats(entries);
  assert.equal(st.sessions, 20);
  near(st.recentMae, 0.5, 1e-9);
  near(st.earlierMae, 1.5, 1e-9);
  near(st.bias, 0.4, 1e-9);
  near(st.darkMiss, 15, 1e-9);
});

test("CSV export quotes text that needs it", () => {
  const csv = Z.logToCsv([{ date: "2026-10-09", image: "tower.jpg", intent: "low", sentence: 'Storm light, "late", on the tower', darkGuess: 40, darkActual: 61, markers: 2, mae: 0.75, bias: -0.25, key: "low", range: "full" }]);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"Storm light, ""late"", on the tower"/);
  assert.match(lines[1], /0\.75,-0\.25,low,full$/);
});

test("scales are validated", () => {
  assert.ok(Z.validScale(Z.INK_SCALE));
  assert.ok(!Z.validScale({ black: 50, white: 60 }));
  assert.ok(!Z.validScale({ black: -1, white: 90 }));
});

test("box sizes approximate the requested Gaussian", () => {
  for (const sigma of [1, 2.5, 6, 20]) {
    const sizes = Z.boxesForGauss(sigma);
    const variance = sizes.reduce((v, w) => v + (w * w - 1) / 12, 0);
    near(Math.sqrt(variance), sigma, 0.35, `sigma ${sigma}`);
  }
});

test("blurring keeps flat areas flat and softens a hard edge symmetrically", () => {
  const w = 40;
  const h = 6;
  const data = new Uint8Array(w * h * 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    data[(y * w + x) * 2] = x < 20 ? 0 : 200;
    data[(y * w + x) * 2 + 1] = 255;
  }
  Z.blurPixels(data, w, h, 1, 2, 2);
  const row = (x) => data[(3 * w + x) * 2];
  assert.equal(row(0), 0, "far left stays black");
  assert.equal(row(39), 200, "far right stays light");
  assert.ok(row(19) > 0 && row(19) < 100 && row(20) > 100 && row(20) < 200, `edge softened: ${row(19)} ${row(20)}`);
  near(row(19) + row(20), 200, 2, "symmetric about the edge");
  assert.equal(data[(3 * w + 19) * 2 + 1], 255, "alpha untouched");
  for (let x = 1; x < w; x++) assert.ok(row(x) >= row(x - 1), "monotone ramp");
});

test("blurring vertically as well as horizontally", () => {
  const w = 5;
  const h = 30;
  const data = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = y < 15 ? 0 : 32768;
  Z.blurPixels(data, w, h, 1, 1, 3);
  const col = (y) => data[y * w + 2];
  assert.ok(col(14) > 0 && col(15) < 32768, `${col(14)} ${col(15)}`);
});

test("num and safeScale turn bad input into safe defaults", () => {
  assert.equal(Z.num(NaN, 0, 100, 50), 50);
  assert.equal(Z.num("abc", 0, 100, 50), 50);
  assert.equal(Z.num(undefined, 0, 100, 50), 50);
  assert.equal(Z.num("", 0, 100, 50), 50);
  assert.equal(Z.num("70", 0, 100, 50), 70);
  assert.equal(Z.num(250, 0, 100, 50), 100);
  assert.equal(Z.num(Infinity, 0, 100, 50), 50);
  assert.equal(Z.safeScale({ black: NaN, white: 90 }), Z.SCREEN_SCALE);
  assert.equal(Z.safeScale(Z.INK_SCALE), Z.INK_SCALE);
});

test("invalid scales and NaN bands can't hang the overlay builder", () => {
  const start = Date.now();
  assert.deepEqual(Z.bandsToStops([{ from: NaN, to: 400, rgb: null }, { from: 0, to: NaN, rgb: null }]), []);
  const bad = Z.overlayStops("darks", { scale: { black: 50, white: 50 }, transfer: "bogus", split: NaN });
  assert.deepEqual(bad, Z.overlayStops("darks", {}), "falls back to the screen scale and sRGB");
  assert.ok(Date.now() - start < 200);
});

test("curve and histogram helpers survive bad input", () => {
  assert.deepEqual(Z.developmentPairs(NaN, null), Z.developmentPairs(0));
  assert.throws(() => Z.placementPairs([{ L: NaN, zone: 3 }]), /Couldn't read/);
  assert.throws(() => Z.placementPairs([]), /Couldn't read/);
  const fr = Z.zoneFractions([NaN, 50, Infinity], { black: 0, white: 0 });
  assert.equal(fr[5], 1, "non-finite readings are skipped; a bad scale falls back");
});

test("blur support covers every box radius", () => {
  assert.equal(Z.blurSupport(0), 0);
  for (const sigma of [1, 3, 12, 64]) {
    const support = Z.blurSupport(sigma);
    assert.equal(support, Z.boxesForGauss(sigma).reduce((s, w) => s + (w - 1) / 2, 0));
    assert.ok(support >= sigma && support <= 3 * sigma, `sigma ${sigma}: support ${support}`);
  }
});

test("band plans cover every row once and stay within budget", () => {
  const width = 500;
  const height = 1234;
  const margin = 20;
  const budget = 60000;
  const plan = Z.bandPlan({ width, height, margin, budget });
  assert.ok(plan.length > 1);
  let next = 0;
  for (const b of plan) {
    assert.equal(b.y0, next, "contiguous");
    next = b.y1;
    assert.ok((b.bottom - b.top) * width <= budget, "read stays within budget");
    assert.equal(b.top, Math.max(0, b.y0 - margin));
    assert.equal(b.bottom, Math.min(height, b.y1 + margin));
  }
  assert.equal(next, height, "every row written");
  assert.equal(Z.bandPlan({ width, height: 10, margin, budget }).length, 1, "small images are one band");
  assert.equal(Z.bandPlan({ width: 100000, height, margin: 200, budget }), null, "refuses what can't fit");
  assert.equal(Z.bandPlan({ width: NaN, height, margin, budget }), null);
});

test("banded blurring matches blurring the whole image exactly", () => {
  const width = 37;
  const height = 211;
  const comps = 3;
  const sigma = 4.2;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) % 65536) / 2;
  const src = new Uint16Array(width * height * comps).map(() => rand());
  const whole = Z.blurPixels(src.slice(), width, height, comps, comps, sigma);
  const margin = Z.blurSupport(sigma);
  const plan = Z.bandPlan({ width, height, margin, budget: width * (2 * margin + 40) });
  assert.ok(plan.length >= 4, `${plan.length} bands`);
  const banded = new Uint16Array(src.length);
  for (const b of plan) {
    const block = src.slice(b.top * width * comps, b.bottom * width * comps);
    Z.blurPixels(block, width, b.bottom - b.top, comps, comps, sigma);
    const from = (b.y0 - b.top) * width * comps;
    banded.set(block.subarray(from, from + (b.y1 - b.y0) * width * comps), b.y0 * width * comps);
  }
  let worst = 0;
  for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - banded[i]));
  assert.ok(worst <= 1, `largest difference ${worst}`);
});

test("moves pair each piece of advice with one-click tries", () => {
  const flat = Z.analyze([0, 0, 0, 0.1, 0.3, 0.3, 0.2, 0.1, 0, 0, 0]);
  const low = Z.moves("low", flat, { shadowZone: 3.2 });
  assert.deepEqual(low.map((m) => m.text), Z.suggestions("low", flat), "same text as suggestions");
  const lowTries = low[0].tries.map((t) => t.action);
  assert.deepEqual(lowTries[0], { type: "place", index: 1, zone: 2 }, "#1 a zone lower");
  assert.deepEqual(lowTries[1], { type: "burnEdges", amount: 50 });
  assert.deepEqual(lowTries[2], { type: "filter", id: "red" });
  assert.equal(low[0].tries[0].label, "Place #1 on Zone II");
  const mud = low.find((m) => /mud/.test(m.text));
  assert.deepEqual(mud.tries.map((t) => t.action), [{ type: "dev", n: 1 }]);
  assert.equal(mud.tries[0].label, "Try N+1");
});

test("moves leave out tries that can't apply", () => {
  const flat = Z.analyze([0, 0, 0, 0.1, 0.3, 0.3, 0.2, 0.1, 0, 0, 0]);
  const noMarker = Z.moves("low", flat, { shadowZone: null, rgb: false });
  assert.deepEqual(noMarker[0].tries.map((t) => t.action.type), ["burnEdges"], "no placement without #1, no filter in Grayscale");
  const high = Z.moves("high", flat, { shadowZone: 5 });
  assert.deepEqual(high[0].tries.map((t) => t.action), [{ type: "dev", n: -1 }], "#1 already above IV: no placement");
  const ok = Z.moves("full", Z.analyze([0.05, 0.1, 0.15, 0.15, 0.1, 0.05, 0.1, 0.1, 0.1, 0.05, 0.05]));
  assert.equal(ok.length, 1);
  assert.deepEqual(ok[0].tries[0].action, { type: "goto", step: "compare" });
});
