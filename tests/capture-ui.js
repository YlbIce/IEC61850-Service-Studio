"use strict";
// Run with Electron: node tests/capture-ui-run.js. No renderer-only test hooks.
const { app, dialog, Menu, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const { createCaptureWindow } = require("../src/capture/window");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const stream of [process.stdout, process.stderr])
  stream.on("error", () => {});
app.setPath("userData", path.join(root, ".tmp/capture-ui-profile"));
let menu;
const applied = [];
Menu.prototype.popup = function () {
  menu = this;
};
const fixture =
  process.env.CAPTURE_UI_FILE || path.join(root, ".tmp/publisher-capture.pcap");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
dialog.showMessageBox = async () => ({ response: 1 });
async function wait(check, label) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error("Timeout: " + label);
}
app.whenReady().then(async () => {
  let win;
  const report = [];
  try {
    const loadFile = BrowserWindow.prototype.loadFile;
    try {
      BrowserWindow.prototype.loadFile = function () {
        return Promise.reject(new Error("ERR_FAILED test"));
      };
      await assert.rejects(
        createCaptureWindow({ root }),
        /报文分析页面加载失败/,
      );
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      BrowserWindow.prototype.loadFile = function (...args) {
        const loading = loadFile.apply(this, args);
        this.destroy();
        return loading;
      };
      assert.equal(await createCaptureWindow({ root }), null);
      report.push(
        "PASS page load failure is handled; close during load does not raise startup failure",
      );
    } finally {
      BrowserWindow.prototype.loadFile = loadFile;
    }
    win = await createCaptureWindow({
      root: path.join(root, ".tmp/no-capture-module"),
    });
    await wait(
      () => !win.webContents.isLoadingMainFrame(),
      "missing-module window load",
    );
    await wait(
      () =>
        win.webContents.executeJavaScript(
          'document.querySelector("#availability").classList.contains("error")',
        ),
      "missing module status",
    );
    assert(
      await win.webContents.executeJavaScript(
        'document.querySelector("#availability").textContent.includes("主应用")',
      ),
    );
    assert.equal(
      await win.webContents.executeJavaScript("typeof require"),
      "undefined",
    );
    assert.equal(win.webContents.getLastWebPreferences().sandbox, true);
    report.push(
      "PASS optional module missing: separate window remains usable; sandbox enabled",
    );
    win.destroy();
    win = await createCaptureWindow({
      root,
      replay: {
        catalog: async () => ({
          running: true,
          simulation: false,
          points: [
            {
              reference: "TESTLD0/GGIO1.AnIn1",
              value: 0,
              quality: 0,
              blocked: false,
            },
          ],
        }),
        apply: async (value) => {
          applied.push(value);
        },
      },
    });
    await wait(() => !win.webContents.isLoadingMainFrame(), "real window load");
    const js = (code) => win.webContents.executeJavaScript(code);
    if (process.env.CAPTURE_UI_PORT)
      await js(
        `document.querySelector('#mms-ports').value=${JSON.stringify(process.env.CAPTURE_UI_PORT)}`,
      );
    const capability = await js('window.capture.command("capabilities")');
    report.push("CAPABILITIES " + JSON.stringify(capability));
    if (capability.analysis) {
      await js('document.querySelector("[data-action=open]").click()');
      await wait(
        () => js('document.querySelectorAll("[data-frame]").length>0'),
        "capture file rows",
      );
      await wait(
        () => js('document.querySelector("#protocol-tree details")!==null'),
        "protocol tree",
      );
      assert(await js('document.querySelector("#hex").textContent.length>0'));
      assert(await js('document.querySelectorAll("[data-frame]").length<100'));
      await js(
        'document.querySelector("[data-frame]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))',
      );
      await wait(() => menu, "native packet context menu");
      assert(menu.items.some((item) => item.label === "定位关联请求 / 响应"));
      await js('document.querySelector("[data-action=next]").click()');
      await wait(
        () => js('document.querySelector("#timeline").value === "1"'),
        "offline replay step",
      );
      await wait(
        () =>
          js(
            '!document.querySelector("#status").textContent.startsWith("解析第")',
          ),
        "step detail completed",
      );
      if (process.env.CAPTURE_UI_PORT) {
        await js(
          'document.querySelector("#filter").value="mms";document.querySelector("[data-action=filter]").click()',
        );
        await wait(
          () =>
            js(
              'document.querySelector("#status").textContent.startsWith("已加载")',
            ),
          "MMS display filter",
        );
        assert(
          await js(
            'document.querySelector("#packet-rows").textContent.includes("MMS")',
          ),
        );
        await js('document.querySelector("[data-action=sessions]").click()');
        await wait(
          () => js('document.querySelector("#sessions-dialog").open'),
          "MMS sessions dialog",
        );
        assert(
          await js(
            'document.querySelectorAll("#sessions-content [data-stream]").length>0',
          ),
        );
        await js(
          'document.querySelector("[data-close=sessions-dialog]").click()',
        );
        report.push(
          "PASS nonstandard MMS port decode, display filter and TCP/MMS session inventory",
        );
        const candidates = await js(
          'window.capture.command("packets",{filter:"mms",offset:0,limit:200})',
        );
        let sample;
        for (const packet of candidates.packets) {
          const detail = await js(
            `window.capture.command('detail',{frame:${packet.frame}})`,
          );
          const value = (detail.values || []).find(
            (value) =>
              value.replayable &&
              value.mapping === "resolved" &&
              value.complete &&
              ["ST", "MX"].includes(value.fc) &&
              typeof value.value === "number",
          );
          if (value) {
            sample = { packet, value };
            break;
          }
        }
        assert(sample, "actual MMS read response provides replayable scalar");
        await js(
          `document.querySelector('#filter').value='frame.number <= ${sample.packet.frame}';document.querySelector('[data-action=filter]').click()`,
        );
        await wait(
          () =>
            js(
              'document.querySelector("#status").textContent.startsWith("已加载")',
            ),
          "seek filter",
        );
        await js(
          'document.querySelector("#timeline").value=document.querySelector("#timeline").max;document.querySelector("#timeline").dispatchEvent(new Event("input",{bubbles:true}))',
        );
        await wait(
          () =>
            js(
              'document.querySelector("#values-mode").textContent.startsWith("累计状态")',
            ),
          "timeline observed-state reconstruction",
        );
        assert(
          await js(
            `document.querySelector('#values').textContent.includes(${JSON.stringify(sample.value.reference)})`,
          ),
        );
        report.push(
          "PASS timeline seek reconstructs observed MMS values without injection",
        );
        win.webContents.send("capture:action", { name: "mapping" });
        await wait(
          () => js('document.querySelector("#mapping-dialog").open'),
          "value mapping dialog",
        );
        await js(
          `document.querySelector('#mapping-source').value=${JSON.stringify(sample.value.reference)};document.querySelector('[data-action=mapping-add]').click()`,
        );
        await wait(
          () => js('document.querySelectorAll(".mapping-row").length===1'),
          "mapping added",
        );
        await js('document.querySelector("#mapping-form").requestSubmit()');
        await wait(
          () => js('!document.querySelector("#mapping-dialog").open'),
          "native mapping confirmation accepted",
        );
        const replayed = await js(
          `window.capture.command('replay-frame',{frame:${sample.packet.frame}})`,
        );
        assert.equal(replayed.applied, 1);
        assert.equal(applied[0].value, sample.value.value);
        assert.equal(applied[0].reference, "TESTLD0/GGIO1.AnIn1");
        await js('window.capture.command("replay-disable")');
        assert(
          await js(
            `window.capture.command('replay-frame',{frame:${sample.packet.frame}}).then(()=>false,()=>true)`,
          ),
        );
        report.push(
          "PASS explicit mapping confirmation, main-side MMS value resolution, scalar replay and revoke",
        );
        win.webContents.send("capture:action", { name: "mapping-disable" });
        await wait(
          () =>
            js(
              'document.querySelector("#replay-mode").textContent.startsWith("纯离线")',
            ),
          "offline mode restored",
        );
        await js(
          'document.querySelector("#speed").value="100";document.querySelector("[data-action=play]").click()',
        );
        await wait(
          () =>
            js(
              'document.querySelector("#status").textContent.includes("事件回放完成")',
            ),
          "indexed event playback",
        );
        assert(
          await js(
            `document.querySelector('#values').textContent.includes(${JSON.stringify(sample.value.reference)})`,
          ),
        );
        report.push(
          "PASS indexed observed-event playback, filtered timeline and read-response value display",
        );
      }
      await fs.mkdir(path.join(root, "docs/screenshots"), { recursive: true });
      await fs.writeFile(
        path.join(root, "docs/screenshots/capture-window.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      report.push(
        "PASS PCAP import, virtual packet list, protocol tree, hex, native context menu and offline replay step",
      );
    } else report.push("SKIP real import: TShark unavailable");
    if (process.env.CAPTURE_UI_LIVE === "1") {
      const js = (code) => win.webContents.executeJavaScript(code);
      const empty = path.join(root, ".tmp/empty-capture.pcapng");
      await fs.writeFile(
        empty,
        Buffer.from(
          "0a0d0d0a1c0000004d3c2b1a01000000ffffffffffffffff1c0000000100000014000000010000000000040014000000",
          "hex",
        ),
      );
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [empty],
      });
      win.webContents.send("capture:action", { name: "open" });
      await wait(
        () =>
          js(
            'document.querySelector("#status").textContent.includes("没有捕获到任何报文")',
          ),
        "empty PCAPNG explanation",
      );
      assert(
        await js(
          'document.querySelector("#packet-rows").textContent.includes("没有捕获到任何报文")',
        ),
      );
      report.push(
        "PASS empty PCAPNG shows explicit no-packets/interface/filter guidance",
      );
      win.webContents.send("capture:action", { name: "capture-options" });
      await wait(
        () => js('document.querySelector("#capture-dialog").open'),
        "capture interface dialog",
      );
      assert.equal(await js('document.querySelector("#interfaces").value'), "");
      const ifaces = await js('window.capture.command("interfaces")');
      const loopback = ifaces.interfaces.find((i) => /loopback/i.test(i.name));
      assert(loopback, "Npcap Loopback required");
      const output = path.join(root, `.tmp/ui-live-${Date.now()}.pcapng`);
      const { Backend } = require("../src/main/backend");
      const { defaultProject } = require("../src/shared/project");
      const backend = new Backend(
        root,
        path.join(root, "backend/bin/iec61850-service-backend.exe"),
      );
      backend.on("failure", () => {});
      try {
        await backend.start();
        await backend.call("Apply", { ...defaultProject(), port: 18126 });
        await backend.call("Start");
        await js(
          `document.querySelector('#interfaces').value=${JSON.stringify(loopback.id)};document.querySelector('#capture-output').value=${JSON.stringify(output)};document.querySelector('#capture-filter').value='tcp port 18126';document.querySelector('#mms-ports').value='18126';document.querySelector('#capture-form').requestSubmit()`,
        );
        await wait(
          () => js('!document.querySelector("#stop").disabled'),
          "real capture started",
        );
        const exec = require("node:util").promisify(
          require("node:child_process").execFile,
        );
        await exec(
          path.join(root, "backend/bin/mms-integration.exe"),
          ["18126", "import", "STUDIOLD0/GGIO1.AnIn1.mag.f"],
          { windowsHide: true, timeout: 15000 },
        );
        await delay(400);
        win.webContents.send("capture:action", { name: "capture-stop" });
        await wait(
          () =>
            js(
              `document.querySelector('#file-label').textContent===${JSON.stringify(output)} && /已加载 [1-9]/.test(document.querySelector('#status').textContent)`,
            ),
          "captured MMS loaded",
        );
        const packets = await js(
          'window.capture.command("packets",{filter:"mms",offset:0,limit:100})',
        );
        assert(packets.total > 0, "Actual MMS frames present");
        assert(!win.isDestroyed());
        report.push(
          `PASS explicit Loopback selection -> UI capture start -> real MMS traffic -> stop/analyze (${packets.total} MMS frames)`,
        );
      } finally {
        await backend.close();
      }
    }
    win.destroy();
    await fs.writeFile(
      path.join(root, "capture-ui-result.log"),
      report.join("\n"),
    );
    app.exit(0);
  } catch (error) {
    await fs.writeFile(
      path.join(root, "capture-ui-result.log"),
      report.join("\n") + "\nFAIL " + error.stack,
    );
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
app.on("window-all-closed", () => {});
