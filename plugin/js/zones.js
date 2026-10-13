/*
 * Visualize First — zone math.
 *
 * Pure functions shared by the panel, the Photoshop layer code and the tests.
 * Zones are Ansel Adams's print zones 0–X, spaced in equal steps of CIE L*
 * (perceived lightness) between a black point and a white point. On screen
 * those are L* 0 and 100, so Zone V lands on L* 50 (18% grey). For ink on
 * paper they are the measured lightness of solid ink and bare paper.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VFZones = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

  // Adams's print zones (paraphrased) and the pen-and-ink approach for each.
  const ZONES = [
    { meaning: "Pure black", ink: "Solid black, as a designed shape" },
    { meaning: "Near black: tone but no texture", ink: "Solid with the barest breaks" },
    { meaning: "First hint of texture", ink: "White-line work, or hatching around white" },
    { meaning: "Textured shadow", ink: "Four crosshatch layers; paper flecks survive" },
    { meaning: "Open shadow, dark foliage, dark stone", ink: "Three crosshatch layers" },
    { meaning: "Middle grey, weathered wood", ink: "Two dense layers" },
    { meaning: "Light stone, light skin in sun", ink: "Two lighter layers" },
    { meaning: "Very light surfaces", ink: "One layer, line as wide as the gap" },
    { meaning: "Textured white, the last full detail", ink: "Sparse hatching, stipple, broken line" },
    { meaning: "White without texture", ink: "A few tapered marks" },
    { meaning: "Paper white, specular light", ink: "Paper, as a designed shape" },
  ];

  // False-colour palette. III (textured shadow) and VIII (textured light) are
  // the two classic anchors, so they get the most distinct hues.
  const ZONE_COLORS = [
    [40, 0, 60],
    [95, 25, 150],
    [35, 75, 210],
    [0, 175, 225],
    [35, 160, 95],
    [128, 128, 128],
    [185, 210, 60],
    [245, 205, 45],
    [245, 135, 30],
    [225, 50, 70],
    [255, 115, 205],
  ];

  const SCREEN_SCALE = Object.freeze({ black: 0, white: 100 });
  const INK_SCALE = Object.freeze({ black: 15, white: 94 });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const zoneStep = (scale) => (scale.white - scale.black) / 10;
  const zoneValue = (L, scale = SCREEN_SCALE) => (L - scale.black) / zoneStep(scale);
  const zoneIndex = (L, scale = SCREEN_SCALE) => clamp(Math.round(zoneValue(L, scale)), 0, 10);
  const lOfZone = (z, scale = SCREEN_SCALE) => scale.black + z * zoneStep(scale);
  const roman = (z) => ROMAN[clamp(Math.round(z), 0, 10)];

  function validScale(scale) {
    return (
      scale &&
      Number.isFinite(scale.black) &&
      Number.isFinite(scale.white) &&
      scale.black >= 0 &&
      scale.white <= 100 &&
      scale.white - scale.black >= 20
    );
  }

  // Anything that reaches Photoshop passes through these, so a bad value
  // becomes a sensible default instead of NaN in a descriptor or a loop.
  const safeScale = (scale) => (validScale(scale) ? scale : SCREEN_SCALE);
  function num(v, lo, hi, fallback) {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  }

  // ---- Lightness and encoding -------------------------------------------

  // CIE L* <-> relative luminance Y (0..1), with the exact CIE constants.
  const CIE_E = 216 / 24389;
  const CIE_K = 24389 / 27;
  const yFromL = (L) => (L > 8 ? Math.pow((L + 16) / 116, 3) : L / CIE_K);
  const lFromY = (Y) => (Y > CIE_E ? 116 * Math.cbrt(Y) - 16 : CIE_K * Y);

  // Tone curves of common working spaces: encoded value (0..1) <-> linear Y.
  const TRANSFERS = {
    srgb: {
      decode: (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)),
      encode: (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055),
    },
    gamma22: {
      decode: (v) => Math.pow(v, 2.19921875),
      encode: (y) => Math.pow(y, 1 / 2.19921875),
    },
    gamma18: {
      decode: (v) => Math.pow(v, 1.8),
      encode: (y) => Math.pow(y, 1 / 1.8),
    },
  };

  function transferFor(profileName) {
    const p = String(profileName || "");
    if (/prophoto|romm|gamma 1\.8|apple rgb|colormatch/i.test(p)) return "gamma18";
    if (/adobe rgb|gamma 2\.2|wide gamut|dot gain/i.test(p)) return "gamma22";
    return "srgb";
  }

  // Encoded grey value (0..1) that displays at lightness L in a working space.
  const encodeL = (L, t = "srgb") => clamp(TRANSFERS[t].encode(yFromL(clamp(L, 0, 100))), 0, 1);
  const decodeToL = (v, t = "srgb") => lFromY(TRANSFERS[t].decode(clamp(v, 0, 1)));

  // ---- Gradient-map overlays ---------------------------------------------

  const LOC_MAX = 4096; // Photoshop gradient locations run 0..4096.

  // edges[k] is the first gradient location belonging to zone k.
  function zoneEdges(scale, t) {
    const edges = [0];
    for (let k = 1; k <= 10; k++) edges.push(Math.round(encodeL(lOfZone(k - 0.5, scale), t) * LOC_MAX));
    edges.push(LOC_MAX + 1);
    return edges;
  }

  const OVERLAY_MODES = [
    { id: "off", label: "Off", hint: "No overlay." },
    { id: "zones", label: "Zones", hint: "Every zone in its own colour." },
    { id: "darks", label: "Textured darks", hint: "Zones II–III: shadows that still carry texture." },
    { id: "lights", label: "Textured lights", hint: "Zones VII–VIII: lights that still carry texture." },
    { id: "middle", label: "Middle", hint: "Zones IV–VI: where separation turns to mud." },
    { id: "dead", label: "No texture", hint: "Zones 0–I and IX–X: tone without detail." },
    { id: "families", label: "Ink families", hint: "Black · textured dark · middle · light · paper." },
    { id: "four", label: "Four values", hint: "Black · shadow · light · paper: the thumbnail test." },
    { id: "notan", label: "Light / shadow", hint: "Two values, split where you choose." },
  ];

  const greyOf = (z, scale, t) => {
    const g = Math.round(encodeL(lOfZone(z, scale), t) * 255);
    return [g, g, g];
  };

  // What each zone becomes under an overlay: a colour, or null to keep the
  // image's own grey (an identity band).
  function zoneFill(mode, k, scale, t, split) {
    const BLACK = [0, 0, 0];
    const WHITE = [255, 255, 255];
    const pick = (zones) => (zones.includes(k) ? ZONE_COLORS[k] : null);
    switch (mode) {
      case "zones":
        return ZONE_COLORS[k];
      case "darks":
        return pick([2, 3]);
      case "lights":
        return pick([7, 8]);
      case "middle":
        return pick([4, 5, 6]);
      case "dead":
        return pick([0, 1, 9, 10]);
      case "families":
        if (k <= 1) return BLACK;
        if (k <= 3) return greyOf(2.5, scale, t);
        if (k <= 6) return greyOf(5, scale, t);
        if (k <= 8) return greyOf(7.5, scale, t);
        return WHITE;
      case "four":
        if (k <= 1) return BLACK;
        if (k <= 5) return greyOf(3.5, scale, t);
        if (k <= 9) return greyOf(7.5, scale, t);
        return WHITE;
      case "notan":
        return k < split ? BLACK : WHITE;
      default:
        return null;
    }
  }

  function overlayBands(mode, { scale = SCREEN_SCALE, transfer = "srgb", split = 6 } = {}) {
    scale = safeScale(scale);
    if (!TRANSFERS[transfer]) transfer = "srgb";
    split = Math.round(num(split, 1, 10, 6));
    const edges = zoneEdges(scale, transfer);
    const bands = [];
    for (let k = 0; k <= 10; k++) {
      const from = edges[k];
      const to = Math.min(LOC_MAX, edges[k + 1] - 1);
      if (to < from) continue;
      const rgb = zoneFill(mode, k, scale, transfer, split);
      const prev = bands[bands.length - 1];
      const same = prev && (rgb === null ? prev.rgb === null : prev.rgb && prev.rgb.join() === rgb.join());
      if (same) prev.to = to;
      else bands.push({ from, to, rgb });
    }
    return bands;
  }

  // Bands -> gradient stops. Paired stops of one colour make hard-edged
  // bands; identity bands are a dense grey ramp so any interpolation method
  // returns the input grey unchanged.
  function bandsToStops(bands) {
    const stops = [];
    const push = (loc, rgb) => {
      let l = clamp(Math.round(loc), 0, LOC_MAX);
      const last = stops[stops.length - 1];
      if (last && l <= last.loc) l = last.loc + 1;
      if (l > LOC_MAX) return;
      stops.push({ loc: l, rgb });
    };
    for (const b of bands) {
      // Non-finite edges would never satisfy the loop's exit test.
      if (!Number.isFinite(b.from) || !Number.isFinite(b.to) || b.to < b.from) continue;
      if (b.rgb === null) {
        for (let loc = b.from; loc < b.to + 128; loc += 128) {
          const l = Math.min(loc, b.to);
          const g = Math.round((l / LOC_MAX) * 255);
          push(l, [g, g, g]);
        }
      } else {
        push(b.from, b.rgb);
        if (b.to > b.from) push(b.to, b.rgb);
      }
    }
    return stops;
  }

  const overlayStops = (mode, opts) => bandsToStops(overlayBands(mode, opts));

  // ---- Curves: development, placement, burning ---------------------------

  // Adams's N development: shadows near Zone III barely move, highlights
  // move a full zone per step of N. Pairs are in L* (input, output).
  const DEV_WEIGHTS = [0, 0, 0, 0, 0.25, 0.5, 0.75, 1, 1, 1];

  function developmentPairs(n, scale = SCREEN_SCALE) {
    scale = safeScale(scale);
    n = num(n, -3, 3, 0);
    const s = zoneStep(scale);
    const pairs = [[0, 0]];
    for (let k = 0; k <= 10; k++) {
      const L = lOfZone(k, scale);
      if (L <= 0 || L >= 100) continue;
      const w = k < 10 ? DEV_WEIGHTS[k] : n > 0 ? 0 : 0.6;
      pairs.push([L, clamp(L + n * s * w, 0, 100)]);
    }
    pairs.push([100, n < 0 ? 100 + n * s * 0.6 : 100]);
    // Let expanded highlights shoulder into white instead of clipping flat.
    return pairs.filter((p, i) => i === pairs.length - 1 || p[1] < 99.5);
  }

  // Place one marker on a zone (exposure) and optionally let a second fall
  // on another (development). Markers: [{ L, zone }] in any order.
  function placementPairs(markers, scale = SCREEN_SCALE) {
    scale = safeScale(scale);
    if (!markers.length || markers.some((m) => !Number.isFinite(m.L) || !Number.isFinite(m.zone))) {
      throw new Error("Couldn't read those markers. Check the Color Sampler markers on the image.");
    }
    const sorted = markers.slice().sort((a, b) => a.L - b.L);
    const anchors = [[0, 0]];
    for (const m of sorted) anchors.push([m.L, clamp(lOfZone(m.zone, scale), 0, 100)]);
    anchors.push([100, 100]);
    for (let i = 1; i < anchors.length; i++) {
      if (anchors[i][0] - anchors[i - 1][0] < 1) {
        throw new Error("A marker sits at pure black or white, or two markers read the same value. Move a marker and try again.");
      }
      if (anchors[i][1] < anchors[i - 1][1]) {
        throw new Error("The darker marker has to land on a darker zone than the lighter one.");
      }
    }
    const pairs = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      const [a0, b0] = anchors[i];
      const [a1, b1] = anchors[i + 1];
      pairs.push({ p: anchors[i], keep: true });
      for (let L = Math.ceil((a0 + 4) / 12.5) * 12.5; L < a1 - 4; L += 12.5) {
        pairs.push({ p: [L, b0 + ((L - a0) * (b1 - b0)) / (a1 - a0)], keep: false });
      }
    }
    pairs.push({ p: anchors[anchors.length - 1], keep: true });
    return pairs.map((x) => (x.keep ? Object.assign(x.p.slice(), { keep: true }) : x.p));
  }

  function placementSummary(markers, scale = SCREEN_SCALE) {
    const sorted = markers.slice().sort((a, b) => a.L - b.L);
    const first = sorted[0];
    const shift = first.zone - zoneValue(first.L, scale);
    let development = null;
    if (sorted.length > 1) {
      const last = sorted[sorted.length - 1];
      const measured = zoneValue(last.L, scale) - zoneValue(first.L, scale);
      development = last.zone - first.zone - measured;
    }
    return { shift, development };
  }

  // Burning prints down: every value darkens in proportion, black stays black.
  const BURN_DEPTH = 0.3;
  function burnPairs() {
    const pairs = [];
    for (let L = 0; L <= 100; L += 12.5) pairs.push([L, L * (1 - BURN_DEPTH)]);
    return pairs;
  }

  // L* pairs -> Photoshop curve points (0..255) in a working space.
  // Inputs strictly increase at least 3 levels apart; outputs never fall.
  const MAX_CURVE_POINTS = 14;
  function toCurvePoints(pairs, t = "srgb") {
    let pts = pairs.map((p) => ({
      x: Math.round(encodeL(p[0], t) * 255),
      y: Math.round(encodeL(p[1], t) * 255),
      keep: !!p.keep,
    }));
    pts[0].keep = true;
    pts[pts.length - 1].keep = true;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const last = out[out.length - 1];
      if (last && p.x - last.x < 3) {
        if (p.keep && !last.keep) out[out.length - 1] = p;
        else if (i === pts.length - 1) out[out.length - 1] = p;
        continue;
      }
      out.push(p);
    }
    for (let i = 1; i < out.length; i++) if (out[i].y < out[i - 1].y) out[i].y = out[i - 1].y;
    while (out.length > MAX_CURVE_POINTS) {
      const idx = out.findIndex((p, i) => i > 0 && i < out.length - 1 && !p.keep);
      if (idx < 0) break;
      out.splice(idx, 1);
    }
    return out.map((p) => [p.x, p.y]);
  }

  // ---- Measurement and reading ------------------------------------------

  function zoneFractions(Ls, scale = SCREEN_SCALE) {
    scale = safeScale(scale);
    const counts = new Array(11).fill(0);
    let n = 0;
    for (let i = 0; i < Ls.length; i++) {
      if (!Number.isFinite(Ls[i])) continue;
      counts[zoneIndex(Ls[i], scale)]++;
      n++;
    }
    return counts.map((c) => (n ? c / n : 0));
  }

  // Average lightness as a meter would: average luminance, then back to L*.
  function meterAverage(Ls) {
    if (!Ls.length) return 0;
    let y = 0;
    for (let i = 0; i < Ls.length; i++) y += yFromL(Ls[i]);
    return lFromY(y / Ls.length);
  }

  const PRESENCE = 0.002; // 0.2% of the frame counts as "present"

  function analyze(fr) {
    const sum = (a, b) => fr.slice(a, b + 1).reduce((s, v) => s + v, 0);
    const r = {
      dark: sum(0, 4),
      light: sum(6, 10),
      middle: sum(4, 6),
      texturedDark: sum(2, 3),
      texturedLight: sum(7, 8),
      black: sum(0, 1),
      white: sum(9, 10),
    };
    r.dead = r.black + r.white;
    r.key = r.dark >= 0.6 ? "low" : r.light >= 0.6 ? "high" : "middle";
    r.hasBlack = r.black >= PRESENCE;
    r.hasWhite = r.white >= PRESENCE;
    r.range = r.hasBlack && r.hasWhite ? "full" : r.hasBlack ? "no-white" : r.hasWhite ? "no-black" : "compressed";
    return r;
  }

  const KEY_LABEL = { low: "Low key", middle: "Middle key", high: "High key" };
  const RANGE_LABEL = {
    full: "Full scale",
    "no-white": "No paper white",
    "no-black": "No true black",
    compressed: "No black or white",
  };
  const INTENTS = [
    { id: "low", label: "Low key", hint: "Dark, brooding, most of the frame in shadow." },
    { id: "full", label: "Full scale", hint: "Deep black to brilliant white, rich separations between." },
    { id: "high", label: "High key", hint: "Luminous and airy, most of the frame in light." },
  ];

  const pct = (v) => Math.round(v * 100) + "%";

  // Concrete moves from the scene as measured toward the print visualized.
  // Concrete moves from the scene as measured toward the print visualized.
  // Each move is advice text plus one-click tries the panel can apply:
  //   { type: "place", index, zone } · { type: "dev", n } · { type: "filter", id }
  //   { type: "burnEdges", amount } · { type: "goto", step }
  // ctx.shadowZone is marker #1's measured zone (or null); ctx.rgb says
  // whether colour filters apply.
  function moves(intent, a, { shadowZone = null, rgb = true } = {}) {
    const out = [];
    const add = (text, tries) => out.push({ text, tries: tries.filter(Boolean) });
    const place = (zone) => {
      if (!Number.isFinite(shadowZone)) return null;
      const z = clamp(Math.round(zone), 0, 10);
      return Math.round(shadowZone) === z ? null : { label: `Place #1 on Zone ${ROMAN[z]}`, action: { type: "place", index: 1, zone: z } };
    };
    const dev = (n) => ({ label: `Try ${devLabel(n)}`, action: { type: "dev", n } });
    const burn = { label: "Burn the edges", action: { type: "burnEdges", amount: 50 } };
    if (intent === "low" && a.dark < 0.6) {
      add(
        `Only ${pct(a.dark)} of the frame is dark. A low-key print wants most of it in Zones 0–IV: place your shadow anchor a zone lower, burn the edges, and darken the sky (red filter if it is blue).`,
        [place(Math.round(shadowZone) - 1), burn, rgb ? { label: "Red filter", action: { type: "filter", id: "red" } } : null]
      );
    }
    if (intent === "high" && a.light < 0.6) {
      add(
        `Only ${pct(a.light)} of the frame is light. For a high-key print, place your shadow anchor on Zone IV or V so the whole scale lifts, and use N−1 to keep the highlights textured.`,
        [Number.isFinite(shadowZone) && shadowZone < 4 ? place(4) : null, dev(-1)]
      );
    }
    if (intent === "full" && !a.hasBlack) {
      add("Nothing reaches Zone 0–I. Give the image one deliberate black: place the darkest accent lower, or expand with N+1.", [dev(1)]);
    }
    if (intent === "full" && !a.hasWhite) {
      add("Nothing reaches Zone IX–X. Expand with N+1, or burn down around your focal light so it reads brighter by contrast.", [dev(1), burn]);
    }
    if (a.middle > 0.5) {
      add(
        `${pct(a.middle)} of the frame sits in Zones IV–VI, where separation turns to mud. Expand (N+1), or fold the background into one value to free up steps for the subject.`,
        [dev(1)]
      );
    }
    if (a.dark > 0.3 && a.texturedDark < 0.05) {
      add(
        `Little of the dark area keeps texture (Zones II–III are ${pct(a.texturedDark)} of the frame). Place your shadow anchor on Zone III so darks read as shadow, not dead black.`,
        [place(3)]
      );
    }
    if (a.dead > 0.3) {
      add(`${pct(a.dead)} of the frame has no texture at all (0–I or IX–X). That is chalk and soot unless it is a deliberate graphic choice.`, [dev(-1)]);
    }
    if (!out.length) {
      add("The scene already supports the print you visualized. Now decide where to spend separation: compress what doesn't matter, expand what does.", [
        { label: "Compare 20 performances", action: { type: "goto", step: "compare" } },
      ]);
    }
    return out;
  }

  const suggestions = (intent, a) => moves(intent, a).map((m) => m.text);

  // ---- Practice scoring ---------------------------------------------------

  function scorePredictions(rows) {
    const scored = rows
      .filter((r) => Number.isFinite(r.guess) && Number.isFinite(r.actual))
      .map((r) => Object.assign({}, r, { error: r.guess - r.actual }));
    const n = scored.length;
    const mae = n ? scored.reduce((s, r) => s + Math.abs(r.error), 0) / n : null;
    const bias = n ? scored.reduce((s, r) => s + r.error, 0) / n : null;
    return {
      rows: scored,
      count: n,
      mae,
      bias,
      withinHalf: scored.filter((r) => Math.abs(r.error) <= 0.5).length,
      withinOne: scored.filter((r) => Math.abs(r.error) <= 1).length,
    };
  }

  const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

  function practiceStats(entries) {
    const scored = entries.filter((e) => Number.isFinite(e.mae));
    const recent = scored.slice(-10);
    const earlier = scored.slice(-20, -10);
    const biasSet = scored.slice(-20).filter((e) => Number.isFinite(e.bias));
    const darkSet = entries.slice(-10).filter((e) => Number.isFinite(e.darkGuess) && Number.isFinite(e.darkActual));
    return {
      sessions: entries.length,
      recentMae: mean(recent.map((e) => e.mae)),
      earlierMae: earlier.length ? mean(earlier.map((e) => e.mae)) : null,
      bias: mean(biasSet.map((e) => e.bias)),
      darkMiss: mean(darkSet.map((e) => Math.abs(e.darkGuess - e.darkActual))),
    };
  }

  function logToCsv(entries) {
    const q = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = ["date", "image", "intent", "visualization", "dark_guess_pct", "dark_measured_pct", "markers", "mean_miss_zones", "bias_zones", "measured_key", "measured_range"];
    const lines = entries.map((e) =>
      [
        e.date,
        e.image,
        e.intent,
        e.sentence,
        e.darkGuess,
        e.darkActual,
        e.markers,
        Number.isFinite(e.mae) ? e.mae.toFixed(2) : "",
        Number.isFinite(e.bias) ? e.bias.toFixed(2) : "",
        e.key,
        e.range,
      ]
        .map(q)
        .join(",")
    );
    return [head.join(",")].concat(lines).join("\n") + "\n";
  }

  // Ink coverage needed for a lightness, given paper and ink lightness.
  function inkCoverage(L, scale = INK_SCALE) {
    const yPaper = yFromL(scale.white);
    const yInk = yFromL(scale.black);
    return clamp((yPaper - yFromL(L)) / (yPaper - yInk), 0, 1);
  }

  // ---- Optical averaging ----------------------------------------------------

  // Three box blurs approximate a Gaussian (Kovesi). Box widths for sigma.
  function boxesForGauss(sigma, n = 3) {
    const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(ideal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    const sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }

  // Running-sum box blur along rows (step 1) or columns (step w), with the
  // edge pixel repeated beyond the border.
  function boxPass(src, dst, len, lines, stride, lineStride, r) {
    const inv = 1 / (r + r + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      const at = (i) => src[base + Math.min(Math.max(i, 0), len - 1) * stride];
      let acc = (r + 2) * at(0);
      for (let k = 1; k < r; k++) acc += at(k);
      for (let i = 0; i < len; i++) {
        acc += at(i + r) - at(i - r - 1);
        dst[base + i * stride] = acc * inv;
      }
    }
  }

  // Gaussian-blur interleaved pixel data in place. comps: channels to blur
  // (an alpha channel beyond them is left alone); stride: values per pixel.
  function blurPixels(data, width, height, comps, stride, sigma) {
    if (!(sigma > 0.3)) return data;
    const n = width * height;
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    const sizes = boxesForGauss(sigma);
    for (let c = 0; c < comps; c++) {
      for (let i = 0; i < n; i++) a[i] = data[i * stride + c];
      for (const size of sizes) {
        const r = (size - 1) / 2;
        if (r < 1) continue;
        boxPass(a, b, width, height, 1, width, r);
        boxPass(b, a, height, width, width, 1, r);
      }
      for (let i = 0; i < n; i++) data[i * stride + c] = Math.round(a[i]);
    }
    return data;
  }

  // How far a blur reaches: the sum of the box radii. A row of the result
  // depends only on source rows within this distance.
  function blurSupport(sigma) {
    if (!(sigma > 0.3)) return 0;
    return boxesForGauss(sigma).reduce((s, size) => s + (size - 1) / 2, 0);
  }

  // Split an image into horizontal bands for processing within a memory
  // budget. Each band writes rows [y0, y1) and reads [top, bottom), which adds
  // `margin` rows of context on each side. Returns null when even a modest
  // band can't fit, so callers can refuse instead of exhausting memory.
  const MIN_BAND_ROWS = 32;
  function bandPlan({ width, height, margin, budget }) {
    if (!(width > 0 && height > 0 && margin >= 0 && budget > 0)) return null;
    const core = Math.floor(budget / width) - 2 * margin;
    if (core < Math.min(height, MIN_BAND_ROWS)) return null;
    const rows = Math.min(height, core);
    const bands = [];
    for (let y0 = 0; y0 < height; y0 += rows) {
      const y1 = Math.min(height, y0 + rows);
      bands.push({ y0, y1, top: Math.max(0, y0 - margin), bottom: Math.min(height, y1 + margin) });
    }
    return bands;
  }

  // ---- Interpretations -------------------------------------------------------

  // Glass filters on panchromatic film, as monochrome channel mixes (R, G, B %).
  const FILTERS = [
    { id: "none", label: "No filter", weights: [30, 59, 11], note: "Luminance, the way a spot meter reads the scene." },
    { id: "yellow", label: "Yellow (#8)", weights: [45, 50, 5], note: "Slightly darker blue sky; clouds begin to separate." },
    { id: "orange", label: "Orange (#21)", weights: [60, 40, 0], note: "Darker sky, cuts haze, lightens warm stone." },
    { id: "red", label: "Red (#25)", weights: [85, 25, -10], note: "Dramatic sky and deep shadow; foliage darkens." },
    { id: "deepred", label: "Deep red (#29)", weights: [110, 10, -20], note: "The Monolith filter: blue sky goes nearly black." },
    { id: "green", label: "Green (#58)", weights: [10, 90, 0], note: "Foliage lightens and separates; reds and skin darken." },
    { id: "blue", label: "Blue (#47)", weights: [0, 30, 70], note: "Adds haze and atmosphere; the sky goes pale." },
  ];
  const filterById = (id) => FILTERS.find((f) => f.id === id) || FILTERS[0];

  const devLabel = (n) => (n === 0 ? "N" : n > 0 ? "N+" + n : "N−" + Math.abs(n));
  const signedZones = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);

  const SHEET_FILTERS = ["none", "yellow", "red", "green", "blue"];
  const SHEET_DEVS = [-1, 0, 1, 2];

  return {
    ROMAN,
    ZONES,
    ZONE_COLORS,
    SCREEN_SCALE,
    INK_SCALE,
    LOC_MAX,
    OVERLAY_MODES,
    INTENTS,
    KEY_LABEL,
    RANGE_LABEL,
    FILTERS,
    SHEET_FILTERS,
    SHEET_DEVS,
    clamp,
    validScale,
    safeScale,
    num,
    zoneStep,
    zoneValue,
    zoneIndex,
    lOfZone,
    roman,
    yFromL,
    lFromY,
    transferFor,
    encodeL,
    decodeToL,
    zoneEdges,
    overlayBands,
    bandsToStops,
    overlayStops,
    developmentPairs,
    placementPairs,
    placementSummary,
    burnPairs,
    toCurvePoints,
    zoneFractions,
    meterAverage,
    analyze,
    suggestions,
    moves,
    scorePredictions,
    practiceStats,
    logToCsv,
    inkCoverage,
    boxesForGauss,
    blurPixels,
    blurSupport,
    bandPlan,
    filterById,
    devLabel,
    signedZones,
  };
});
