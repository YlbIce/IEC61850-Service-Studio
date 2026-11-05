"use strict";
const path = require("node:path");
const fs = require("node:fs/promises");
const root = process.env.STUDIO_ROOT || path.resolve(__dirname, "../../..");
const { CaptureClient } = require(path.join(root, "src/capture/helper-client"));
async function main() {
  const file = path.resolve(
    process.argv[2] || path.join(__dirname, "sample-mms.pcapng"),
  );
  const output = path.resolve(process.argv[3] || "observations.json");
  const port = Number(process.argv[4] || 18122);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid MMS port");
  const capture = new CaptureClient({ root });
  capture.on("failure", () => {});
  try {
    const opened = await capture.request("open", { file, mms_ports: [port] });
    const snapshot = await capture.request("replay", {
      mode: "snapshot",
      through_frame: opened.total,
    });
    const values = (snapshot.values || []).filter(
      (v) => v.complete && v.replayable,
    );
    // Preserve typed JSON, quality and source metadata. Do not coerce 64-bit strings to Number.
    await fs.writeFile(
      output,
      JSON.stringify(
        {
          source: file,
          frames: opened.total,
          meaning: "latest observed state; not complete device state",
          values,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    console.log(
      JSON.stringify({
        frames: opened.total,
        observations: values.length,
        output,
      }),
    );
  } finally {
    capture.close();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
