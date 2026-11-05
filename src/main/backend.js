"use strict";
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");
class Backend extends EventEmitter {
  constructor(root, bin) {
    super();
    this.root = root;
    this.bin = bin;
    this.closed = false;
  }
  async start() {
    const token = randomBytes(32).toString("hex");
    this.metadata = new grpc.Metadata();
    this.metadata.set("x-studio-token", token);
    this.child = spawn(this.bin, [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SERVICE_STUDIO_TOKEN: token },
    });
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", (b) => this.emit("log", b.toString()));
    const port = await new Promise((resolve, reject) => {
      let buffer = "",
        ready = false;
      const timer = setTimeout(() => {
        this.child.kill();
        reject(new Error("后端启动超时"));
      }, 15000);
      this.child.stdout.on("data", (b) => {
        if (ready) {
          this.emit("log", b.toString());
          return;
        }
        buffer = (buffer + b).slice(-65536);
        const m = buffer.match(/READY (\d+)/);
        if (m) {
          ready = true;
          buffer = "";
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      this.child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      this.child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`后端退出：${code}`));
        if (!this.closed)
          this.emit("failure", `C++ 后端异常退出 (${code})，MMS 服务已停止`);
      });
    });
    const def = loader.loadSync(path.join(this.root, "proto/service.proto"), {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const api = grpc.loadPackageDefinition(def).service_studio;
    this.client = new api.ServiceStudio(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
      { "grpc.max_receive_message_length": 16 * 1024 * 1024 },
    );
  }
  call(method, value = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client) return reject(new Error("后端未就绪"));
      this.client[method](
        value,
        this.metadata,
        { deadline: new Date(Date.now() + 15000) },
        (e, r) =>
          e
            ? reject(new Error(`${method}: ${e.details || e.message}`))
            : r?.ok === false
              ? reject(new Error(`${method}: ${r.message || "操作失败"}`))
              : resolve(r),
      );
    });
  }
  async close() {
    this.closed = true;
    if (this.child && this.child.exitCode === null) {
      const finished = new Promise((r) => this.child.once("exit", r));
      this.child.stdin.end("shutdown\n");
      let timer;
      await Promise.race([
        finished,
        new Promise((r) => {
          timer = setTimeout(() => {
            this.child.kill();
            r();
          }, 4000);
        }),
      ]);
      clearTimeout(timer);
    }
    this.client?.close();
  }
}
module.exports = { Backend };
