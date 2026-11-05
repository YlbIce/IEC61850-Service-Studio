"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

// Stable project identity prevents unrelated projects sharing a setting bank.
function settingPath(directory, project) {
  const schema =
    project.source?.cfg ||
    JSON.stringify({
      ied: project.ied_name,
      points: project.points?.map(({ ld, ln, name, cdc }) => ({
        ld,
        ln,
        name,
        cdc,
      })),
    });
  const identity =
    project.storage_id || createHash("sha256").update(schema).digest("hex");
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(identity))
    throw new Error("无效的工程存储标识");
  return path.join(directory, "settings", `${identity}.banks`);
}

class AuditLog {
  constructor(file) {
    this.file = file;
    this.sequence = 0;
  }
  reset() {
    this.sequence = 0;
  }
  async append(events) {
    const fresh = events.filter((e) => e.sequence > this.sequence);
    if (!fresh.length) return;
    const stat = await fs.stat(this.file).catch(() => null);
    if (stat?.size > 5 * 1024 * 1024) {
      await fs.rm(this.file + ".1", { force: true });
      await fs.rename(this.file, this.file + ".1");
    }
    await fs.appendFile(
      this.file,
      fresh.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    this.sequence = fresh.at(-1).sequence;
  }
}
module.exports = { atomic, settingPath, AuditLog };
