const { spawn } = require("node:child_process"),
  path = require("node:path"),
  fs = require("node:fs");
const root = path.resolve(__dirname, ".."),
  env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
async function run(restart) {
  await new Promise((resolve, reject) => {
    const p = spawn(
      require("electron"),
      [path.join(root, "tests/theme-ui.js"), ...(restart ? ["--restart"] : [])],
      { cwd: root, env, stdio: "ignore", windowsHide: true },
    );
    p.on("error", reject);
    p.on("exit", (code) => {
      const file = path.join(
        root,
        restart ? "theme-restart-result.json" : "theme-ui-result.json",
      );
      const result = JSON.parse(fs.readFileSync(file, "utf8"));
      console.log(JSON.stringify(result));
      code || !result.passed ? reject(Error("Theme UI failed")) : resolve();
    });
  });
}
run(false)
  .then(() => run(true))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
