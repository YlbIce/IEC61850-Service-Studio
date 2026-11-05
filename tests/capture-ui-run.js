"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require("electron"),
  [path.join(__dirname, "capture-ui.js")],
  { cwd: root, env, stdio: "ignore", windowsHide: true },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  const file = path.join(root, "capture-ui-result.log");
  if (fs.existsSync(file)) console.log(fs.readFileSync(file, "utf8"));
  process.exitCode = code || 0;
});
