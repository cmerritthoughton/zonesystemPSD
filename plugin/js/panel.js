/*
 * Visualize First — panel.
 *
 * A guided sequence of five steps: visualize (write the print you want) →
 * predict (mark tones, guess zones) → reveal (measure, compare, choose a
 * move) → interpret (filter, place, develop, burn) → compare (twenty
 * performances at once). Every step has a self-ticking checklist, a "Next"
 * prompt, and forward/back actions that say what is still missing. Ink and
 * Practice sit beside the sequence as tools.
 */
(function () {
  "use strict";
  const Z = window.VFZones;
  const P = window.VFps;
  const $ = (id) => document.getElementById(id);

  const FLOW = [
    { id: "visualize", label: "Visualize" },
    { id: "predict", label: "Predict" },
    { id: "reveal", label: "Reveal" },
    { id: "interpret", label: "Interpret" },
    { id: "compare", label: "Compare" },
  ];
  const TOOLS = { ink: "Ink", practice: "Practice & settings" };
  const flowIndex = (id) => FLOW.findIndex((s) => s.id === id);
  const isFlow = (id) => flowIndex(id) >= 0;
  const labelOf = (id) => (isFlow(id) ? FLOW[flowIndex(id)].label : TOOLS[id]);
  const SHEET_PREFIX = "Opportunities — ";
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

  const settings = Object.assign({ training: true, spot: "spot", scaleMode: "screen", ink: { black: 15, white: 94 }, welcomed: false }, store.get(SETTINGS_KEY, {}));
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  const S = { step: "visualize", lastFlow: "visualize", doc: null, docKey: null, sessions: {}, busy: false, pending: null, sig: "", markerSig: "", sheet: null, moves: [], clearArmed: null };

  const freshSession = () => ({
    step: "visualize",
    sentence: "",
    intent: null,
    darkGuess: 50,
    darkTouched: false,
    guesses: {},
    reveal: null,
    now: null,
    did: { filter: false, develop: false, burn: false },
    interpreted: false,
    applied: false,
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

  // The opportunities sheet belongs to the image it was made from: while it
  // is the active document, the panel keeps working on that image's session.
  const onSheet = () => !!(S.doc && S.sheet && S.doc.title === SHEET_PREFIX + S.sheet.sourceTitle);
  const sessionKey = () => (onSheet() ? S.sheet.sourceId : S.doc ? S.doc.id : "none");
  function session() {
    const id = sessionKey();
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
  const roleHint = (index) => (index === 1 ? "the darkest shadow that must keep its texture" : index === 2 ? "the brightest light that must keep its texture" : "");
  const zoneOptions = (selected, blank) =>
    (blank ? `<option value="">Your guess…</option>` : "") +
    Z.ROMAN.map((r, k) => `<option value="${k}"${selected === k ? " selected" : ""}>${r} · ${Z.ZONES[k].meaning}</option>`).join("");
  const markerOptions = (selected) => {
    const ms = S.doc ? S.doc.markers : [];
    if (!ms.length) return `<option value="">No markers yet</option>`;
    return ms.map((m) => `<option value="${m.index}"${m.index === selected ? " selected" : ""}>#${m.index}</option>`).join("");
  };
  const isFocused = (el) => document.activeElement === el;
  const bars = (fr, mini) => {
    const maxF = Math.max.apply(null, fr) || 1;
    const h = mini ? 40 : 80;
    return (
      `<div class="bars${mini ? " mini" : ""}">` +
      fr.map((f, k) => `<div class="bar" title="Zone ${Z.ROMAN[k]}: ${pct(f)}" style="height: ${Math.max(2, Math.round((f / maxF) * h))}px; background: rgb(${Z.ZONE_COLORS[k].join(",")})"></div>`).join("") +
      `</div><div class="barlabels">` +
      fr.map((f, k) => `<span>${Z.ROMAN[k]}${mini ? "" : `<br/>${f >= 0.005 ? Math.round(f * 100) : "·"}`}</span>`).join("") +
      `</div>`
    );
  };
  const readingLine = (a) => `${pct(a.dark)} dark · ${Z.RANGE_LABEL[a.range].toLowerCase()} · textured lights ${pct(a.texturedLight)}`;

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

  // A change to the print: apply it, then read the zones it produces so the
  // "Your print now" readout follows every move.
  function runPrint(label, op, kind) {
    const ses = session();
    run(
      label,
      async () => {
        await op();
        ses.interpreted = true;
        if (kind) ses.did[kind] = true;
        ses.now = await P.measureDistribution({ scale: scale() });
      },
      { queue: true }
    );
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
    // A different image: pick up where that image left off.
    const key = sessionKey();
    if (key !== S.docKey) {
      S.docKey = key;
      if (isFlow(S.step)) S.step = onSheet() ? "compare" : session().step;
    }
    if (info && !onSheet()) syncFromLayers(session(), info);
    render();
  }

  // ---- The guide: progress, locks, checklists, next actions ------------------------

  function progress() {
    const ses = session();
    const markers = S.doc && !onSheet() ? S.doc.markers : [];
    const guessed = markers.filter((m) => Number.isFinite(ses.guesses[m.index])).length;
    const p = {
      wrote: ses.sentence.trim().length >= 10,
      keyChosen: !!ses.intent,
      markers: markers.length,
      marker1: markers.some((m) => m.index === 1),
      marker2: markers.some((m) => m.index === 2),
      guessed,
      unguessed: markers.find((m) => !Number.isFinite(ses.guesses[m.index])) || null,
      darkTouched: ses.darkTouched,
      revealed: !!ses.reveal,
      interpreted: ses.interpreted,
      sheet: !!(S.sheet && S.sheet.sourceId === sessionKey()),
    };
    p.visualized = p.wrote && p.keyChosen;
    p.predicted = p.markers > 0 && p.guessed > 0;
    return p;
  }

  const DONE = {
    visualize: (p) => p.visualized,
    predict: (p) => p.predicted || p.revealed,
    reveal: (p) => p.revealed,
    interpret: (p) => p.interpreted,
    compare: (p) => p.sheet,
  };

  function lockReason(id, p) {
    if (!S.doc) return "Open an image first.";
    if (!settings.training) return null;
    const step1 = "Finish step 1 first: write your sentence and choose a key.";
    if (id === "predict" && !p.visualized && !p.revealed) return step1;
    if (id === "reveal" && !p.revealed && !(p.visualized && p.predicted)) return p.visualized ? "Finish step 2 first: place a marker and guess its zone." : step1;
    if ((id === "interpret" || id === "compare") && !p.revealed) return "Reveal the meter readings first (step 3).";
    return null;
  }

  function revealBlocked(p) {
    if (!settings.training) return S.doc && !onSheet() ? null : "Open the image you're working on.";
    if (!p.visualized) return "Finish step 1 first: write your sentence and choose a key.";
    if (!p.markers) return "Place at least one marker on the image.";
    if (!p.guessed) return "Guess the zone of at least one marker.";
    return null;
  }

  function checklist(id, p) {
    const ses = session();
    switch (id) {
      case "visualize":
        return [
          { text: "Write what the print should feel like", done: p.wrote },
          { text: "Choose the key you want", done: p.keyChosen },
        ];
      case "predict":
        return [
          { text: "Place #1 on the darkest shadow that must keep its texture", done: p.marker1 },
          { text: "Place #2 on the brightest light that must keep its texture", done: p.marker2, optional: true },
          { text: p.markers ? `Guess each marker's zone (${p.guessed} of ${p.markers})` : "Guess each marker's zone", done: p.markers > 0 && p.guessed === p.markers },
          { text: "Estimate how much of the frame is dark", done: p.darkTouched, optional: true },
        ];
      case "reveal":
        return [
          { text: "Reveal the meter readings", done: p.revealed },
          { text: "Try a move toward your print", done: p.interpreted, optional: true },
        ];
      case "interpret":
        return [
          { text: "Choose a filter", done: ses.did.filter, optional: true },
          { text: "Place or develop", done: ses.did.develop, optional: true },
          { text: "Burn to taste", done: ses.did.burn, optional: true },
        ];
      case "compare":
        return [
          { text: "Make the opportunities sheet", done: p.sheet },
          { text: "Apply the version you like", done: ses.applied, optional: true },
        ];
      default:
        return [];
    }
  }

  // The single next thing to do, and a button when the panel can do it.
  function nextFor(id, p) {
    const pick = { label: "Pick the Color Sampler tool", act: "pickSampler" };
    switch (id) {
      case "visualize":
        if (!p.wrote) return { text: "Look at the image in colour, then write one sentence: what is the light doing, and how should it feel?" };
        if (!p.keyChosen) return { text: "Choose the key of the print you want: low key, full scale or high key." };
        return { text: "Ready. Continue to Predict." };
      case "predict":
        if (!p.marker1) return { text: "Pick the Color Sampler tool, then click the darkest shadow that must still show texture. That places marker #1.", action: pick };
        if (!p.marker2) return { text: "Now click the brightest light that must still show texture. That places marker #2.", action: pick };
        if (p.unguessed) return { text: `Guess the zone of marker #${p.unguessed.index} from the menu below.` };
        if (!p.darkTouched) return { text: "Estimate how much of the frame is dark (Zones 0–IV) with the slider." };
        return { text: "Ready. Reveal the meter readings." };
      case "reveal":
        if (!p.revealed) return revealBlocked(p) ? { text: revealBlocked(p) } : { text: "Reveal the meter readings when you're ready." };
        return { text: "See where you missed, then try one of the moves below. It applies the change and takes you to Interpret." };
      case "interpret":
        if (!p.interpreted) return { text: "Start with the filter, then exposure and development, then burning. The readout shows how each change moves the zones." };
        return { text: "When the readout matches your sentence, compare twenty alternatives." };
      case "compare":
        if (!p.sheet) return { text: "Make the sheet. It opens as a new document; stay on this step to apply a version." };
        if (!session().applied) return { text: "Pick the version closest to your sentence and apply it, or start a new round." };
        return { text: "Done. Start a new round with this image, or open another one." };
      default:
        return null;
    }
  }

  function actionsFor(id, p) {
    const back = (to) => ({ label: labelOf(to), goto: to });
    switch (id) {
      case "visualize": {
        const blocked = settings.training && !p.visualized ? (!p.wrote ? "To continue, write a sentence about the print." : "To continue, choose the key you want.") : null;
        const started = p.wrote || p.guessed > 0 || p.revealed;
        return { back: null, primary: { label: "Continue to Predict →", goto: "predict", blocked }, extra: started ? { label: "Start a new round", act: "startOver" } : null };
      }
      case "predict":
        return { back: back("visualize"), primary: { label: "Reveal the meter readings →", act: "reveal", blocked: revealBlocked(p) } };
      case "reveal":
        return p.revealed
          ? { back: back("predict"), primary: { label: "Continue to Interpret →", goto: "interpret" } }
          : { back: back("predict"), primary: { label: "Reveal the meter readings →", act: "reveal", blocked: revealBlocked(p) } };
      case "interpret":
        return { back: back("reveal"), primary: { label: "Compare 20 performances →", goto: "compare" } };
      case "compare":
        return p.sheet
          ? { back: back("interpret"), primary: { label: "Start a new round", act: "startOver" } }
          : { back: back("interpret"), primary: { label: "Make the opportunities sheet", act: "makeSheet" } };
      default:
        return { back: back(S.lastFlow), primary: null };
    }
  }

  // ---- Rendering ----------------------------------------------------------------------

  function render() {
    const p = progress();
    renderHeader(p);
    renderGuide(p);
    renderVisualize();
    renderPredict();
    renderReveal(p);
    renderInterpret();
    renderCompare();
    renderInk();
    renderPractice();
    renderOverlay(p);
  }

  function renderHeader(p) {
    const d = S.doc;
    $("docline").textContent = !d
      ? "No image open"
      : onSheet()
        ? `Opportunities sheet for ${S.sheet.sourceTitle}`
        : `${d.title} · ${d.isGray ? "Grayscale" : "RGB"} ${d.bits}-bit · ${d.markers.length} marker${d.markers.length === 1 ? "" : "s"}`;
    $("stepper").innerHTML = FLOW.map((s, i) => {
      const current = S.step === s.id;
      const done = DONE[s.id](p);
      const reason = lockReason(s.id, p);
      const cls = ["step", current ? "current" : done ? "done" : "", reason && !current ? "locked" : ""].filter(Boolean).join(" ");
      const rail = i ? `<div class="rail${DONE[FLOW[i - 1].id](p) ? " done" : ""}"></div>` : "";
      return `${rail}<button class="${cls}" data-goto="${s.id}" title="${esc(reason || "Step " + (i + 1) + ": " + s.label)}"><span class="dot">${done && !current ? "✓" : i + 1}</span><span class="name">${s.label}</span></button>`;
    }).join("");
    document.querySelectorAll("#tools button[data-goto]").forEach((b) => b.classList.toggle("on", b.getAttribute("data-goto") === S.step));
    const noImage = !d && isFlow(S.step);
    $("empty").style.display = noImage ? "block" : "none";
    $("welcome").style.display = !noImage && !settings.welcomed && S.step === "visualize" ? "block" : "none";
    document.querySelectorAll("section[data-step]").forEach((sec) => {
      sec.style.display = !noImage && sec.getAttribute("data-step") === S.step ? "block" : "none";
    });
  }

  function renderGuide(p) {
    const id = S.step;
    if (isFlow(id)) {
      $("head-" + id).textContent = `Step ${flowIndex(id) + 1} of ${FLOW.length}`;
      $("check-" + id).innerHTML = checklist(id, p)
        .map(
          (it) =>
            `<div class="check-item${it.done ? " done" : ""}"><span class="mark">${it.done ? "✓" : "○"}</span><span class="text">${esc(it.text)}${it.optional ? '<span class="opt">optional</span>' : ""}</span></div>`
        )
        .join("");
      const next = nextFor(id, p);
      $("next-" + id).innerHTML = next ? `<b>Next:</b> ${esc(next.text)}${next.action ? `<br/><button class="cta" data-act="${next.action.act}">${esc(next.action.label)}</button>` : ""}` : "";
    }
    const a = actionsFor(id, p);
    const el = $("actions-" + id);
    if (!el) return;
    const back = a.back ? `<button data-goto="${a.back.goto}">← ${esc(a.back.label)}</button>` : a.extra ? `<button class="link" data-act="${a.extra.act}">${esc(a.extra.label)}</button>` : "<span></span>";
    const primary = a.primary
      ? `<button class="cta" id="primary-${id}" ${a.primary.goto ? `data-goto="${a.primary.goto}"` : `data-act="${a.primary.act}"`}${a.primary.blocked ? " disabled" : ""}>${esc(a.primary.label)}</button>`
      : "";
    el.innerHTML = `<div class="row">${back}${primary}</div>${a.primary && a.primary.blocked ? `<p class="blocked">${esc(a.primary.blocked)}</p>` : ""}`;
  }

  function renderVisualize() {
    const ses = session();
    if (!isFocused($("sentence"))) $("sentence").value = ses.sentence;
    $("intent").innerHTML = Z.INTENTS.map((i) => `<button data-intent="${i.id}" class="${ses.intent === i.id ? "on" : ""}">${i.label}</button>`).join("");
    $("intentHint").textContent = ses.intent ? (Z.INTENTS.find((i) => i.id === ses.intent) || {}).hint : "Pick one; the advice after Reveal depends on it.";
    $("mono").checked = ses.mono;
    $("mono").disabled = !!(S.doc && S.doc.isGray);
  }

  function renderPredict() {
    const ses = session();
    const ms = S.doc && !onSheet() ? S.doc.markers : [];
    const msig = sessionKey() + JSON.stringify(ms.map((m) => m.index));
    if (msig !== S.markerSig || !$("markerList").innerHTML) {
      S.markerSig = msig;
      const byIndex = {};
      ms.forEach((m) => (byIndex[m.index] = m));
      const last = Math.max(2, ...ms.map((m) => m.index));
      const rows = [];
      for (let i = 1; i <= last; i++) {
        const m = byIndex[i];
        if (m) {
          rows.push(`<div class="mrow"><b>#${i}</b><span class="grow role">${roleOf(i)}</span><select data-guess="${i}">${zoneOptions(ses.guesses[i], true)}</select></div>`);
        } else if (i <= 2) {
          rows.push(`<div class="mrow"><b>#${i}</b><span class="grow slot-empty">${roleOf(i)}: not placed yet. Click ${roleHint(i)}.</span></div>`);
        }
      }
      $("markerList").innerHTML = rows.join("");
    }
    if (!isFocused($("darkGuess"))) $("darkGuess").value = ses.darkGuess;
    $("darkGuessVal").textContent = ses.darkGuess + "%";
  }

  function errorWords(e) {
    if (Math.abs(e) <= 0.25) return "spot on";
    return `you read it ${Math.abs(e).toFixed(1)} zone${Math.abs(e) >= 1.05 ? "s" : ""} ${e > 0 ? "lighter" : "darker"}`;
  }

  function renderReveal(p) {
    const ses = session();
    const body = $("revealBody");
    if (!ses.reveal) {
      S.moves = [];
      body.innerHTML = `<p class="hint">Nothing has been measured yet. Your markers and the whole frame are read when you reveal.</p>`;
      return;
    }
    const r = ses.reveal;
    const a = r.dist.analysis;
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
    const shadow = r.rows.find((x) => x.index === 1);
    S.moves = Z.moves(r.intent, a, { shadowZone: shadow ? shadow.actual : null, rgb: !!(S.doc && S.doc.isRGB) });
    const moves = S.moves
      .map(
        (m, i) =>
          `<div class="move"><div>${esc(m.text)}</div>${m.tries.map((t, j) => `<button data-try="${i}-${j}">${esc(t.label)}</button>`).join("")}</div>`
      )
      .join("");
    body.innerHTML = `
      <div class="quote">“${esc(r.sentence)}”</div>
      <p class="hint small">You wanted: ${intent.label}.</p>
      <h3>Your markers</h3>
      ${rows || `<p class="hint">No markers were measured.</p>`}
      ${summary}
      <h3>The whole frame</h3>
      <p>You estimated ${r.darkGuess}% dark; it measures ${pct(a.dark)} (Zones 0–IV).</p>
      ${bars(r.dist.fractions, false)}
      <p><b>${Z.KEY_LABEL[a.key]}</b> · ${Z.RANGE_LABEL[a.range]}</p>
      <p class="hint small">Textured darks (II–III) ${pct(a.texturedDark)} · textured lights (VII–VIII) ${pct(a.texturedLight)} · middle (IV–VI) ${pct(a.middle)} · no texture (0–I, IX–X) ${pct(a.dead)}</p>
      <h3>Moves toward your print</h3>
      ${moves}`;
  }

  function renderReadout() {
    const ses = session();
    const base = ses.reveal ? ses.reveal.dist : null;
    if (!ses.now) {
      $("readout").innerHTML = `<p class="hint">Your print's zones appear here after each change.</p>`;
      return;
    }
    $("readout").innerHTML = `<p><b>Your print now:</b> ${readingLine(ses.now.analysis)}</p>${bars(ses.now.fractions, true)}${
      base ? `<p class="hint small">As metered: ${readingLine(base.analysis)}</p>` : ""
    }`;
  }

  function renderInterpret() {
    const ses = session();
    const rgb = !!(S.doc && S.doc.isRGB);
    renderReadout();
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

  function renderCompare() {
    const box = $("variantBox");
    if (!S.sheet || S.sheet.sourceId !== sessionKey()) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    $("variantLabel").textContent = `Apply a version to ${S.sheet.sourceTitle}`;
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

  function renderOverlay(p) {
    const ses = session();
    const seeing = ["reveal", "interpret", "compare", "ink"].includes(S.step) && (p.revealed || !settings.training || S.step === "ink");
    $("overlayBar").style.display = S.doc && (seeing || (!settings.training && S.step !== "practice")) ? "block" : "none";
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

  // ---- Navigation and actions -------------------------------------------------------------

  async function setStep(step) {
    S.step = step;
    if (isFlow(step)) {
      S.lastFlow = step;
      session().step = step;
    }
    render();
    const ses = session();
    // In training, nothing measured may be on screen while you look and guess.
    if (settings.training && (step === "visualize" || step === "predict") && ses.overlay !== "off" && !ses.reveal) {
      await run("Hiding the overlay…", () => P.hideOverlay());
    }
    // Interpret opens with a reading of the print as it stands.
    if (step === "interpret" && S.doc && !onSheet() && !ses.now) {
      await run("Reading your print…", async () => {
        ses.now = await P.measureDistribution({ scale: scale() });
      });
    }
  }

  function navigate(id) {
    if (isFlow(id)) {
      const reason = lockReason(id, progress());
      if (reason) {
        status(reason);
        return;
      }
    }
    setStep(id);
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
      ses.reveal = { rows, score, dist, sentence: ses.sentence, intent: ses.intent || "full", darkGuess: ses.darkGuess };
      ses.now = dist;
      const log = store.get(LOG_KEY, []);
      log.push({
        date: new Date().toISOString(),
        image: S.doc.title,
        intent: ses.intent || "full",
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
      ses.step = "reveal";
    });
  }

  // A one-click move from the Reveal step: apply it, then show Interpret.
  function applyTry(ref) {
    const [i, j] = ref.split("-").map(Number);
    const move = S.moves[i];
    const t = move && move.tries[j];
    if (!t) return;
    const a = t.action;
    const ses = session();
    if (a.type === "goto") {
      navigate(a.step);
      return;
    }
    if (a.type === "place") {
      Object.assign(ses, { placeA: a.index, placeAZone: a.zone, useB: false });
      runPrint(t.label + "…", async () => {
        ses.placement = await P.placeMarkers({ placements: [{ index: a.index, zone: a.zone }], scale: scale(), spot: settings.spot });
        ses.dev = null;
      }, "develop");
    } else if (a.type === "dev") {
      ses.dev = a.n;
      ses.placement = null;
      runPrint(t.label + "…", () => P.setDevelopment({ n: a.n, scale: scale() }), "develop");
    } else if (a.type === "filter") {
      ses.filter = a.id;
      runPrint(t.label + "…", () => P.setFilter(a.id), "filter");
    } else if (a.type === "burnEdges") {
      ses.burnEdges = a.amount;
      runPrint(t.label + "…", () => P.setBurnEdges(a.amount), "burn");
    }
    S.step = "interpret";
    S.lastFlow = "interpret";
    ses.step = "interpret";
    render();
  }

  function startOver() {
    run("Starting a new round…", async () => {
      const key = sessionKey();
      const keepMono = session().mono;
      S.sessions[key] = Object.assign(freshSession(), { mono: keepMono });
      if (S.sheet && S.sheet.sourceId === key) S.sheet = null;
      await P.resetPrint();
      await P.hideOverlay();
      S.step = "visualize";
      S.lastFlow = "visualize";
    });
  }

  function makeSheet() {
    run("Rendering twenty performances… Esc cancels.", async () => {
      S.sheet = await P.makeOpportunitiesSheet({
        thumb: Number($("sheetSize").value),
        includeBurns: $("sheetBurns").checked,
        masses: $("sheetMasses").checked,
        scale: scale(),
      });
      S.step = "compare";
      session().step = "compare";
      return "The sheet is open as a new document. Pick a version below to apply it.";
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

  const ACTS = {
    welcomeOk: () => {
      settings.welcomed = true;
      saveSettings();
      render();
    },
    showWelcome: () => {
      settings.welcomed = false;
      saveSettings();
      navigate("visualize");
    },
    pickSampler: () => run("Picking the Color Sampler tool…", async () => {
      await P.selectColorSamplerTool();
      return "Color Sampler ready: click the image to place a marker.";
    }),
    clearMarkers: () =>
      run("Removing markers…", async () => {
        await P.clearMarkers();
        session().guesses = {};
      }),
    reveal,
    startOver,
    makeSheet,
    resetPrint: () =>
      runPrint("Back to the neutral print…", async () => {
        await P.resetPrint();
        Object.assign(session(), { filter: "none", dev: 0, placement: null, burnEdges: 0, burnSky: 0 });
      }),
  };

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

    // Navigation, named actions and one-click moves, from anywhere.
    document.body.addEventListener("click", (e) => {
      const goto = closestData(e, "data-goto");
      if (goto) return navigate(goto);
      const act = closestData(e, "data-act");
      if (act && ACTS[act]) return ACTS[act]();
      const tryRef = closestData(e, "data-try");
      if (tryRef) return applyTry(tryRef);
    });

    // Visualize
    on("sentence", "input", () => {
      session().sentence = $("sentence").value;
      const p = progress();
      renderHeader(p);
      renderGuide(p);
    });
    on("intent", "click", (e) => {
      const id = closestData(e, "data-intent");
      if (!id) return;
      session().intent = id;
      render();
    });
    on("mono", "change", () => {
      const want = $("mono").checked;
      run(want ? "Monochrome preview…" : "Back to colour…", () => P.setMonochrome(want), { queue: true });
    });

    // Predict
    on("markerList", "change", (e) => {
      const idx = e.target.getAttribute && e.target.getAttribute("data-guess");
      if (!idx) return;
      const v = e.target.value;
      if (v === "") delete session().guesses[idx];
      else session().guesses[idx] = Number(v);
      const p = progress();
      renderHeader(p);
      renderGuide(p);
    });
    on("darkGuess", "input", () => {
      const ses = session();
      ses.darkGuess = Number($("darkGuess").value);
      ses.darkTouched = true;
      $("darkGuessVal").textContent = ses.darkGuess + "%";
      renderGuide(progress());
    });

    // Interpret
    on("filter", "change", () => {
      const id = $("filter").value;
      session().filter = id;
      runPrint("Filter…", () => P.setFilter(id), "filter");
    });
    on("devs", "click", (e) => {
      const n = closestData(e, "data-dev");
      if (n === null) return;
      const ses = session();
      ses.dev = Number(n);
      ses.placement = null;
      runPrint("Developing…", () => P.setDevelopment({ n: Number(n), scale: scale() }), "develop");
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
      runPrint("Placing…", async () => {
        ses.placement = await P.placeMarkers({ placements, scale: scale(), spot: settings.spot });
        ses.dev = null;
      }, "develop");
    });
    on("burnEdges", "input", () => ($("burnEdgesVal").textContent = $("burnEdges").value + "%"));
    on("burnEdges", "change", () => {
      const v = Number($("burnEdges").value);
      session().burnEdges = v;
      runPrint("Burning the edges…", () => P.setBurnEdges(v), "burn");
    });
    on("burnSky", "input", () => ($("burnSkyVal").textContent = $("burnSky").value + "%"));
    const burnSky = () => {
      const ses = session();
      ses.burnSky = Number($("burnSky").value);
      ses.skyDepth = $("skyDepth").value;
      const req = { amount: ses.burnSky, depth: Number(ses.skyDepth) };
      runPrint("Burning the sky…", () => P.setBurnSky(req), "burn");
    };
    on("burnSky", "change", burnSky);
    on("skyDepth", "change", () => {
      session().skyDepth = $("skyDepth").value;
      if (session().burnSky > 0) burnSky();
    });

    // Compare
    on("applyVariant", "click", () => {
      if (!S.sheet) return;
      const v = S.sheet.variants[Number($("variant").value)];
      const ses = session();
      runPrint("Applying…", async () => {
        await P.applyVariant({ filterId: v.filterId, n: v.n, scale: scale(), docId: S.sheet.sourceId });
        ses.applied = true;
        ses.filter = v.filterId;
        ses.step = "interpret";
        S.step = "interpret";
        S.lastFlow = "interpret";
      }, "develop");
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
      renderOverlay(progress());
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
