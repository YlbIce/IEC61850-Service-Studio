const { app, BrowserWindow, Menu, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
// GUI launches can outlive the invoking shell. Never write to a detached console pipe.
for (const stream of [process.stdout, process.stderr])
  stream?.on("error", () => {});
const log = (message) =>
  fs.appendFile(path.join(root, "ui-result.log"), message + "\n");
app.setPath("userData", path.join(root, ".tmp/ui-profile"));
let nextImport = path.join(root, "examples/genericIO.icd");
let contextMenu;
Menu.prototype.popup = function () {
  contextMenu = this;
};
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [nextImport],
});
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: path.join(root, ".tmp/ui-saved.i61850"),
});
dialog.showMessageBox = async (_window, options) => ({
  response: options?.message?.includes("停止") ? 0 : 1,
});
require("../src/main/main");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await delay(100);
  }
  throw new Error("Timeout: " + label);
}
app.whenReady().then(async () => {
  let win;
  const errors = [];
  try {
    await wait(() => {
      win = BrowserWindow.getAllWindows()[0];
      return win && !win.webContents.isLoadingMainFrame();
    }, "window");
    win.webContents.on("console-message", (_e, level, message) => {
      if (level >= 3) errors.push(message);
    });
    const js = (code) => win.webContents.executeJavaScript(code);
    await wait(
      () => js('!!document.querySelector("#table-area tbody tr")'),
      "initial point table",
    );
    assert(
      Menu.getApplicationMenu().items.length >= 7,
      "complete native menus",
    );
    assert.equal(
      await js('document.querySelectorAll("#table-area tbody tr").length'),
      10,
    );
    assert.equal(
      await js('!!document.querySelector("[data-tab=structure]")'),
      false,
    );
    const initial = await js('window.studio.command("bootstrap")');
    const openAttributes = async (selector) => {
      contextMenu = null;
      await js(
        `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
      );
      await wait(() => contextMenu, "native context menu");
      const entry = contextMenu.items.find((i) => i.label === "查看数据属性…");
      assert(entry?.enabled, "data attributes native context action");
      entry.click();
      await wait(
        () =>
          js(
            'document.querySelector("#attributes-dialog").open && !!document.querySelector("#attributes-tree tbody tr")',
          ),
        "attribute tree read",
      );
    };
    await js('document.querySelector("[data-action=settings]").click()');
    await js(
      'document.querySelector("[name=port]").value="18103";document.querySelector("#dialog-form").requestSubmit()',
    );
    await wait(
      () => js('!document.querySelector("#dialog").open'),
      "apply settings",
    );
    await js('document.querySelector("[data-action=save]").click()');
    await delay(400);
    await js('document.querySelector("[data-action=start]").click()');
    await wait(
      () =>
        js(
          'document.querySelector("#connection-pill").classList.contains("running")',
        ),
      "start",
    );
    await js('document.querySelector("[data-action=simulation]").click()');
    await delay(800);
    await js(
      'document.querySelectorAll("#table-area tbody tr td.ref")[1].click()',
    );
    assert(
      await js(
        'document.querySelector("#properties").textContent.includes("AnIn1")',
      ),
      "selected point inspector",
    );
    await js('document.querySelector("#value-button").click()');
    assert(
      await js('document.querySelector("#dialog").open'),
      "online value dialog",
    );
    await js('document.querySelector("#dialog-cancel").click()');
    await fs.mkdir(path.join(root, "docs/screenshots"), { recursive: true });
    await fs.writeFile(
      path.join(root, "docs/screenshots/workspace.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      'window.retainedRow=document.querySelector("#table-area [data-row]")',
    );
    await delay(1100);
    assert(
      await js("window.retainedRow.isConnected"),
      "live polling preserves table DOM",
    );
    await openAttributes('#table-area [data-row="STUDIOLD0/GGIO1.AnIn1"]');
    assert(
      await js(
        'document.querySelector("#attributes-tree").textContent.includes("FLOAT32")',
      ),
      "nested typed value",
    );
    await js('document.querySelector("#attributes-collapse").click()');
    const folded = await js(
      'document.querySelectorAll("#attributes-tree tbody tr").length',
    );
    await js('document.querySelector("#attributes-expand").click()');
    assert(
      (await js(
        'document.querySelectorAll("#attributes-tree tbody tr").length',
      )) > folded,
    );
    await js('window.studio.command("simulation")');
    await js(
      'window.studio.command("update",{reference:"STUDIOLD0/GGIO1.AnIn1",value:231.25,quality:0})',
    );
    await js('document.querySelector("#attributes-refresh").click()');
    await wait(
      () =>
        js(
          'document.querySelector("#attributes-tree").textContent.includes("231.25")',
        ),
      "fresh attribute value",
    );
    await fs.writeFile(
      path.join(root, "docs/screenshots/object-attributes.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.querySelector("#attributes-done").click()');
    await js('document.querySelector("[data-tab=reports]").click()');
    assert.equal(
      await js('document.querySelectorAll("#table-area tbody tr").length'),
      2,
    );
    await fs.writeFile(
      path.join(root, "docs/screenshots/reports.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.querySelector("[data-action=stop]").click()');
    await wait(
      () =>
        js(
          '!document.querySelector("#connection-pill").classList.contains("running")',
        ),
      "stop",
    );
    await js('document.querySelector("[data-action=tls-settings]").click()');
    assert(
      await js(
        '!!document.querySelector("[name=certificate]") && !!document.querySelector("[name=ca]")',
      ),
      "TLS credential configuration dialog",
    );
    await fs.writeFile(
      path.join(root, "docs/screenshots/tls.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      'document.querySelector("#dialog-cancel").click();document.querySelector("[data-action=publishers]").click()',
    );
    await wait(
      () => js('!!document.querySelector("#publisher-add")'),
      "publisher manager",
    );
    await js('document.querySelector("#publisher-add").click()');
    await wait(
      () => js('!!document.querySelector("[name=interface_id]")'),
      "publisher adapter list",
    );
    await js(
      'document.querySelector("[name=name]").value="UiGoose";document.querySelector("#dialog-form").requestSubmit()',
    );
    await wait(
      () => js('!document.querySelector("#dialog").open'),
      "save disabled publisher",
    );
    assert.equal(
      (await js('window.studio.command("bootstrap")')).project.publishers[0]
        .name,
      "UiGoose",
    );
    await js('document.querySelector("[data-action=publishers]").click()');
    await wait(
      () =>
        js(
          'document.querySelector("#dialog-body").textContent.includes("UiGoose")',
        ),
      "publisher persisted UI",
    );
    await fs.writeFile(
      path.join(root, "docs/screenshots/publishers.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      'document.querySelector("#dialog-cancel").click();document.querySelector("[data-action=setting-groups]").click()',
    );
    await wait(
      () => js('!!document.querySelector("#setting-content")'),
      "setting group dialog",
    );
    assert(
      await js(
        'document.querySelector("#setting-content").textContent.includes("没有 SGCB")',
      ),
      "absent setting model is explicit",
    );
    await js('document.querySelector("#dialog-cancel").click()');
    await js('document.querySelector("[data-action=import]").click()');
    await wait(
      () =>
        js(
          'document.querySelector("#source-label").textContent.includes("ICD")',
        ),
      "ICD import",
    );
    await js('document.querySelector("[data-tab=model]").click()');
    await openAttributes("#table-area [data-row]");
    assert(
      (await js(
        'document.querySelectorAll("#attributes-tree tbody tr").length',
      )) > 1,
    );
    await fs.writeFile(
      path.join(root, "docs/screenshots/imported-model.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.querySelector("#attributes-done").click()');
    await js('document.querySelector("[data-action=save]").click()');
    await delay(500);
    const saved = JSON.parse(
      await fs.readFile(path.join(root, ".tmp/ui-saved.i61850"), "utf8"),
    );
    assert(saved.source.cfg.startsWith("MODEL"));
    const perf = await js(
      `(async()=>{const {take,selectRow}=await import('./renderer.js');const fixture=${JSON.stringify(initial)};const point=fixture.project.points[1];fixture.project.points=Array.from({length:10000},(_,i)=>({...point,name:'Point'+i}));fixture.state.points=fixture.project.points.map(p=>({reference:'STUDIO'+p.ld+'/'+p.ln+'.'+p.name,value:220,quality:0}));fixture.model.nodes=fixture.state.points.map((p,i)=>({reference:p.reference,kind:'DO',name:'Point'+i,depth:2}));document.querySelector('[data-tab=model]').click();const start=performance.now();take(fixture);const renderMs=performance.now()-start;const count=document.querySelectorAll('#table-area [data-row]').length;const row=document.querySelector('#table-area [data-row]');const selectStart=performance.now();for(let i=0;i<100;i++)selectRow(fixture.state.points[i].reference);return {renderMs,selection100Ms:performance.now()-selectStart,domRows:count,treeRows:document.querySelectorAll('#tree [data-scope]').length,preserved:row.isConnected};})()`,
    );
    assert(perf.treeRows < 100, "10k navigator uses bounded DOM");
    assert(perf.domRows < 100, "10k model uses bounded visible DOM");
    assert(perf.preserved, "selection preserves row DOM");
    await log("PERFORMANCE 10000 points " + JSON.stringify(perf));
    await js('document.querySelector("#table-area").scrollTop=270000');
    await delay(100);
    assert(
      await js(
        'Number(document.querySelector("#table-area [data-row]").dataset.row.split("Point")[1])>9000',
      ),
      "virtual scrolling reaches last rows",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    await log(
      "PASS Electron context attributes, nested tree, fresh values, imported objects, removed tab, stable live DOM, virtual scrolling and desktop regression",
    );
    win.close();
  } catch (e) {
    await log(e.stack);
    process.exitCode = 1;
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
