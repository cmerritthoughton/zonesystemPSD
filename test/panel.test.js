// Drives the real panel (index.html + panel.js) in jsdom against the
// Photoshop stand-in in tools/mock-ps.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function loadJsdom() {
  for (const c of ["jsdom", process.env.JSDOM_PATH]) {
    if (!c) continue;
    try {
      return require(c);
    } catch (e) {
      /* try the next one */
    }
  }
  return null;
}

const jsdom = loadJsdom();
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const open = new Set();

function openPanel({ noDoc = false, gray = false, settings = null } = {}) {
  const html = read("plugin/index.html").replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new jsdom.JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window;
  if (settings) w.localStorage.setItem("visualizeFirst.settings.v1", JSON.stringify(settings));
  w.eval(read("plugin/js/zones.js"));
  w.eval(read("tools/mock-ps.js"));
  if (noDoc) w.VFps.docInfo = () => null;
  if (gray) Object.assign(w.__mockDoc, { isGray: true, isRGB: false });
  w.eval(read("plugin/js/panel.js"));
  open.add(w);
  const $ = (id) => w.document.getElementById(id);
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const set = (el, value, type = "change") => {
    el.value = String(value);
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
  };
  const q = (sel) => w.document.querySelector(sel);
  const visible = (step) => q(`section[data-step="${step}"]`).style.display === "block";
  const stepBtn = (step) => q(`#stepper button[data-goto="${step}"]`);
  const primary = (step) => $("primary-" + step);
  const checks = (step) => [...w.document.querySelectorAll(`#check-${step} .check-item`)].map((el) => (el.classList.contains("done") ? "✓ " : "○ ") + el.querySelector(".text").textContent);
  const next = (step) => $("next-" + step).textContent;
  const p = { dom, w, $, q, click, set, visible, stepBtn, primary, checks, next, doc: w.__mockDoc };
  p.close = () => (open.delete(w), w.close());
  // Walk the steps the way an artist would.
  p.visualize = (sentence = "Storm light breaking on the tower, street in rain", key = "full") => {
    set($("sentence"), sentence, "input");
    click(q(`#intent [data-intent="${key}"]`));
  };
  p.toPredict = async () => {
    p.visualize();
    click(primary("visualize"));
    await tick();
  };
  p.toReveal = async (guesses = { 1: 3, 2: 8 }) => {
    await p.toPredict();
    for (const [i, z] of Object.entries(guesses)) set(q(`select[data-guess="${i}"]`), z);
    click(primary("predict"));
    await tick(150);
  };
  return p;
}

test.afterEach(() => {
  // A failed assertion skips close(); the panel's polling would keep Node alive.
  for (const w of open) w.close();
  open.clear();
});

