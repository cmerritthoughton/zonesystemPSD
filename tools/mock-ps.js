/* Stand-in for plugin/js/ps.js, for previewing the panel in a browser. */
(function () {
  const Z = window.VFZones;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  window.require = (m) =>
    m === "uxp"
      ? { storage: { localFileSystem: { getFileForSaving: async (name) => ({ name, write: async (t) => (window.__csv = t) }) } } }
      : {};
  const doc = {
    id: 7, title: "tower-study.jpg", width: 3000, height: 2000, resolution: 300, isRGB: true, isGray: false, bits: 8,
    profile: "sRGB IEC61966-2.1", hasGroup: false, groupVisible: false, layers: {},
    markers: [{ index: 1, x: 400, y: 1500 }, { index: 2, x: 2100, y: 300 }, { index: 3, x: 1500, y: 900 }],
  };
  const MARKER_L = { 1: 41.5, 2: 76.2, 3: 55.4 };
  const name = (key, detail) => "VF · " + key + (detail ? " — " + detail : "");
  const put = (key, label, detail, extra) => {
    doc.hasGroup = doc.groupVisible = true;
    doc.layers[key] = Object.assign({ visible: true, opacity: 100 }, doc.layers[key] || {}, { name: name(label, detail) }, extra || {});
  };
  window.__mockDoc = doc;
  window.VFps = {
    docInfo: () => JSON.parse(JSON.stringify(doc)),
    async setOverlay({ mode, opacity }) {
      await delay(30);
      if (mode === "off") { if (doc.layers.overlay) doc.layers.overlay.visible = false; return; }
      put("overlay", "Overlay", Z.OVERLAY_MODES.find((m) => m.id === mode).label, { opacity, visible: true });
    },
    async hideOverlay() { if (doc.layers.overlay) doc.layers.overlay.visible = false; },
    async setMonochrome(on) {
      if (!doc.layers.filter) put("filter", "Filter", "No filter");
      doc.layers.filter.visible = on;
    },
    async setFilter(id) { put("filter", "Filter", Z.filterById(id).label); },
    async setDevelopment({ n }) { put("dev", "Development", Z.devLabel(n)); },
    async placeMarkers({ placements }) {
      const markers = placements.map((p) => ({ index: p.index, zone: p.zone, L: MARKER_L[p.index] }));
      Z.placementPairs(markers);
      put("dev", "Development", markers.map((m) => "#" + m.index + "→" + Z.roman(m.zone)).join(" "));
      return Object.assign(Z.placementSummary(markers), { markers: markers.map((m) => Object.assign({}, m, { from: Z.zoneValue(m.L) })) });
    },
    async setBurnEdges(a) { put("burnEdges", "Burn edges", a + "%", { opacity: a, visible: a > 0 }); },
    async setBurnSky({ amount, depth }) { put("burnSky", "Burn sky", amount + "%, " + Math.round(depth * 100) + "% down", { opacity: amount, visible: amount > 0 }); },
    async resetPrint() {
      if (doc.layers.filter) doc.layers.filter.name = name("Filter", "No filter");
      if (doc.layers.dev) doc.layers.dev.name = name("Development", "N");
      for (const k of ["burnEdges", "burnSky"]) if (doc.layers[k]) doc.layers[k].visible = false;
    },
    async measureMarkers({ scale }) {
      await delay(60);
      return doc.markers.map((m) => Object.assign({}, m, { L: MARKER_L[m.index] || 50, zone: Z.zoneValue(MARKER_L[m.index] || 50, scale) }));
    },
    async selectColorSamplerTool() {
      window.__toolCalls = (window.__toolCalls || 0) + 1;
    },
    async measureDistribution() {
      window.__measureCalls = (window.__measureCalls || 0) + 1;
      const fractions = [0.004, 0.02, 0.06, 0.12, 0.18, 0.22, 0.17, 0.12, 0.07, 0.03, 0.006];
      return { fractions, analysis: Z.analyze(fractions) };
    },
    async makeOpticalAverage({ mm }) {
      await delay(20);
      put("optical", "Optical average", mm.toFixed(1) + " mm");
      const wanted = (mm * doc.resolution) / 25.4;
      return { radius: Math.min(wanted, 64), capped: wanted > 64, bands: 1 };
    },
    async addLadder() { put("ladder", "Zone ladder"); },
    async removeLayer(key) { delete doc.layers[key]; },
    async clearMarkers() { doc.markers = []; },
    async convertToRGB() { doc.isGray = false; doc.isRGB = true; },
    async applyVariant({ filterId, n }) { put("filter", "Filter", Z.filterById(filterId).label); put("dev", "Development", Z.devLabel(n)); },
    async makeOpportunitiesSheet() {
      window.__sheetCalls = (window.__sheetCalls || 0) + 1;
      await delay(120);
      const variants = [];
      for (const f of Z.SHEET_FILTERS) for (const n of Z.SHEET_DEVS) variants.push({ filterId: f, n });
      return { variants, width: 1500, height: 1700, sourceId: doc.id, sourceTitle: doc.title };
    },
  };
})();
