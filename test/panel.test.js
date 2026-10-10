// Drives the real panel (index.html + panel.js) in jsdom against the
// Photoshop stand-in in tools/mock-ps.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function loadJsdom() {
  const candidates = ["jsdom", process.env.JSDOM_PATH];
  for (const c of candidates) {
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

function openPanel({ noDoc = false, gray = false } = {}) {
  const html = read("plugin/index.html").replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new jsdom.JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window;
  w.eval(read("plugin/js/zones.js"));
  w.eval(read("tools/mock-ps.js"));
  if (noDoc) w.VFps.docInfo = () => null;
  if (gray) Object.assign(w.__mockDoc, { isGray: true, isRGB: false });
  w.eval(read("plugin/js/panel.js"));
  const $ = (id) => w.document.getElementById(id);
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const set = (el, value, type = "change") => {
    el.value = String(value);
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
  };
  const visible = (step) => w.document.querySelector(`section[data-step="${step}"]`).style.display === "block";
  const stepButton = (step) => w.document.querySelector(`#steps button[data-step="${step}"]`);
  open.add(w);
  return { dom, w, $, click, set, visible, stepButton, doc: w.__mockDoc, close: () => (open.delete(w), w.close()) };
}

test.afterEach(() => {
  // A failed assertion skips close(); the panel's polling would keep Node alive.
  for (const w of open) w.close();
  open.clear();
});

test("panel flows", { skip: jsdom ? false : "jsdom not available" }, async (t) => {
  t.afterEach(() => {
    for (const w of open) w.close();
    open.clear();
  });
  await t.test("opens on Visualize with the image and its markers", async () => {
    const p = openPanel();
    assert.match(p.$("docline").textContent, /tower-study\.jpg · RGB 8-bit · 3 markers/);
    assert.equal(p.w.document.querySelectorAll("#steps button").length, 7);
    assert.ok(p.visible("visualize"));
    assert.equal(p.$("overlayBar").style.display, "none", "no overlay controls while looking");
    p.close();
  });

  await t.test("training mode holds Reveal until a visualization and a guess exist", async () => {
    const p = openPanel();
    p.click(p.stepButton("predict"));
    await tick();
    assert.ok(p.$("reveal").disabled);
    assert.match(p.$("revealGate").textContent, /Write your visualization/);
    p.set(p.$("sentence"), "Storm light breaking on the tower, street in rain", "input");
    assert.ok(p.$("reveal").disabled);
    assert.match(p.$("revealGate").textContent, /Guess the zone/);
    p.set(p.w.document.querySelector('select[data-guess="1"]'), 4);
    assert.ok(!p.$("reveal").disabled);
    p.close();
  });

  await t.test("reveal measures, scores, logs and shows the zone map", async () => {
    const p = openPanel();
    p.set(p.$("sentence"), "Late light <b>on</b> the tower", "input");
    p.click(p.$("intent").querySelector('[data-intent="low"]'));
    p.click(p.stepButton("predict"));
    await tick();
    p.set(p.w.document.querySelector('select[data-guess="1"]'), 3);
    p.set(p.w.document.querySelector('select[data-guess="2"]'), 8);
    p.set(p.$("darkGuess"), 35, "input");
    p.click(p.$("reveal"));
    await tick(150);
    assert.ok(p.visible("reveal"), "moves to Reveal");
    const body = p.$("revealBody").innerHTML;
    assert.match(body, /Late light &lt;b&gt;on&lt;\/b&gt; the tower/, "sentence is escaped");
    assert.match(p.$("revealBody").textContent, /measured IV \(4\.2\)/);
    assert.match(p.$("revealBody").textContent, /read it 1\.2 zones darker/);
    assert.match(p.$("revealBody").textContent, /You estimated 35% dark/);
    assert.match(p.$("revealBody").textContent, /low-key print/, "suggestion responds to the low-key intent");
    assert.equal(p.w.document.querySelectorAll("#revealBody .bar").length, 11);
    assert.equal(p.doc.layers.overlay.name, "VF · Overlay — Zones");
    assert.ok(p.doc.layers.overlay.visible);
    assert.equal(p.$("overlayBar").style.display, "block");
    const log = JSON.parse(p.w.localStorage.getItem("visualizeFirst.log.v1"));
    assert.equal(log.length, 1);
    assert.equal(log[0].markers, 2);
    assert.equal(log[0].darkGuess, 35);
    p.close();
  });

  await t.test("overlay modes, split and legend", async () => {
    const p = openPanel();
    p.click(p.stepButton("reveal"));
    await tick();
    p.click(p.$("overlayModes").querySelector('[data-overlay="notan"]'));
    await tick();
    assert.equal(p.doc.layers.overlay.name, "VF · Overlay — Light / shadow");
    assert.equal(p.$("splitRow").style.display, "block");
    assert.equal(p.$("legend").innerHTML, "");
    p.click(p.$("overlayModes").querySelector('[data-overlay="zones"]'));
    await tick();
    assert.equal(p.w.document.querySelectorAll("#legend span").length, 11);
    p.click(p.$("overlayModes").querySelector('[data-overlay="off"]'));
    await tick();
    assert.ok(!p.doc.layers.overlay.visible);
    p.close();
  });

  await t.test("returning to Predict in training hides an overlay before the reveal", async () => {
    const p = openPanel();
    p.click(p.stepButton("interpret"));
    await tick();
    p.click(p.$("overlayModes").querySelector('[data-overlay="zones"]'));
    await tick();
    assert.ok(p.doc.layers.overlay.visible);
    p.click(p.stepButton("predict"));
    await tick();
    assert.ok(!p.doc.layers.overlay.visible);
    p.close();
  });

  await t.test("interpret: filter, development, placement and burning", async () => {
    const p = openPanel();
    p.click(p.stepButton("interpret"));
    await tick();
    assert.equal(p.$("filter").options.length, 7);
    p.set(p.$("filter"), "red");
    await tick();
    assert.equal(p.doc.layers.filter.name, "VF · Filter — Red (#25)");
    assert.match(p.$("filterNote").textContent, /Dramatic sky/);
    p.click(p.$("devs").querySelector('[data-dev="1"]'));
    await tick();
    assert.equal(p.doc.layers.dev.name, "VF · Development — N+1");
    assert.ok(p.$("devs").querySelector('[data-dev="1"]').classList.contains("on"), "N+1 shows as selected after syncing from the layer");
    p.set(p.$("placeA"), 1);
    p.set(p.$("placeAZone"), 3);
    p.set(p.$("placeB"), 2);
    p.set(p.$("placeBZone"), 8);
    p.click(p.$("place"));
    await tick();
    const words = p.$("placeResult").textContent;
    assert.match(words, /marker #1 moved −1\.2 zone from IV to III/);
    assert.match(words, /expansion, N\+1\.5/);
    assert.match(p.doc.layers.dev.name, /#1→III #2→VIII/);
    assert.ok(!p.$("devs").querySelector(".on"), "no N button is selected after a placement");
    p.set(p.$("burnEdges"), 40);
    await tick();
    assert.equal(p.doc.layers.burnEdges.opacity, 40);
    p.set(p.$("skyDepth"), "0.6");
    p.set(p.$("burnSky"), 55);
    await tick();
    assert.equal(p.doc.layers.burnSky.name, "VF · Burn sky — 55%, 60% down");
    p.click(p.$("resetPrint"));
    await tick();
    assert.equal(p.doc.layers.dev.name, "VF · Development — N");
    assert.ok(!p.doc.layers.burnEdges.visible);
    assert.equal(p.$("burnEdges").value, "0");
    p.close();
  });

  await t.test("placing the same marker twice is refused", async () => {
    const p = openPanel();
    p.click(p.stepButton("interpret"));
    p.set(p.$("placeA"), 2);
    p.set(p.$("placeB"), 2);
    p.click(p.$("place"));
    await tick();
    assert.match(p.$("status").textContent, /two different markers/);
    p.close();
  });

  await t.test("opportunities sheet offers its variants back to the image", async () => {
    const p = openPanel();
    p.click(p.stepButton("opportunities"));
    p.click(p.$("makeSheet"));
    await tick(250);
    assert.equal(p.$("variantBox").style.display, "block");
    assert.equal(p.$("variant").options.length, 20);
    assert.match(p.$("variantLabel").textContent, /tower-study\.jpg/);
    p.set(p.$("variant"), 10); // rows are filters, columns N−1…N+2: Red · N+1
    p.click(p.$("applyVariant"));
    await tick();
    assert.equal(p.doc.layers.filter.name, "VF · Filter — Red (#25)");
    assert.equal(p.doc.layers.dev.name, "VF · Development — N+1");
    assert.ok(p.visible("interpret"));
    p.close();
  });

  await t.test("ink: calibrate from markers, read coverage, blur a copy", async () => {
    const p = openPanel();
    p.click(p.stepButton("ink"));
    p.click(p.$("calibrate"));
    await tick(150);
    const settings = JSON.parse(p.w.localStorage.getItem("visualizeFirst.settings.v1"));
    assert.deepEqual(settings.ink, { black: 41.5, white: 76 });
    assert.equal(settings.scaleMode, "ink");
    assert.equal(p.$("inkScaleRow").style.display, "flex");
    p.click(p.$("readInk"));
    await tick(150);
    assert.match(p.$("inkReadout").textContent, /#1 L\* 41\.5 · Zone 0 \(0\.0\) · about 100% ink/);
    p.set(p.$("mm"), 1.5, "input");
    assert.match(p.$("mmPx").textContent, /About 17\.7 px at 300 ppi/);
    p.click(p.$("makeOptical"));
    await tick();
    assert.equal(p.doc.layers.optical.name, "VF · Optical average — 1.5 mm");
    p.set(p.$("inkWhite"), 50);
    assert.match(p.$("scaleHint").textContent, /at least 20 L\* lighter/);
    p.click(p.$("scaleMode").querySelector('[data-scale="screen"]'));
    assert.equal(p.$("inkScaleRow").style.display, "none");
    p.close();
  });

  await t.test("grayscale images disable filters and offer RGB", async () => {
    const p = openPanel({ gray: true });
    p.click(p.stepButton("ink"));
    assert.equal(p.$("grayNotice").style.display, "block");
    p.click(p.stepButton("interpret"));
    assert.ok(p.$("filter").disabled);
    assert.match(p.$("filterNote").textContent, /Grayscale/);
    p.close();
  });

  await t.test("practice log: stats, export, two-click clear, settings", async () => {
    const p = openPanel();
    p.w.localStorage.setItem(
      "visualizeFirst.log.v1",
      JSON.stringify([
        { date: "2026-10-01T10:00:00Z", image: "a.jpg", intent: "full", sentence: "one", darkGuess: 40, darkActual: 55, markers: 2, mae: 1.2, bias: 0.6, key: "middle", range: "full" },
        { date: "2026-10-02T10:00:00Z", image: "b.jpg", intent: "low", sentence: "two", darkGuess: 60, darkActual: 64, markers: 3, mae: 0.6, bias: 0.4, key: "low", range: "full" },
      ])
    );
    p.click(p.stepButton("practice"));
    assert.match(p.$("logStats").textContent, /2 practice sessions logged/);
    assert.match(p.$("logStats").textContent, /0\.90 zone/);
    assert.match(p.$("logStats").textContent, /0\.5 zone lighter/);
    assert.equal(p.w.document.querySelectorAll("#logList .entry").length, 2);
    p.click(p.$("exportLog"));
    await tick();
    assert.match(p.w.__csv, /^date,image,intent/);
    p.click(p.$("clearLog"));
    assert.equal(p.$("clearLog").textContent, "Click again to clear");
    assert.equal(JSON.parse(p.w.localStorage.getItem("visualizeFirst.log.v1")).length, 2);
    p.click(p.$("clearLog"));
    assert.equal(JSON.parse(p.w.localStorage.getItem("visualizeFirst.log.v1")).length, 0);
    p.$("training").checked = false;
    p.$("training").dispatchEvent(new p.w.Event("change"));
    p.click(p.stepButton("predict"));
    assert.ok(!p.$("reveal").disabled, "free mode reveals without commitments");
    assert.equal(p.$("overlayBar").style.display, "block");
    p.close();
  });

  await t.test("with no image open, actions explain themselves", async () => {
    const p = openPanel({ noDoc: true });
    assert.equal(p.$("docline").textContent, "No image open");
    p.click(p.stepButton("interpret"));
    p.click(p.$("devs").querySelector('[data-dev="1"]'));
    await tick();
    assert.match(p.$("status").textContent, /Open an image first/);
    p.close();
  });

  await t.test("rapid setting changes queue the latest instead of dropping it", async () => {
    const p = openPanel();
    p.click(p.stepButton("reveal"));
    await tick();
    p.click(p.$("overlayModes").querySelector('[data-overlay="notan"]'));
    p.click(p.$("overlayModes").querySelector('[data-overlay="four"]'));
    p.click(p.$("overlayModes").querySelector('[data-overlay="zones"]'));
    assert.match(p.$("status").textContent, /queued/);
    await tick(200);
    assert.equal(p.doc.layers.overlay.name, "VF · Overlay — Zones", "the last request wins");
    assert.ok(p.$("overlayModes").querySelector('[data-overlay="zones"]').classList.contains("on"));
    p.close();
  });

  await t.test("a double click can't start a heavy operation twice", async () => {
    const p = openPanel();
    p.w.__sheetCalls = 0;
    p.click(p.stepButton("opportunities"));
    p.click(p.$("makeSheet"));
    p.click(p.$("makeSheet"));
    assert.match(p.$("status").textContent, /Still working/);
    await tick(300);
    assert.equal(p.w.__sheetCalls, 1);
    assert.equal(p.$("status").textContent, "The sheet is open as a new document.", "the finishing message survives");
    p.close();
  });

  await t.test("a capped blur says so", async () => {
    const p = openPanel();
    p.doc.resolution = 1200;
    p.click(p.stepButton("ink"));
    p.set(p.$("mm"), 3, "input");
    p.click(p.$("makeOptical"));
    await tick(120);
    assert.match(p.$("status").textContent, /Blurred at 64 px, the most this panel uses/);
    p.close();
  });

  await t.test("new markers appear without a manual refresh", async () => {
    const p = openPanel();
    p.click(p.stepButton("predict"));
    p.doc.markers.push({ index: 4, x: 10, y: 10 });
    await tick(1150);
    assert.ok(p.w.document.querySelector('select[data-guess="4"]'), "marker #4 picked up by polling");
    assert.match(p.$("docline").textContent, /4 markers/);
    p.close();
  });
});
