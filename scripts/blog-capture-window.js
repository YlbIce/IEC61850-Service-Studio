const { app, dialog } = require("electron"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const { createCaptureWindow } = require("../src/capture/window");
app.setPath("userData", path.join(root, ".tmp/blog-capture-profile"));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
for (const s of [process.stdout, process.stderr]) s.on("error", () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let file = path.join(root, "docs/blog/examples/sample-mms.pcapng");
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
app.whenReady().then(async () => {
  try {
    const w = await createCaptureWindow({ root });
    const js = (s) => w.webContents.executeJavaScript(s);
    const wait = async (f) => {
      for (let i = 0; i < 300; i++) {
        if (await js(f)) return;
        await sleep(100);
      }
      throw Error(f);
    };
    const snap = async (n) => {
      await sleep(800);
      await fs.writeFile(
        path.join(root, "docs/blog/assets", n),
        (await w.webContents.capturePage()).toPNG(),
      );
    };
    await js(
      'document.querySelector("#mms-ports").value="18122";document.querySelector("[data-action=open]").click()',
    );
    await wait('document.querySelectorAll("[data-frame]").length>0');
    await js(
      'document.querySelector("#timeline").value=document.querySelector("#timeline").max;document.querySelector("#timeline").dispatchEvent(new Event("input",{bubbles:true}))',
    );
    await wait(
      'document.querySelector("#values-mode").textContent.startsWith("累计状态")',
    );
    const packets = await js(
      'window.capture.command("packets",{filter:"mms",offset:0,limit:200})',
    );
    let frame;
    for (const item of packets.packets) {
      const detail = await js(
        'window.capture.command("detail",{frame:' + item.frame + "})",
      );
      if (
        (detail.values || []).some(
          (v) => v.replayable && v.complete && v.value === 220,
        )
      ) {
        frame = item.frame;
        break;
      }
    }
    if (!frame) throw Error("No actual read response");
    await js(
      'document.querySelector("#filter").value="frame.number <= ' +
        frame +
        '";document.querySelector("[data-action=filter]").click()',
    );
    await wait(
      'document.querySelector("#status").textContent.startsWith("已加载")',
    );
    await js(
      'document.querySelector("#timeline").value=document.querySelector("#timeline").max;document.querySelector("#timeline").dispatchEvent(new Event("input",{bubbles:true}))',
    );
    await wait(
      'document.querySelector("#values-mode").textContent.startsWith("累计状态")',
    );
    await js('document.querySelector("[data-action=expand]").click()');
    await snap("17-capture-replay.png");
    await js('document.querySelector("[data-action=sessions]").click()');
    await wait('document.querySelector("#sessions-dialog").open');
    await snap("18-capture-sessions.png");
    await js(
      'document.querySelector("[data-close=sessions-dialog]").click();document.querySelector("[data-action=capture-options]").click()',
    );
    await wait('document.querySelector("#capture-dialog").open');
    await snap("19-capture-options.png");
    w.destroy();
    app.quit();
  } catch (e) {
    await fs.writeFile(
      path.join(root, ".tmp/blog-capture-window-error.log"),
      e.stack,
    );
    app.exit(1);
  }
});
