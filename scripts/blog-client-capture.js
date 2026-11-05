"use strict";
const { app, BrowserWindow } = require("electron"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "docs/blog/assets");
app.setPath("userData", path.join(root, ".tmp/blog-client-profile"));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
require("../../Iec61850ClientStudio/src/main/main");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    let win;
    for (let i = 0; i < 200; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await sleep(100);
    }
    const js = (s) => win.webContents.executeJavaScript(s);
    for (let i = 0; i < 200; i++) {
      try {
        const ready = await js('window.iec61850.call("GetServerInfo",{})');
        if (ready.grpcCode || ready.ok === false)
          throw new Error(ready.message);
        break;
      } catch (e) {
        if (i === 199) throw e;
        await sleep(100);
      }
    }
    let result = await js(
      'window.iec61850.call("Connect",{host:"127.0.0.1",port:18140,mock:false,timeoutMs:5000})',
    );
    if (!result.ok) throw new Error(result.message);
    await js('window.iec61850.call("RefreshModel",{force:true})');
    await sleep(900);
    await js('openModule("model")');
    await sleep(300);
    await fs.writeFile(
      path.join(out, "13-client-model.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('readObjectReference("STUDIOLD0/GGIO1.AnIn1.mag.f","MX")');
    await js('openModule("data")');
    await sleep(300);
    await fs.writeFile(
      path.join(out, "14-client-read.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('readDatasetReference("STUDIOLD0/LLN0.Measurements")');
    await js('openModule("datasets")');
    await sleep(300);
    await fs.writeFile(
      path.join(out, "15-client-dataset.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      '(async()=>{const r=await window.iec61850.call("GetReportControlBlocks",{logicalNode:"STUDIOLD0/LLN0"});const b=r.blocks.find(b=>!b.buffered);if(b){const v=await window.iec61850.call("SetReportControlBlock",{...b,enabled:true,gi:true});if(!v.ok)throw new Error(v.message)}})()',
    );
    await fs.writeFile(
      path.join(root, ".tmp/blog-client-ready.json"),
      JSON.stringify({ ok: true, at: new Date().toISOString() }),
    );
    setInterval(async () => {
      try {
        await fs.access(path.join(root, ".tmp/blog-client-stop"));
        app.quit();
      } catch {}
    }, 250);
  } catch (e) {
    await fs.writeFile(
      path.join(root, ".tmp/blog-client-ready.json"),
      JSON.stringify({ error: e.stack }),
    );
    app.quit();
  }
});
