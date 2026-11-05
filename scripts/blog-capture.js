"use strict";
const { app, BrowserWindow, dialog, Menu } = require("electron"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "docs/blog/assets"),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.setPath("userData", path.join(root, ".tmp/blog-server-profile"));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
for (const stream of [process.stdout, process.stderr])
  stream.on("error", () => {});
let input = path.join(root, "examples/genericIO.icd");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
dialog.showMessageBox = async () => ({ response: 1 });
require("../src/main/main");
async function wait(fn, label) {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(label);
}
app.whenReady().then(async () => {
  let win, child;
  const evidence = [];
  try {
    await wait(() => {
      win = BrowserWindow.getAllWindows()[0];
      return win && !win.webContents.isLoadingMainFrame();
    }, "main");
    win.webContents.setBackgroundThrottling(false);
    const js = (s) => win.webContents.executeJavaScript(s),
      cmd = (name, arg) =>
        js(
          `window.studio.command(${JSON.stringify(name)},${JSON.stringify(arg)})`,
        );
    await wait(
      () => js('!!document.querySelector("#table-area tbody tr")'),
      "model",
    );
    const snap = async (name, description) => {
      win.show();
      win.focus();
      await sleep(750);
      await fs.writeFile(
        path.join(out, name),
        (await win.webContents.capturePage()).toPNG(),
      );
      evidence.push({
        name,
        description,
        at: new Date().toISOString(),
        version: "0.2.2",
      });
    };
    const click = async (selector) => {
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await sleep(300);
    };
    const modal = async (action) => {
      await click(`[data-action="${action}"]`);
      await wait(() => js('document.querySelector("#dialog").open'), action);
    };
    const close = () => js('document.querySelector("#dialog").close()');
    const p = require("../src/shared/project").defaultProject();
    p.name = "IEC 61850 联调与故障复现工程";
    p.port = 18140;
    p.file_service = true;
    p.file_root = path.join(root, ".tmp/blog-files");
    await fs.mkdir(p.file_root, { recursive: true });
    await fs.writeFile(
      path.join(p.file_root, "commissioning.txt"),
      "IEC 61850 file service commissioning sample\n",
    );
    await cmd("replace", p);
    await modal("settings");
    await snap(
      "02-server-settings.png",
      "监听地址、端口、远方控制与专用文件目录配置",
    );
    await close();
    await cmd("start");
    await sleep(500);
    await snap("01-workspace.png", "真实MMS服务在18140端口运行的桌面工作区");
    const net = require("node:net"),
      probe = net.createServer();
    await new Promise((r, j) => {
      probe.once("error", j);
      probe.listen(48650, "127.0.0.1", r);
    });
    await new Promise((r) => probe.close(r));
    await fs.rm(path.join(root, ".tmp/blog-client-ready.json"), {
      force: true,
    });
    await fs.rm(path.join(root, ".tmp/blog-client-stop"), { force: true });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(
      process.execPath,
      [path.join(root, "scripts/blog-client-capture.js")],
      { env, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
    );
    await wait(async () => {
      try {
        const r = JSON.parse(
          await fs.readFile(
            path.join(root, ".tmp/blog-client-ready.json"),
            "utf8",
          ),
        );
        if (r.error) throw new Error(r.error);
        return r.ok;
      } catch (e) {
        if (e.code === "ENOENT") return false;
        throw e;
      }
    }, "client");
    await cmd("update", {
      reference: "STUDIOLD0/GGIO1.AnIn1",
      value: 231.5,
      quality: 0,
      blocked: false,
    });
    for (const [tab, name, description] of [
      ["datasets", "04-datasets.png", "预定义Measurements与Events数据集"],
      [
        "reports",
        "05-reports.png",
        "配套真实客户端启用报告控制块后的服务端状态",
      ],
      ["sessions", "06-sessions.png", "配套Client Studio通过真实MMS连接服务端"],
      ["controls", "07-controls.png", "遥控对象与控制模型监视"],
      ["files", "09-files.png", "启用后的专用MMS文件目录预览"],
    ]) {
      await click(`[data-tab="${tab}"]`);
      await snap(name, description);
    }
    await cmd("simulation");
    await click('[data-tab="simulation"]');
    await sleep(850);
    await snap("08-simulation.png", "实际运行的波形仿真与更新计数");
    await cmd("simulation");
    await click('[data-tab="model"]');
    win.webContents.send("action", {
      name: "object-attributes",
      reference: "STUDIOLD0/GGIO1.AnIn1",
    });
    await wait(
      () =>
        js(
          'document.querySelector("#attributes-dialog").open && !!document.querySelector("#attributes-tree tbody tr")',
        ),
      "attributes",
    );
    await snap("03-attributes.png", "真实对象完整DA树、FC、类型及运行值");
    await js('document.querySelector("#attributes-dialog").close()');
    await fs.writeFile(path.join(root, ".tmp/blog-client-stop"), "stop");
    await sleep(800);
    await cmd("stop");
    await modal("tls-settings");
    await snap("10-tls.png", "TLS凭据配置界面；协议握手证据另见安全集成日志");
    await close();
    p.publishers = [
      {
        name: "LabGoose",
        kind: "GOOSE",
        enabled: false,
        interface_id: "",
        destination: "01:0c:cd:01:00:01",
        app_id: 1000,
        vlan_id: 0,
        priority: 4,
        dataset: "STUDIOLD0/LLN0$Measurements",
        control_ref: "STUDIOLD0/LLN0$GO$LabGoose",
        conf_rev: 1,
        min_ms: 4,
        max_ms: 1000,
        sample_rate: 80,
        vlan: false,
        sv_id: "LabSV",
      },
    ];
    await cmd("replace", p);
    await modal("publishers");
    await snap(
      "11-publishers.png",
      "GOOSE发布配置；截图配置禁用，不向网络发包",
    );
    await close();
    input = path.join(root, "examples/setting-groups.cid");
    await click('[data-action="import"]');
    await wait(
      () =>
        js(
          'document.querySelector("#source-label").textContent.toLowerCase().includes("cid")',
        ),
      "CID import",
    );
    await click('[data-tab="model"]');
    await snap("16-import.png", "实际CID导入后的模型与源文件信息");
    await modal("setting-groups");
    await snap(
      "12-setting-groups.png",
      "导入实际五组SG/SE模型后的持久化定值组界面",
    );
    await close();
    await fs.writeFile(
      path.join(root, "docs/blog/screenshot-manifest.json"),
      JSON.stringify(evidence, null, 2),
    );
    await cmd("quit").catch(() => {});
    setTimeout(() => app.quit(), 500);
  } catch (e) {
    await fs.writeFile(path.join(root, "blog-screenshot-error.log"), e.stack);
    child?.stdin.end();
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
