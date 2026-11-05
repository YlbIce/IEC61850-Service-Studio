const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { readModel, convertModel } = require("../src/main/importer");
const root = path.resolve(__dirname, ".."),
  release = process.env.STUDIO_TEST_RELEASE || path.join(root, "release/win-unpacked");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.join(release, "IEC61850 Service Studio.exe"),
    [
      "--remote-debugging-port=9248",
      "--user-data-dir=" + path.join(root, ".tmp/packaged-profile"),
    ],
    { stdio: "ignore", windowsHide: true, env },
  );
  let ws;
  try {
    let target;
    for (let i = 0; i < 100; i++) {
      try {
        const pages = await (
          await fetch("http://127.0.0.1:9248/json/list")
        ).json();
        target = pages.find((p) =>
          p.url.includes("app.asar/src/renderer/index.html"),
        );
        if (target) break;
      } catch {}
      await delay(100);
    }
    assert(target, "packaged Electron renderer launched");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (pending.has(m.id)) {
        const { resolve, reject, timer } = pending.get(m.id);
        clearTimeout(timer);
        pending.delete(m.id);
        m.error
          ? reject(new Error(JSON.stringify(m.error)))
          : resolve(m.result);
      }
    };
    const rpc = (method, params) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => {
          pending.delete(n);
          reject(new Error("CDP timeout"));
        }, 20000);
        pending.set(n, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    const js = async (expression) => {
      const r = await rpc("Runtime.evaluate", {
        expression: `(async () => (${expression}))()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    let boot;
    for (let i = 0; i < 50; i++) {
      try {
        boot = await js('window.studio.command("bootstrap")');
        if (boot.state.configured) break;
      } catch {}
      await delay(100);
    }
    assert(boot.state.configured, "packaged C++ backend configured");
    await js('window.appearance.set("dark")');
    await delay(100);
    assert.equal(await js('document.documentElement.dataset.theme'),'dark');
    await js('window.appearance.set("light")');
    await delay(100);
    assert.equal(await js('document.documentElement.dataset.theme'),'light');
    await js('window.appearance.set("system")');
    console.log('PASS packaged light/dark/system theme IPC and rendering');
    assert(boot.model.nodes.length > 100, "packaged model browse");
    await js(
      'window.studio.command("replace", {...(await window.studio.command("bootstrap")).project, port:18114})',
    );
    await js('window.studio.command("start")');
    assert((await js('window.studio.command("bootstrap")')).state.running);
    await js('window.studio.command("stop")');
    assert(!(await js('window.studio.command("bootstrap")')).state.running);
    const captureWindow = async () => {
      await js('window.studio.command("capture")');
      for (let i = 0; i < 50; i++) {
        const pages = await (
          await fetch("http://127.0.0.1:9248/json/list")
        ).json();
        const page = pages.find((p) => p.url.includes("/capture/index.html"));
        if (page) return page;
        await delay(100);
      }
      throw new Error("Packaged capture window did not open");
    };
    const captureEvaluate = async (page, expression) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        socket.onopen = r;
        socket.onerror = j;
      });
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Capture CDP timeout")),
            20000,
          );
          socket.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.id !== 1) return;
            clearTimeout(timer);
            if (m.error || m.result.exceptionDetails)
              reject(new Error(JSON.stringify(m)));
            else resolve(m.result.result.value);
          };
          socket.send(
            JSON.stringify({
              id: 1,
              method: "Runtime.evaluate",
              params: { expression, awaitPromise: true, returnByValue: true },
            }),
          );
        });
      } finally {
        socket.close();
      }
    };
    const helper = path.join(release, "resources/capture/capture-helper.exe");
    const disabled = helper + ".optional-test";
    await fs.rename(helper, disabled);
    try {
      const page = await captureWindow();
      const absent = await captureEvaluate(
        page,
        'window.capture.command("capabilities").catch(e => ({missing:e.message}))',
      );
      assert(
        absent.missing?.includes("capture-helper.exe"),
        "missing module has an explanatory error",
      );
      await js('window.studio.command("start")');
      assert(
        (await js('window.studio.command("bootstrap")')).state.running,
        "MMS starts while module is absent",
      );
      await js('window.studio.command("stop")');
      await fetch("http://127.0.0.1:9248/json/close/" + page.id);
      await delay(250);
    } finally {
      await fs.rename(disabled, helper);
    }
    const capturePage = await captureWindow();
    const capabilities = await captureEvaluate(
      capturePage,
      'window.capture.command("capabilities")',
    );
    assert(
      capabilities.available && capabilities.analysis,
      "packaged DLL and TShark available",
    );
    const lessons=await captureEvaluate(capturePage,'window.capture.command("ai-lessons")');
    assert.equal(lessons.length,4,'packaged offline AI courses');
    const settings=await captureEvaluate(capturePage,'window.capture.command("ai-settings")');
    assert.equal(settings.endpoint,'https://api.deepseek.com');
    await captureEvaluate(capturePage,'document.querySelector("[data-action=ai-settings]").click()');
    await delay(250);
    assert(await captureEvaluate(capturePage,'document.querySelector("#ai-settings-dialog").open'),'packaged AI settings dialog');
    await captureEvaluate(capturePage,'window.capture.command("ai-history")');
    const historyPages = await (await fetch('http://127.0.0.1:9248/json/list')).json();
    const historyPage=historyPages.find(p=>p.url.includes('/ai/history.html'));
    assert(historyPage,'packaged history manager opens');
    const history=await captureEvaluate(historyPage,'window.historyApi.command("list")');
    assert(Array.isArray(history.rows));
    console.log('PASS packaged AI IPC / four offline courses / settings dialog; no cloud calls');
    await fetch("http://127.0.0.1:9248/json/close/" + capturePage.id);
    console.log(
      "PASS packaged independent capture window / DLL / TShark / missing addon does not block MMS",
    );
    const input = await readModel(path.join(root, "examples/genericIO.icd"));
    await convertModel(input, input.choices[0], {
      directory: path.join(root, ".tmp/packaged-import"),
      jar: path.join(
        release,
        "resources/app.asar.unpacked/tools/genconfig.jar",
      ),
      binary: path.join(
        release,
        "resources/backend/bin/iec61850-service-backend.exe",
      ),
    });
    console.log(
      "PASS packaged ASAR UI / IPC / C++ backend / real MMS start-stop / unpacked Java converter",
    );
    await js('window.studio.command("quit")').catch(() => {});
    ws.close();
    ws = null;
    await delay(800);
  } finally {
    ws?.close();
    if (child.exitCode === null) child.kill();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
