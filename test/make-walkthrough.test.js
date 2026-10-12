// Runs tools/make-walkthrough.sh against a stand-in for Photoshop: fake
// `osascript` and `open` commands on PATH that answer each host step and log
// what the script asked for. No Photoshop needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const script = path.join(root, "tools/make-walkthrough.sh");
const realMeasurements = path.join(root, "docs/images/walkthrough/measurements.json");

const FAKE_OSASCRIPT = `#!/bin/bash
# The host step is the first quoted word after "with arguments {".
step="$(printf '%s' "$2" | sed -n 's/.*with arguments {"\\([a-z]*\\)".*/\\1/p')"
echo "$step" >> "$FAKE_LOG"
case "$step" in
  open) echo "\${FAKE_OPEN:-Cliff dwelling}" ;;
  results) cat "$FAKE_RESULTS" ;;
  export) echo 10 ;;
  cleanup) echo 3 ;;
  remaining) printf '%s' "\${FAKE_REMAINING:-}" ;;
esac
`;

function run(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-walk-"));
  const bin = path.join(dir, "bin");
  const out = path.join(dir, "out");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "osascript"), FAKE_OSASCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "open"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const results = path.join(dir, "results.json");
  fs.copyFileSync(realMeasurements, results);
  const log = path.join(dir, "host.log");
  fs.writeFileSync(log, "");
  const r = spawnSync("bash", [script, path.join(root, "docs/images/walkthrough/source.jpg"), out], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH, FAKE_LOG: log, FAKE_RESULTS: results, WALK_POLL_SECONDS: "0" }, env),
  });
  const steps = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, steps, out, dir, results };
}

test("a document already using the working title is never touched", () => {
  const r = run({ FAKE_OPEN: "EXISTS" });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /already open/);
  assert.deepEqual(r.steps, ["open"], "no cleanup: that document may be the artist's");
});

test("a normal run cleans up, checks nothing is left, then draws the charts", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.steps, ["open", "results", "export", "cleanup", "remaining"]);
  assert.match(r.stdout, /Closed every document this run created/);
  for (const f of ["measurements.json", "zones-as-metered.svg", "zones-filters.svg", "zones-development.svg", "zones-placement.svg"]) {
    assert.ok(fs.existsSync(path.join(r.out, f)), f);
  }
});

test("documents left open fail the run and are named", () => {
  const r = run({ FAKE_REMAINING: "VF_FIG_05-filters\nVF_WALK_RESULTS" });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /still open in Photoshop/);
  assert.match(r.stderr, /VF_FIG_05-filters/);
  assert.equal(r.steps.filter((s) => s === "cleanup").length, 1, "warned once, not again on exit");
  assert.ok(!fs.existsSync(path.join(r.out, "zones-filters.svg")), "no charts after a failed cleanup");
});

test("a failure mid-run still cleans up", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-bad-"));
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "not json");
  const r = run({ FAKE_RESULTS: bad });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.steps, ["open", "results", "cleanup", "remaining"]);
});
