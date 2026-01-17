const fs = require("node:fs");
const path = require("node:path");

// Copy renderer HTML into dist so Electron can load it without a bundler.
const source = path.join(__dirname, "..", "src", "renderer", "index.html");
const destDir = path.join(__dirname, "..", "dist", "renderer");
const dest = path.join(destDir, "index.html");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);
