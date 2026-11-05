"use strict";
const path = require("node:path");
const assert = require("node:assert/strict");
const root = process.env.STUDIO_ROOT || path.resolve(__dirname, "../../..");
const { Backend } = require(path.join(root, "src/main/backend"));
const { defaultProject } = require(path.join(root, "src/shared/project"));
const { createReplayTarget } = require(
  path.join(root, "src/main/replay-target"),
);
async function main() {
  const backend = new Backend(
    root,
    path.join(root, "backend/bin/iec61850-service-backend.exe"),
  );
  backend.on("failure", (e) => process.stderr.write(e.message + "\n"));
  const project = defaultProject();
  project.host = "127.0.0.1";
  project.port = Number(process.env.STUDIO_MMS_PORT || 18142);
  try {
    await backend.start();
    await backend.call("Apply", project);
    await backend.call("Start");
    const target = createReplayTarget({
      backend: () => backend,
      project: () => project,
      model: () => ({ nodes: [] }),
    });
    const reference = "STUDIOLD0/GGIO1.AnIn1";
    for (const value of [220, 231.5, 0]) {
      await target.apply({ reference, value, quality: 0 });
      const snapshot = await backend.call("Snapshot");
      assert.equal(
        snapshot.points.find((p) => p.reference === reference).value,
        value,
      );
      process.stdout.write(
        JSON.stringify({ reference, value, verified: true }) + "\n",
      );
    }
  } finally {
    await backend.close();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