test("guided steps", { skip: jsdom ? false : "jsdom not available" }, async (t) => {
  t.afterEach(() => {
    for (const w of open) w.close();
    open.clear();
  });

  await t.test("opens on step 1 with the sequence, a checklist, a next prompt and a blocked forward action", async () => {
    const p = openPanel();
    assert.match(p.$("docline").textContent, /tower-study\.jpg · RGB 8-bit · 3 markers/);
    assert.deepEqual([...p.w.document.querySelectorAll("#stepper .step .name")].map((n) => n.textContent), ["Visualize", "Predict", "Reveal", "Interpret", "Compare"]);
    assert.ok(p.stepBtn("visualize").classList.contains("current"));
    assert.ok(p.stepBtn("predict").classList.contains("locked"));
    assert.equal(p.$("head-visualize").textContent, "Step 1 of 5");
    assert.deepEqual(p.checks("visualize"), ["○ Write what the print should feel like", "○ Choose the key you want"]);
    assert.match(p.next("visualize"), /^Next: Look at the image in colour/);
    assert.ok(p.primary("visualize").disabled);
    assert.match(p.$("actions-visualize").textContent, /To continue, write a sentence/);
    assert.equal(p.$("overlayBar").style.display, "none", "nothing measured is on screen while looking");
    p.close();
  });

  await t.test("a locked step explains itself instead of opening", async () => {
    const p = openPanel();
    p.click(p.stepBtn("reveal"));
    await tick();
    assert.ok(p.visible("visualize"));
    assert.match(p.$("status").textContent, /Finish step 1 first/);
    p.close();
  });

  await t.test("the checklist ticks itself and unlocks the next step", async () => {
    const p = openPanel();
    p.set(p.$("sentence"), "Late light on the tower", "input");
    assert.deepEqual(p.checks("visualize"), ["✓ Write what the print should feel like", "○ Choose the key you want"]);
    assert.match(p.next("visualize"), /Choose the key/);
    assert.match(p.$("actions-visualize").textContent, /choose the key/);
    p.click(p.q('#intent [data-intent="low"]'));
    assert.deepEqual(p.checks("visualize"), ["✓ Write what the print should feel like", "✓ Choose the key you want"]);
    assert.ok(!p.primary("visualize").disabled);
    p.click(p.primary("visualize"));
    await tick();
    assert.ok(p.visible("predict"));
    assert.equal(p.$("head-predict").textContent, "Step 2 of 5");
    assert.ok(p.stepBtn("visualize").classList.contains("done"));
    assert.equal(p.stepBtn("visualize").querySelector(".dot").textContent, "✓");
    p.close();
  });

  await t.test("predict leads marker by marker, and can pick the Color Sampler tool", async () => {
    const p = openPanel();
    const markers = p.doc.markers.slice();
    p.doc.markers = [];
    await p.toPredict();
    await tick(1100); // polling picks up the empty marker list
    assert.match(p.$("markerList").textContent, /#1Shadow anchor: not placed yet/);
    assert.match(p.next("predict"), /That places marker #1/);
    p.click(p.q('#next-predict button[data-act="pickSampler"]'));
    await tick();
    assert.equal(p.w.__toolCalls, 1);
    assert.match(p.$("status").textContent, /Color Sampler ready/);
    p.doc.markers = markers.slice(0, 1);
    await tick(1100);
    assert.match(p.next("predict"), /That places marker #2/);
    p.doc.markers = markers;
    await tick(1100);
    assert.match(p.next("predict"), /Guess the zone of marker #1/);
    assert.ok(p.primary("predict").disabled);
    assert.match(p.$("actions-predict").textContent, /Guess the zone of at least one marker/);
    p.set(p.q('select[data-guess="1"]'), 3);
    assert.ok(!p.primary("predict").disabled, "one guess is enough to reveal");
    assert.ok(p.checks("predict").includes("○ Guess each marker's zone (1 of 3)"));
    assert.match(p.next("predict"), /Guess the zone of marker #2/);
    p.set(p.q('select[data-guess="2"]'), 8);
    p.set(p.q('select[data-guess="3"]'), 5);
    p.set(p.$("darkGuess"), 35, "input");
    assert.ok(p.checks("predict").includes("✓ Estimate how much of the frame is darkoptional"));
    assert.match(p.next("predict"), /Ready\. Reveal/);
    p.close();
  });

  await t.test("reveal measures, scores, logs, shows the zone map and offers one-click moves", async () => {
    const p = openPanel();
    p.set(p.$("sentence"), "Late light <b>on</b> the tower", "input");
    p.click(p.q('#intent [data-intent="low"]'));
    p.click(p.primary("visualize"));
    await tick();
    p.set(p.q('select[data-guess="1"]'), 3);
    p.set(p.q('select[data-guess="2"]'), 8);
    p.set(p.$("darkGuess"), 35, "input");
    p.click(p.primary("predict"));
    await tick(150);
    assert.ok(p.visible("reveal"));
    assert.ok(p.stepBtn("reveal").classList.contains("current"));
    assert.ok(p.stepBtn("predict").classList.contains("done"));
    const body = p.$("revealBody");
    assert.match(body.innerHTML, /Late light &lt;b&gt;on&lt;\/b&gt; the tower/, "sentence is escaped");
    assert.match(body.textContent, /measured IV \(4\.2\)/);
    assert.match(body.textContent, /read it 1\.2 zones darker/);
    assert.match(body.textContent, /You estimated 35% dark/);
    const tries = [...body.querySelectorAll("button[data-try]")].map((b) => b.textContent);
    assert.ok(tries.includes("Place #1 on Zone III"), tries.join(", "));
    assert.ok(tries.includes("Burn the edges") && tries.includes("Red filter") && tries.includes("Try N+1"), tries.join(", "));
    assert.equal(p.doc.layers.overlay.name, "VF · Overlay — Zones");
    assert.equal(p.$("overlayBar").style.display, "block");
    assert.equal(p.primary("reveal").textContent, "Continue to Interpret →");
    const log = JSON.parse(p.w.localStorage.getItem("visualizeFirst.log.v1"));
    assert.equal(log.length, 1);
    assert.equal(log[0].markers, 2);
    p.close();
  });

  await t.test("a one-click move applies itself and lands in Interpret with a fresh reading", async () => {
    const p = openPanel();
    await p.toReveal();
    const before = p.w.__measureCalls;
    const tryN1 = [...p.$("revealBody").querySelectorAll("button[data-try]")].find((b) => b.textContent === "Try N+1");
    p.click(tryN1);
    await tick(120);
    assert.ok(p.visible("interpret"));
    assert.equal(p.doc.layers.dev.name, "VF · Development — N+1");
    assert.ok(p.w.__measureCalls > before, "the readout re-measures after the move");
    assert.match(p.$("readout").textContent, /Your print now: 38% dark/);
    assert.match(p.$("readout").textContent, /As metered: 38% dark/);
    assert.ok(p.checks("interpret").includes("✓ Place or developoptional"));
    assert.ok(p.stepBtn("interpret").classList.contains("current"));
    p.close();
  });

  await t.test("interpret: filter, development, placement, burning, each followed by a reading", async () => {
    const p = openPanel();
    await p.toReveal();
    p.click(p.primary("reveal"));
    await tick();
    assert.equal(p.$("head-interpret").textContent, "Step 4 of 5");
    assert.equal(p.$("filter").options.length, 7);
    const calls = p.w.__measureCalls;
    p.set(p.$("filter"), "red");
    await tick();
    assert.equal(p.doc.layers.filter.name, "VF · Filter — Red (#25)");
    assert.equal(p.w.__measureCalls, calls + 1);
    assert.ok(p.checks("interpret").includes("✓ Choose a filteroptional"));
    p.click(p.$("devs").querySelector('[data-dev="1"]'));
    await tick();
    assert.equal(p.doc.layers.dev.name, "VF · Development — N+1");
    assert.ok(p.$("devs").querySelector('[data-dev="1"]').classList.contains("on"));
    p.set(p.$("placeA"), 1);
    p.set(p.$("placeAZone"), 3);
    p.set(p.$("placeB"), 2);
    p.set(p.$("placeBZone"), 8);
    p.click(p.$("place"));
    await tick();
    assert.match(p.$("placeResult").textContent, /marker #1 moved −1\.2 zone from IV to III/);
    assert.match(p.$("placeResult").textContent, /expansion, N\+1\.5/);
    p.set(p.$("burnEdges"), 40);
    await tick();
    assert.equal(p.doc.layers.burnEdges.opacity, 40);
    assert.ok(p.checks("interpret").includes("✓ Burn to tasteoptional"));
    p.set(p.$("skyDepth"), "0.6");
    p.set(p.$("burnSky"), 55);
    await tick();
    assert.equal(p.doc.layers.burnSky.name, "VF · Burn sky — 55%, 60% down");
    p.click(p.q('[data-act="resetPrint"]'));
    await tick();
    assert.equal(p.doc.layers.dev.name, "VF · Development — N");
    assert.ok(!p.doc.layers.burnEdges.visible);
    assert.equal(p.primary("interpret").textContent, "Compare 20 performances →");
    p.close();
  });

  await t.test("placing the same marker twice is refused", async () => {
    const p = openPanel();
    await p.toReveal();
    p.click(p.primary("reveal"));
    await tick();
    p.set(p.$("placeA"), 2);
    p.set(p.$("placeB"), 2);
    p.click(p.$("place"));
    await tick();
    assert.match(p.$("status").textContent, /two different markers/);
    p.close();
  });

  await t.test("compare makes the sheet once, offers its versions and applies one", async () => {
    const p = openPanel();
    await p.toReveal();
    p.click(p.stepBtn("compare"));
    await tick();
    assert.equal(p.$("head-compare").textContent, "Step 5 of 5");
    assert.equal(p.primary("compare").textContent, "Make the opportunities sheet");
    p.w.__sheetCalls = 0;
    p.click(p.primary("compare"));
    p.click(p.primary("compare"));
    assert.match(p.$("status").textContent, /Still working/);
    await tick(300);
    assert.equal(p.w.__sheetCalls, 1);
    assert.match(p.$("status").textContent, /Pick a version below/);
    assert.equal(p.$("variantBox").style.display, "block");
    assert.equal(p.$("variant").options.length, 20);
    assert.ok(p.checks("compare")[0].startsWith("✓"));
    assert.equal(p.primary("compare").textContent, "Start a new round");
    p.set(p.$("variant"), 10); // rows are filters, columns N−1…N+2: Red · N+1
    p.click(p.$("applyVariant"));
    await tick();
    assert.equal(p.doc.layers.filter.name, "VF · Filter — Red (#25)");
    assert.equal(p.doc.layers.dev.name, "VF · Development — N+1");
    assert.ok(p.visible("interpret"));
    p.close();
  });

  await t.test("while the sheet is the active document, the panel stays with its source image", async () => {
    const p = openPanel();
    await p.toReveal();
    p.click(p.stepBtn("compare"));
    await tick();
    p.click(p.primary("compare"));
    await tick(300);
    Object.assign(p.doc, { id: 99, title: "Opportunities — tower-study.jpg", markers: [] });
    await tick(1100);
    assert.equal(p.$("docline").textContent, "Opportunities sheet for tower-study.jpg");
    assert.ok(p.visible("compare"));
    assert.equal(p.$("variantBox").style.display, "block");
    assert.ok(!p.stepBtn("compare").classList.contains("locked"));
    p.close();
  });

  await t.test("each image remembers its own step", async () => {
    const p = openPanel();
    await p.toPredict();
    Object.assign(p.doc, { id: 42, title: "other.jpg" });
    await tick(1100);
    assert.ok(p.visible("visualize"), "a new image starts at step 1");
    Object.assign(p.doc, { id: 7, title: "tower-study.jpg" });
    await tick(1100);
    assert.ok(p.visible("predict"), "back to where the first image was");
    p.close();
  });

  await t.test("with training off nothing is locked and reveal needs no commitment", async () => {
    const p = openPanel({ settings: { training: false, welcomed: true } });
    assert.ok(!p.stepBtn("reveal").classList.contains("locked"));
    p.click(p.stepBtn("predict"));
    await tick();
    assert.ok(!p.primary("predict").disabled);
    assert.equal(p.$("overlayBar").style.display, "block");
    p.close();
  });

  await t.test("overlay modes queue the latest request", async () => {
    const p = openPanel();
    await p.toReveal();
    p.click(p.$("overlayModes").querySelector('[data-overlay="notan"]'));
    p.click(p.$("overlayModes").querySelector('[data-overlay="four"]'));
    p.click(p.$("overlayModes").querySelector('[data-overlay="zones"]'));
    assert.match(p.$("status").textContent, /queued/);
    await tick(200);
    assert.equal(p.doc.layers.overlay.name, "VF · Overlay — Zones");
    p.click(p.$("overlayModes").querySelector('[data-overlay="notan"]'));
    await tick();
    assert.equal(p.$("splitRow").style.display, "block");
    assert.equal(p.$("legend").innerHTML, "");
    p.close();
  });

  await t.test("an overlay is hidden again when going back to predict before revealing", async () => {
    const p = openPanel();
    p.visualize();
    p.doc.layers.overlay = { visible: true, opacity: 100, name: "VF · Overlay — Zones" };
    p.doc.hasGroup = true;
    await tick(1100);
    p.click(p.primary("visualize"));
    await tick(80);
    assert.ok(!p.doc.layers.overlay.visible);
    p.close();
  });

  await t.test("ink tool: calibrate, read coverage, blur a copy, then back to the step", async () => {
    const p = openPanel();
    await p.toPredict();
    p.click(p.q('#tools [data-goto="ink"]'));
    await tick();
    assert.ok(p.visible("ink"));
    assert.ok(p.q('#tools [data-goto="ink"]').classList.contains("on"));
    p.click(p.$("calibrate"));
    await tick(150);
    const settings = JSON.parse(p.w.localStorage.getItem("visualizeFirst.settings.v1"));
    assert.deepEqual(settings.ink, { black: 41.5, white: 76 });
    p.click(p.$("readInk"));
    await tick(150);
    assert.match(p.$("inkReadout").textContent, /#1 L\* 41\.5 · Zone 0 \(0\.0\) · about 100% ink/);
    p.doc.resolution = 1200;
    p.set(p.$("mm"), 3, "input");
    p.click(p.$("makeOptical"));
    await tick(120);
    assert.match(p.$("status").textContent, /Blurred at 64 px/);
    const back = p.$("actions-ink").querySelector("button[data-goto]");
    assert.equal(back.textContent, "← Predict");
    p.click(back);
    await tick();
    assert.ok(p.visible("predict"));
    p.close();
  });

  await t.test("grayscale images disable filters and offer RGB", async () => {
    const p = openPanel({ gray: true, settings: { training: false, welcomed: true } });
    p.click(p.q('#tools [data-goto="ink"]'));
    assert.equal(p.$("grayNotice").style.display, "block");
    p.click(p.stepBtn("interpret"));
    await tick();
    assert.ok(p.$("filter").disabled);
    assert.match(p.$("filterNote").textContent, /Grayscale/);
    p.close();
  });

  await t.test("practice log: stats, export, two-click clear, settings, intro again", async () => {
    const p = openPanel({ settings: { welcomed: true } });
    p.w.localStorage.setItem(
      "visualizeFirst.log.v1",
      JSON.stringify([
        { date: "2026-10-01T10:00:00Z", image: "a.jpg", intent: "full", sentence: "one", darkGuess: 40, darkActual: 55, markers: 2, mae: 1.2, bias: 0.6, key: "middle", range: "full" },
        { date: "2026-10-02T10:00:00Z", image: "b.jpg", intent: "low", sentence: "two", darkGuess: 60, darkActual: 64, markers: 3, mae: 0.6, bias: 0.4, key: "low", range: "full" },
      ])
    );
    p.click(p.q('#tools [data-goto="practice"]'));
    assert.match(p.$("logStats").textContent, /2 practice sessions logged/);
    assert.match(p.$("logStats").textContent, /0\.90 zone/);
    p.click(p.$("exportLog"));
    await tick();
    assert.match(p.w.__csv, /^date,image,intent/);
    p.click(p.$("clearLog"));
    assert.equal(p.$("clearLog").textContent, "Click again to clear");
    p.click(p.$("clearLog"));
    assert.equal(JSON.parse(p.w.localStorage.getItem("visualizeFirst.log.v1")).length, 0);
    assert.equal(p.$("welcome").style.display, "none");
    p.click(p.q('[data-act="showWelcome"]'));
    await tick();
    assert.ok(p.visible("visualize"));
    assert.equal(p.$("welcome").style.display, "block");
    p.close();
  });

  await t.test("the introduction shows once", async () => {
    const p = openPanel();
    assert.equal(p.$("welcome").style.display, "block");
    p.click(p.q('#welcome [data-act="welcomeOk"]'));
    assert.equal(p.$("welcome").style.display, "none");
    assert.equal(JSON.parse(p.w.localStorage.getItem("visualizeFirst.settings.v1")).welcomed, true);
    p.close();
  });

  await t.test("with no image open, the panel says what to do", async () => {
    const p = openPanel({ noDoc: true });
    assert.equal(p.$("docline").textContent, "No image open");
    assert.equal(p.$("empty").style.display, "block");
    assert.ok(!p.visible("visualize"));
    assert.ok(p.stepBtn("visualize").title.includes("Open an image first"));
    p.click(p.stepBtn("predict"));
    assert.match(p.$("status").textContent, /Open an image first/);
    p.close();
  });

  await t.test("start a new round clears the round and returns to step 1", async () => {
    const p = openPanel();
    await p.toReveal();
    p.click(p.stepBtn("compare"));
    await tick();
    p.click(p.primary("compare"));
    await tick(300);
    p.click(p.primary("compare")); // now "Start a new round"
    await tick(80);
    assert.ok(p.visible("visualize"));
    assert.equal(p.$("sentence").value, "");
    assert.ok(p.stepBtn("predict").classList.contains("locked"));
    assert.equal(p.$("variantBox").style.display, "none");
    p.close();
  });
});
