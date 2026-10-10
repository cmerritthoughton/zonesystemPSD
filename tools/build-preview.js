// Build test/.build/preview.html: the real panel HTML with the mock in place of ps.js.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "plugin/index.html"), "utf8");
html = html
  .replace('<script src="js/zones.js"></script>', '<script src="../../plugin/js/zones.js"></script>')
  .replace('<script src="js/ps.js"></script>', '<script src="../../tools/mock-ps.js"></script>')
  .replace('<script src="js/panel.js"></script>', '<script src="../../plugin/js/panel.js"></script>');
fs.mkdirSync(path.join(root, "test/.build"), { recursive: true });
fs.writeFileSync(path.join(root, "test/.build/preview.html"), html);
console.log("test/.build/preview.html");
