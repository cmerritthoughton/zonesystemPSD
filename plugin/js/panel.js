/*
 * Visualize First — panel.
 *
 * The training loop: visualize (write the print you want) → predict (guess
 * zones at markers you place) → reveal (measure, compare, read the frame)
 * → interpret (filter, place, develop, burn) → opportunities (see many
 * performances at once). Ink tools and the practice log sit alongside.
 */
(function () {
  "use strict";
  const Z = window.VFZones;
  const P = window.VFps;
  const $ = (id) => document.getElementById(id);

  const STEPS = [
    ["visualize", "Visualize"],
    ["predict", "Predict"],
    ["reveal", "Reveal"],
    ["interpret", "Interpret"],
    ["opportunities", "Opportunities"],
    ["ink", "Ink"],
    ["practice", "Practice"],
  ];
  const OVERLAY_STEPS = ["reveal", "interpret", "opportunities", "ink"];
  const BLIND_STEPS = ["visualize", "predict"];
  const LOG_KEY = "visualizeFirst.log.v1";
  const SETTINGS_KEY = "visualizeFirst.settings.v1";

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage unavailable: settings last for this session only */
      }
    },
  };

  const settings = Object.assign({ training: true, spot: "spot", scaleMode: "screen", ink: { black: 15, white: 94 } }, store.get(SETTINGS_KEY, {}));
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  const S = { step: "visualize", doc: null, sessions: {}, busy: false, pending: null, sig: "", markerSig: "", sheet: null, clearArmed: null };

  const freshSession = () => ({
    sentence: "",
    intent: "full",
    darkGuess: 50,
    guesses: {},
    reveal: null,
    overlay: "off",
    opacity: 100,
    split: 6,
    filter: "none",
    dev: 0,
    devText: "N",
    burnEdges: 0,
    burnSky: 0,
    skyDepth: "0.4",
    placeA: 1,
    placeAZone: 3,
    placeB: 2,
    placeBZone: 8,
    useB: true,
    placement: null,
    mono: false,
    mm: 1,
    inkRead: null,
  });

  function session() {
    const id = S.doc ? S.doc.id : "none";
    if (!S.sessions[id]) S.sessions[id] = freshSession();
    return S.sessions[id];
  }

  const scale = () => (settings.scaleMode === "ink" && Z.validScale(settings.ink) ? settings.ink : Z.SCREEN_SCALE);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (v) => Math.round(v * 100) + "%";
  const fmtZone = (z) => Z.roman(z) + " (" + z.toFixed(1) + ")";
  const textOn = (rgb) => (rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 140 ? "#111" : "#fff");
  const chip = (z) => {
    const c = Z.ZONE_COLORS[Z.clamp(Math.round(z), 0, 10)];
    return `<span class="chip" style="background: rgb(${c.join(",")}); color: ${textOn(c)}">${Z.roman(z)}</span>`;
  };
  const roleOf = (index) => (index === 1 ? "Shadow anchor" : index === 2 ? "Light anchor" : "Marker");
  const zoneOptions = (selected, blank) =>
    (blank ? `<option value="">Your guess…</option>` : "") +
    Z.ROMAN.map((r, k) => `<option value="${k}"${selected === k ? " selected" : ""}>${r} · ${Z.ZONES[k].meaning}</option>`).join("");
  const markerOptions = (selected) => {
    const ms = S.doc ? S.doc.markers : [];
    if (!ms.length) return `<option value="">No markers yet</option>`;
    return ms.map((m) => `<option value="${m.index}"${m.index === selected ? " selected" : ""}>#${m.index}</option>`).join("");
  };
  const isFocused = (el) => document.activeElement === el;

  // ---- Status and running operations ------------------------------------------

  function status(text, isError) {
    const el = $("status");
    el.textContent = text || "";
    el.className = "status" + (isError ? " error" : "");
  }

  // One Photoshop operation at a time. Settings that simply replace the last
  // value (overlay, filter, development, burns) queue their latest request so
  // the image always ends up matching the panel; anything heavier is ignored
  // while busy, so a double click can't start it twice. fn may return a
  // message to show when it finishes.
  async function run(label, fn, { queue = false } = {}) {
    if (S.busy) {
      if (queue) {
        S.pending = { label, fn };
        status(label + " (queued)");
      } else {
        status("Still working on the last step…");
      }
      return;
    }
    if (!S.doc) {
      status("Open an image first.", true);
      return;
    }
    S.busy = true;
    status(label);
    try {
      const message = await fn();
      status(typeof message === "string" ? message : "");
    } catch (e) {
      status(e && e.message ? e.message : String(e), true);
    } finally {
      S.busy = false;
      refresh(true);
    }
    if (S.pending) {
      const next = S.pending;
      S.pending = null;
      await run(next.label, next.fn, { queue: true });
    }
  }

  // ---- Reading state back from the document's layers -------------------------

  function syncFromLayers(ses, info) {
    const L = info.layers;
    const detail = (l) => (l && l.name.includes(" — ") ? l.name.split(" — ").slice(1).join(" — ") : "");
    if (L.overlay) {
      const label = detail(L.overlay);
      const mode = Z.OVERLAY_MODES.find((m) => m.label === label);
      ses.overlay = L.overlay.visible && mode ? mode.id : "off";
      ses.opacity = L.overlay.opacity;
    } else ses.overlay = "off";
    ses.mono = !!(L.filter && L.filter.visible);
    if (L.filter) {
      const f = Z.FILTERS.find((x) => x.label === detail(L.filter));
      if (f) ses.filter = f.id;
    }
    if (L.dev) {
      const d = detail(L.dev);
      ses.devText = d;
      const m = /^N([+−])?(\d)?$/.exec(d);
      ses.dev = m ? (m[1] ? (m[1] === "+" ? 1 : -1) * Number(m[2]) : 0) : null;
    }
    ses.burnEdges = L.burnEdges && L.burnEdges.visible ? L.burnEdges.opacity : 0;
    ses.burnSky = L.burnSky && L.burnSky.visible ? L.burnSky.opacity : 0;
    const depth = L.burnSky && /(\d+)% down/.exec(L.burnSky.name);
    if (depth) ses.skyDepth = String(Number(depth[1]) / 100);
  }

  function signature(info) {
    if (!info) return "none";
    return [info.id, info.title, info.isGray, JSON.stringify(info.markers), JSON.stringify(info.layers), info.groupVisible].join("|");
  }

  function refresh(force) {
    let info = null;
    try {
      info = P.docInfo();
    } catch (e) {
      info = null;
    }
    const sig = signature(info);
    if (!force && sig === S.sig) return;
    S.sig = sig;
    S.doc = info;
    if (info) syncFromLayers(session(), info);
    render();
  }

  // ---- Rendering ----------------------------------------------------------------------

  function render() {
    renderHeader();
    renderVisualize();
    renderPredict();
    renderReveal();
    renderInterpret();
    renderOpportunities();
    renderInk();
    renderPractice();
    renderOverlay();
  }

  function renderHeader() {
    const d = S.doc;
    $("docline").textContent = d ? `${d.title} · ${d.isGray ? "Grayscale" : "RGB"} ${d.bits}-bit · ${d.markers.length} marker${d.markers.length === 1 ? "" : "s"}` : "No image open";
    $("steps").innerHTML = STEPS.map(([id, label]) => `<button data-step="${id}" class="${S.step === id ? "on" : ""}">${label}</button>`).join("");
    document.querySelectorAll("section[data-step]").forEach((sec) => {
      sec.style.display = sec.getAttribute("data-step") === S.step ? "block" : "none";
    });
    const showOverlay = OVERLAY_STEPS.includes(S.step) || (!settings.training && S.step !== "practice");
    $("overlayBar").style.display = showOverlay ? "block" : "none";
  }

  function renderVisualize() {
    const ses = session();
    if (!isFocused($("sentence"))) $("sentence").value = ses.sentence;
    $("intent").innerHTML = Z.INTENTS.map((i) => `<button data-intent="${i.id}" class="${ses.intent === i.id ? "on" : ""}">${i.label}</button>`).join("");
    $("intentHint").textContent = (Z.INTENTS.find((i) => i.id === ses.intent) || {}).hint || "";
    $("mono").checked = ses.mono;
    $("mono").disabled = !!(S.doc && S.doc.isGray);
  }

  function gateReasons() {
    const ses = session();
    const reasons = [];
    if (!S.doc) return ["Open an image first."];
    if (ses.sentence.trim().length < 10) reasons.push("Write your visualization first (Visualize).");
    if (!S.doc.markers.length) reasons.push("Place at least one Color Sampler marker on the image.");
    else if (!Object.keys(ses.guesses).some((k) => S.doc.markers.some((m) => String(m.index) === k))) reasons.push("Guess the zone of at least one marker.");
    return reasons;
  }

  function renderPredict() {
    const ses = session();
    const ms = S.doc ? S.doc.markers : [];
    const msig = (S.doc ? S.doc.id : "") + JSON.stringify(ms.map((m) => m.index));
    if (msig !== S.markerSig || !$("markerList").innerHTML) {
      S.markerSig = msig;
      $("markerList").innerHTML = ms.length
        ? ms
            .map(
              (m) => `<div class="mrow"><b>#${m.index}</b><span class="grow">${roleOf(m.index)}</span>
              <select data-guess="${m.index}">${zoneOptions(ses.guesses[m.index], true)}</select></div>`
            )
            .join("")
        : `<p class="hint">No markers yet. Choose the Color Sampler tool (I) and click the image.</p>`;
    }
    if (!isFocused($("darkGuess"))) $("darkGuess").value = ses.darkGuess;
    $("darkGuessVal").textContent = ses.darkGuess + "%";
    const reasons = settings.training ? gateReasons() : S.doc ? [] : ["Open an image first."];
    $("reveal").disabled = reasons.length > 0;
    $("revealGate").textContent = reasons.length ? reasons.join(" ") : settings.training ? "Committed. Reveal when ready." : "";
  }

  function errorWords(e) {
    if (Math.abs(e) <= 0.25) return "spot on";
    return `you read it ${Math.abs(e).toFixed(1)} zone${Math.abs(e) >= 1.05 ? "s" : ""} ${e > 0 ? "lighter" : "darker"}`;
  }

  function renderReveal() {
    const ses = session();
    const body = $("revealBody");
    if (!ses.reveal) {
      const reasons = settings.training ? gateReasons() : [];
      body.innerHTML = `<p class="hint">${reasons.length ? "Not yet. " + esc(reasons.join(" ")) : "Use Reveal on the Predict step to measure."}</p>`;
      return;
    }
    const r = ses.reveal;
    const a = r.dist.analysis;
    const fr = r.dist.fractions;
    const maxF = Math.max.apply(null, fr) || 1;
    const intent = Z.INTENTS.find((i) => i.id === r.intent) || Z.INTENTS[1];
    const rows = r.rows
      .map((row) => {
        const guess = Number.isFinite(row.guess) ? `you said ${Z.roman(row.guess)} · ` : "";
        const err = Number.isFinite(row.guess) ? ` · <span class="muted">${errorWords(row.guess - row.actual)}</span>` : "";
        return `<div class="mrow">${chip(row.actual)}<span class="grow"><b>#${row.index}</b> ${roleOf(row.index)}: ${guess}measured ${fmtZone(row.actual)}${err}</span></div>`;
      })
      .join("");
    const sc = r.score;
    let summary = "";
    if (sc.count) {
      summary = `<p>Average miss ${sc.mae.toFixed(1)} zone · ${sc.withinOne} of ${sc.count} within one zone.</p>`;
      if (sc.bias > 0.3) summary += `<p class="hint">You saw these values lighter than they measure. The eye adapts to shadow; film and paper don't.</p>`;
      else if (sc.bias < -0.3) summary += `<p class="hint">You saw these values darker than they measure.</p>`;
    }
    const bars = fr.map((f, k) => `<div class="bar" title="Zone ${Z.ROMAN[k]}: ${pct(f)}" style="height: ${Math.max(2, Math.round((f / maxF) * 80))}px; background: rgb(${Z.ZONE_COLORS[k].join(",")})"></div>`).join("");
    const labels = fr.map((f, k) => `<span>${Z.ROMAN[k]}<br/>${f >= 0.005 ? Math.round(f * 100) : "·"}</span>`).join("");
    const suggestions = Z.suggestions(r.intent, a).map((s) => `<li>${esc(s)}</li>`).join("");
    body.innerHTML = `
      <div class="quote">“${esc(r.sentence)}”</div>
      <p class="hint small">You wanted: ${intent.label}.</p>
      <h3>Your markers</h3>
      ${rows || `<p class="hint">No markers were measured.</p>`}
      ${summary}
      <h3>The whole frame</h3>
      <p>You estimated ${r.darkGuess}% dark; it measures ${pct(a.dark)} (Zones 0–IV).</p>
      <div class="bars">${bars}</div>
      <div class="barlabels">${labels}</div>
      <p><b>${Z.KEY_LABEL[a.key]}</b> · ${Z.RANGE_LABEL[a.range]}</p>
      <p class="hint small">Textured darks (II–III) ${pct(a.texturedDark)} · textured lights (VII–VIII) ${pct(a.texturedLight)} · middle (IV–VI) ${pct(a.middle)} · no texture (0–I, IX–X) ${pct(a.dead)}</p>
      <h3>Toward your visualization</h3>
      <ul>${suggestions}</ul>
      <div class="row"><button data-goto="interpret" class="cta">Interpret</button><button data-goto="opportunities">See the opportunities</button></div>`;
  }

  function renderInterpret() {
    const ses = session();
    const rgb = !!(S.doc && S.doc.isRGB);
    if (!$("filter").options.length) $("filter").innerHTML = Z.FILTERS.map((f) => `<option value="${f.id}">${f.label}</option>`).join("");
    $("filter").value = ses.filter;
    $("filter").disabled = !rgb;
    $("filterNote").textContent = rgb ? Z.filterById(ses.filter).note : "Filters need colour; this image is Grayscale.";
    $("devs").innerHTML = [-2, -1, 0, 1, 2].map((n) => `<button data-dev="${n}" class="${ses.dev === n ? "on" : ""}">${Z.devLabel(n)}</button>`).join("");
    for (const [id, key] of [
      ["placeA", "placeA"],
      ["placeB", "placeB"],
    ]) {
      if (!isFocused($(id))) $(id).innerHTML = markerOptions(ses[key]);
    }
    if (!isFocused($("placeAZone"))) $("placeAZone").innerHTML = zoneOptions(ses.placeAZone, false);
    if (!isFocused($("placeBZone"))) $("placeBZone").innerHTML = zoneOptions(ses.placeBZone, false);
    $("useB").checked = ses.useB;
    $("placeBLine").style.display = ses.useB ? "flex" : "none";
    $("place").disabled = !(S.doc && S.doc.markers.length);
    $("placeResult").innerHTML = ses.placement ? placementWords(ses.placement) : ses.dev === null && ses.devText ? `<span class="hint">Current development: ${esc(ses.devText)}</span>` : "";
    if (!isFocused($("burnEdges"))) $("burnEdges").value = ses.burnEdges;
    $("burnEdgesVal").textContent = ses.burnEdges + "%";
    if (!isFocused($("burnSky"))) $("burnSky").value = ses.burnSky;
    $("burnSkyVal").textContent = ses.burnSky + "%";
    $("skyDepth").value = ses.skyDepth;
  }

  function placementWords(p) {
    const first = p.markers.slice().sort((a, b) => a.L - b.L)[0];
    const parts = [`Placement: marker #${first.index} moved ${Z.signedZones(p.shift)} zone from ${Z.roman(first.from)} to ${Z.roman(first.zone)}, about ${Math.abs(p.shift).toFixed(1)} stop${Math.abs(p.shift) >= 1.05 ? "s" : ""} ${p.shift >= 0 ? "more" : "less"} exposure.`];
    if (p.development !== null) {
      const d = p.development;
      const kind = d > 0.15 ? `expansion, N+${d.toFixed(1)}` : d < -0.15 ? `contraction, N−${Math.abs(d).toFixed(1)}` : "normal development, N";
      parts.push(`Development: ${kind}. The interval between your markers ${d > 0.15 ? "stretched" : d < -0.15 ? "shrank" : "held"}.`);
    }
    return parts.map((t) => `<span>${esc(t)}</span>`).join("<br/>");
  }

  function renderOpportunities() {
    const box = $("variantBox");
    if (!S.sheet) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    $("variantLabel").textContent = `Apply a variant to ${S.sheet.sourceTitle}`;
    if (!isFocused($("variant"))) {
      $("variant").innerHTML = S.sheet.variants.map((v, i) => `<option value="${i}">${Z.filterById(v.filterId).label} · ${Z.devLabel(v.n)}</option>`).join("");
    }
  }

  function renderInk() {
    const ses = session();
    $("grayNotice").style.display = S.doc && S.doc.isGray ? "block" : "none";
    document.querySelectorAll("#scaleMode button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-scale") === settings.scaleMode));
    if (!isFocused($("inkBlack"))) $("inkBlack").value = settings.ink.black;
    if (!isFocused($("inkWhite"))) $("inkWhite").value = settings.ink.white;
    $("inkScaleRow").style.display = settings.scaleMode === "ink" ? "flex" : "none";
    $("scaleHint").textContent =
      settings.scaleMode === "ink"
        ? Z.validScale(settings.ink)
          ? `Zones run from solid ink (L* ${settings.ink.black}) to bare paper (L* ${settings.ink.white}), about ${Z.zoneStep(settings.ink).toFixed(1)} L* apart.`
          : "Paper must be at least 20 L* lighter than ink; using the screen scale until then."
        : "Zones run from screen black (L* 0) to screen white (L* 100); Zone V is L* 50.";
    if (!isFocused($("mm"))) $("mm").value = ses.mm;
    $("mmVal").textContent = Number(ses.mm).toFixed(1) + " mm";
    const ppi = S.doc ? S.doc.resolution || 72 : 72;
    $("mmPx").textContent = `About ${((ses.mm * ppi) / 25.4).toFixed(1)} px at ${Math.round(ppi)} ppi. Set it near your hatching's line spacing, or larger for viewing from across the room.`;
    const rows = ses.inkRead;
    $("inkReadout").innerHTML = rows
      ? rows.length
        ? rows
            .map(
              (m) =>
                `<div class="mrow">${chip(m.zone)}<span class="grow"><b>#${m.index}</b> L* ${m.L.toFixed(1)} · Zone ${fmtZone(m.zone)}${
                  settings.scaleMode === "ink" ? ` · about ${Math.round(Z.inkCoverage(m.L, scale()) * 100)}% ink` : ""
                }</span></div>`
            )
            .join("")
        : `<p class="hint">No markers on the image.</p>`
      : "";
  }

  function renderPractice() {
    const log = store.get(LOG_KEY, []);
    const st = Z.practiceStats(log);
    const lines = [`<p><b>${st.sessions}</b> practice session${st.sessions === 1 ? "" : "s"} logged.</p>`];
    if (st.recentMae !== null) lines.push(`<p>Average miss over the last ten: <b>${st.recentMae.toFixed(2)} zone</b>${st.earlierMae !== null ? ` (the ten before: ${st.earlierMae.toFixed(2)})` : ""}.</p>`);
    if (st.bias !== null && Math.abs(st.bias) >= 0.15) lines.push(`<p>Tendency: you read values ${Math.abs(st.bias).toFixed(1)} zone ${st.bias > 0 ? "lighter" : "darker"} than they measure.</p>`);
    if (st.darkMiss !== null) lines.push(`<p>Your dark-area estimates are off by ${Math.round(st.darkMiss)} points on average.</p>`);
    $("logStats").innerHTML = lines.join("");
    $("logList").innerHTML = log
      .slice(-8)
      .reverse()
      .map(
        (e) => `<div class="entry"><div><b>${esc(e.image)}</b> <span class="muted">${esc(String(e.date).slice(0, 10))}</span></div>
        <div class="quote small">“${esc(e.sentence)}”</div>
        <div class="muted small">${Number.isFinite(e.mae) ? `miss ${e.mae.toFixed(2)} zone · ` : ""}dark ${e.darkGuess}% guessed, ${e.darkActual}% measured · ${esc(Z.KEY_LABEL[e.key] || "")}</div></div>`
      )
      .join("");
    $("clearLog").textContent = S.clearArmed ? "Click again to clear" : "Clear log";
    $("training").checked = settings.training;
    $("spot").value = settings.spot;
  }

  function renderOverlay() {
    const ses = session();
    $("overlayModes").innerHTML = Z.OVERLAY_MODES.map((m) => `<button data-overlay="${m.id}" class="${ses.overlay === m.id ? "on" : ""}">${m.label}</button>`).join("");
    const mode = Z.OVERLAY_MODES.find((m) => m.id === ses.overlay) || Z.OVERLAY_MODES[0];
    $("overlayHint").textContent = mode.id === "off" ? "" : mode.hint;
    $("splitRow").style.display = ses.overlay === "notan" ? "block" : "none";
    if (!isFocused($("split"))) $("split").value = ses.split;
    $("splitVal").textContent = "Zone " + Z.ROMAN[ses.split];
    if (!isFocused($("opacity"))) $("opacity").value = ses.opacity;
    $("opacityVal").textContent = ses.opacity + "%";
    const showLegend = ["zones", "darks", "lights", "middle", "dead"].includes(ses.overlay);
    $("legend").innerHTML = showLegend ? Z.ZONE_COLORS.map((c, k) => `<span style="background: rgb(${c.join(",")}); color: ${textOn(c)}" title="${esc(Z.ZONES[k].meaning)}">${Z.ROMAN[k]}</span>`).join("") : "";
  }

  // ---- Actions --------------------------------------------------------------------------

  async function setStep(step) {
    S.step = step;
    render();
    // In training, nothing measured may be on screen while you look and guess.
    if (settings.training && BLIND_STEPS.includes(step) && session().overlay !== "off" && !session().reveal) {
      await run("Hiding the overlay…", () => P.hideOverlay());
    }
  }

  // Requests capture their values when made: by the time a queued request
  // runs, refreshing from the layers may have changed the session.
  const overlayRequest = () => {
    const ses = session();
    return { mode: ses.overlay, opacity: ses.opacity, split: ses.split, scale: scale() };
  };
  const applyOverlay = (req = overlayRequest()) => P.setOverlay(req);
  const queueOverlay = (label) => {
    const req = overlayRequest();
    run(label, () => applyOverlay(req), { queue: true });
  };

  async function reveal() {
    await run("Measuring…", async () => {
      const ses = session();
      const sc = scale();
      const measured = await P.measureMarkers({ scale: sc, spot: settings.spot });
      const dist = await P.measureDistribution({ scale: sc });
      const rows = measured.map((m) => ({ index: m.index, L: m.L, actual: m.zone, guess: ses.guesses[m.index] }));
      const score = Z.scorePredictions(rows);
      ses.reveal = { rows, score, dist, sentence: ses.sentence, intent: ses.intent, darkGuess: ses.darkGuess };
      const log = store.get(LOG_KEY, []);
      log.push({
        date: new Date().toISOString(),
        image: S.doc.title,
        intent: ses.intent,
        sentence: ses.sentence,
        darkGuess: ses.darkGuess,
        darkActual: Math.round(dist.analysis.dark * 100),
        markers: score.count,
        mae: score.mae,
        bias: score.bias,
        key: dist.analysis.key,
        range: dist.analysis.range,
      });
      store.set(LOG_KEY, log.slice(-1000));
      ses.overlay = "zones";
      await applyOverlay();
      S.step = "reveal";
    });
  }

  async function exportLog() {
    const log = store.get(LOG_KEY, []);
    if (!log.length) {
      status("Nothing logged yet.");
      return;
    }
    try {
      const lfs = require("uxp").storage.localFileSystem;
      const file = await lfs.getFileForSaving("visualize-first-practice.csv", { types: ["csv"] });
      if (!file) return;
      await file.write(Z.logToCsv(log));
      status("Saved " + file.name + ".");
    } catch (e) {
      status("Couldn't save the file: " + (e.message || e), true);
    }
  }

  function bind() {
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
    const closestData = (e, attr) => {
      let el = e.target;
      while (el && el !== document.body) {
        if (el.getAttribute && el.getAttribute(attr) !== null) return el.getAttribute(attr);
        el = el.parentNode;
      }
      return null;
    };

    on("steps", "click", (e) => {
      const step = closestData(e, "data-step");
      if (step) setStep(step);
    });

    // Visualize
    on("sentence", "input", () => {
      session().sentence = $("sentence").value;
      renderPredict();
    });
    on("intent", "click", (e) => {
      const id = closestData(e, "data-intent");
      if (!id) return;
      session().intent = id;
      renderVisualize();
    });
    on("mono", "change", () => {
      const want = $("mono").checked;
      run(want ? "Monochrome preview…" : "Back to colour…", () => P.setMonochrome(want), { queue: true });
    });
    on("toPredict", "click", () => setStep("predict"));
    on("fresh", "click", () =>
      run("Starting fresh…", async () => {
        const id = S.doc.id;
        const keepMono = session().mono;
        S.sessions[id] = Object.assign(freshSession(), { mono: keepMono });
        await P.resetPrint();
        await P.hideOverlay();
        S.step = "visualize";
      })
    );

    // Predict
    on("markerList", "change", (e) => {
      const idx = e.target.getAttribute && e.target.getAttribute("data-guess");
      if (!idx) return;
      const v = e.target.value;
      if (v === "") delete session().guesses[idx];
      else session().guesses[idx] = Number(v);
      renderPredict();
    });
    on("darkGuess", "input", () => {
      session().darkGuess = Number($("darkGuess").value);
      $("darkGuessVal").textContent = session().darkGuess + "%";
    });
    on("reveal", "click", reveal);
    on("clearMarkers", "click", () =>
      run("Clearing markers…", async () => {
        await P.clearMarkers();
        session().guesses = {};
      })
    );

    // Reveal
    on("revealBody", "click", (e) => {
      const step = closestData(e, "data-goto");
      if (step) setStep(step);
    });

    // Interpret
    on("filter", "change", () => {
      const id = $("filter").value;
      session().filter = id;
      run("Filter…", () => P.setFilter(id), { queue: true });
    });
    on("devs", "click", (e) => {
      const n = closestData(e, "data-dev");
      if (n === null) return;
      const ses = session();
      ses.dev = Number(n);
      ses.placement = null;
      run("Developing…", () => P.setDevelopment({ n: Number(n), scale: scale() }), { queue: true });
    });
    on("placeA", "change", () => (session().placeA = Number($("placeA").value)));
    on("placeB", "change", () => (session().placeB = Number($("placeB").value)));
    on("placeAZone", "change", () => (session().placeAZone = Number($("placeAZone").value)));
    on("placeBZone", "change", () => (session().placeBZone = Number($("placeBZone").value)));
    on("useB", "change", () => {
      session().useB = $("useB").checked;
      renderInterpret();
    });
    on("place", "click", () => {
      const ses = session();
      const a = Number($("placeA").value);
      const placements = [{ index: a, zone: Number($("placeAZone").value) }];
      if (ses.useB) {
        const b = Number($("placeB").value);
        if (b === a) {
          status("Choose two different markers, or untick the second.", true);
          return;
        }
        placements.push({ index: b, zone: Number($("placeBZone").value) });
      }
      run("Placing…", async () => {
        ses.placement = await P.placeMarkers({ placements, scale: scale(), spot: settings.spot });
        ses.dev = null;
      });
    });
    on("burnEdges", "input", () => ($("burnEdgesVal").textContent = $("burnEdges").value + "%"));
    on("burnEdges", "change", () => {
      const v = Number($("burnEdges").value);
      session().burnEdges = v;
      run("Burning the edges…", () => P.setBurnEdges(v), { queue: true });
    });
    on("burnSky", "input", () => ($("burnSkyVal").textContent = $("burnSky").value + "%"));
    const burnSky = () => {
      const ses = session();
      ses.burnSky = Number($("burnSky").value);
      ses.skyDepth = $("skyDepth").value;
      const req = { amount: ses.burnSky, depth: Number(ses.skyDepth) };
      run("Burning the sky…", () => P.setBurnSky(req), { queue: true });
    };
    on("burnSky", "change", burnSky);
    on("skyDepth", "change", () => {
      session().skyDepth = $("skyDepth").value;
      if (session().burnSky > 0) burnSky();
    });
    on("resetPrint", "click", () =>
      run("Neutral print…", async () => {
        await P.resetPrint();
        Object.assign(session(), { filter: "none", dev: 0, placement: null, burnEdges: 0, burnSky: 0 });
      })
    );

    // Opportunities
    on("makeSheet", "click", () =>
      run("Rendering twenty performances… Esc cancels.", async () => {
        S.sheet = await P.makeOpportunitiesSheet({
          thumb: Number($("sheetSize").value),
          includeBurns: $("sheetBurns").checked,
          masses: $("sheetMasses").checked,
          scale: scale(),
        });
        return "The sheet is open as a new document.";
      })
    );
    on("applyVariant", "click", () => {
      if (!S.sheet) return;
      const v = S.sheet.variants[Number($("variant").value)];
      run("Applying…", async () => {
        await P.applyVariant({ filterId: v.filterId, n: v.n, scale: scale(), docId: S.sheet.sourceId });
        S.step = "interpret";
      });
    });

    // Ink
    on("toRGB", "click", () => run("Converting…", () => P.convertToRGB()));
    on("scaleMode", "click", (e) => {
      const mode = closestData(e, "data-scale");
      if (!mode) return;
      settings.scaleMode = mode;
      saveSettings();
      session().inkRead = null;
      render();
      if (session().overlay !== "off") queueOverlay("Updating the overlay…");
    });
    const inkInput = () => {
      const black = Number($("inkBlack").value);
      const white = Number($("inkWhite").value);
      if (!Number.isFinite(black) || !Number.isFinite(white)) return;
      settings.ink = { black, white };
      saveSettings();
      renderInk();
      if (Z.validScale(settings.ink) && session().overlay !== "off") queueOverlay("Updating the overlay…");
    };
    on("inkBlack", "change", inkInput);
    on("inkWhite", "change", inkInput);
    on("calibrate", "click", () =>
      run("Measuring ink and paper…", async () => {
        const m = await P.measureMarkers({ scale: Z.SCREEN_SCALE, spot: settings.spot });
        const ink = m.find((x) => x.index === 1);
        const paper = m.find((x) => x.index === 2);
        if (!ink || !paper) throw new Error("Place marker #1 on solid ink and marker #2 on bare paper first.");
        const next = { black: Math.round(ink.L * 2) / 2, white: Math.round(paper.L * 2) / 2 };
        if (!Z.validScale(next)) throw new Error(`Ink (L* ${next.black}) and paper (L* ${next.white}) are too close to make a scale.`);
        settings.ink = next;
        settings.scaleMode = "ink";
        saveSettings();
        if (session().overlay !== "off") await applyOverlay();
      })
    );
    on("mm", "input", () => {
      session().mm = Number($("mm").value);
      renderInk();
    });
    on("makeOptical", "click", () =>
      run("Blurring a copy… Esc cancels.", async () => {
        const r = await P.makeOpticalAverage({ mm: session().mm });
        return r && r.capped ? `Blurred at ${Math.round(r.radius)} px, the most this panel uses. Lower the merge distance for a finer reading.` : "";
      })
    );
    on("removeOptical", "click", () => run("Removing…", () => P.removeLayer("optical")));
    on("readInk", "click", () =>
      run("Reading markers…", async () => {
        session().inkRead = await P.measureMarkers({ scale: scale(), spot: settings.spot });
      })
    );
    on("addLadder", "click", () => run("Adding the ladder…", () => P.addLadder({ scale: scale() })));
    on("removeLadder", "click", () => run("Removing…", () => P.removeLayer("ladder")));

    // Practice
    on("exportLog", "click", exportLog);
    on("clearLog", "click", () => {
      if (S.clearArmed) {
        clearTimeout(S.clearArmed);
        S.clearArmed = null;
        store.set(LOG_KEY, []);
        status("Practice log cleared.");
      } else {
        S.clearArmed = setTimeout(() => {
          S.clearArmed = null;
          renderPractice();
        }, 4000);
      }
      renderPractice();
    });
    on("training", "change", () => {
      settings.training = $("training").checked;
      saveSettings();
      render();
    });
    on("spot", "change", () => {
      settings.spot = $("spot").value;
      saveSettings();
    });

    // Overlay
    on("overlayModes", "click", (e) => {
      const id = closestData(e, "data-overlay");
      if (!id) return;
      session().overlay = id;
      renderOverlay();
      queueOverlay("Overlay…");
    });
    on("split", "input", () => ($("splitVal").textContent = "Zone " + Z.ROMAN[Number($("split").value)]));
    on("split", "change", () => {
      session().split = Number($("split").value);
      if (session().overlay === "notan") queueOverlay("Overlay…");
    });
    on("opacity", "input", () => ($("opacityVal").textContent = $("opacity").value + "%"));
    on("opacity", "change", () => {
      session().opacity = Number($("opacity").value);
      if (session().overlay !== "off") queueOverlay("Overlay…");
    });
  }

  bind();
  refresh(true);
  // Follow the active document, its markers and its layers.
  setInterval(() => {
    if (!S.busy) refresh(false);
  }, 1000);
})();
