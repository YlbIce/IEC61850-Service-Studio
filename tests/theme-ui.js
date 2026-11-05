const { app, BrowserWindow, nativeTheme, Menu, dialog } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  profile = path.join(root, ".tmp/theme-test-profile");
app.setPath("userData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", "1");
for (const stream of [process.stdout, process.stderr])
  stream.on("error", () => {});
const restart = process.argv.includes("--restart");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn) => {
  for (let i = 0; i < 300; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await delay(100);
  }
  throw Error("Theme test timeout");
};
require("../src/main/main");
app.whenReady().then(async () => {
  try {
    const main = await wait(() =>
      BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("/renderer/index.html"),
      ),
    );
    const js = (win, code) => win.webContents.executeJavaScript(code);
    await wait(() =>
      js(
        main,
        '!!window.appearance && !!document.querySelector(".theme-picker")',
      ),
    );
    if (restart) {
      assert.equal(
        await js(main, "document.documentElement.dataset.themeSource"),
        "dark",
      );
      assert.equal(
        await js(main, "document.documentElement.dataset.theme"),
        "dark",
      );
    } else {
      await wait(() =>
        js(
          main,
          'window.studio.command("bootstrap").then(r=>r.state.configured)',
        ),
      );
      await js(main, 'window.studio.command("capture")');
      const capture = await wait(() =>
        BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("/capture/index.html"),
        ),
      );
      await wait(() =>
        js(capture, '!!document.querySelector(".theme-picker")'),
      );
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path.join(root, "docs/blog/examples/sample-mms.pcapng")],
      });
      await js(
        capture,
        'document.querySelector("#mms-ports").value="18122";document.querySelector("[data-action=open]").click()',
      );
      await wait(() =>
        js(capture, 'document.querySelectorAll("tr[data-frame]").length>0'),
      );
      await js(
        capture,
        'document.querySelector("tr[data-frame]").click();document.querySelector("[data-action=ai-toggle]").click()',
      );
      const entry = {
        window: capture,
        aiGeneration: 0,
        aiResult: {
          id: "theme-fixture",
          question: "MMS 报文解析与学习",
          answer:
            "## 读取响应\n\n对照对象引用与返回值。\n\n| 帧 | 值 |\n| --- | --- |\n| 24 | 220 |\n\n```text\nMMS Read → Response\n```",
          facts: [{ text: "样例：返回值为220", frames: [24] }],
          limitations: ["这是主题测试样例。"],
          next_checks: ["核对数据品质。"],
          coverage: "界面主题验证",
          usage: {},
          model: "local-fixture",
          at: new Date().toISOString(),
          context: { evidence: [] },
        },
      };
      await require("../src/capture/ai/answer-window").show(entry);
      await require("../src/capture/ai/history-window")
        .history()
        .create({ ...entry.aiResult, status: "completed", mode: "learn" });
      await require("../src/capture/ai/history-window").show(entry);
      const pages = [main, capture, entry.aiAnswer.win, entry.aiHistory];
      for (const win of pages)
        await wait(() => js(win, '!!document.querySelector(".theme-picker")'));
      const theme = require("../src/main/theme");
      for (const mode of ["dark", "light"]) {
        await js(
          capture,
          `document.querySelector('.theme-picker').value='${mode}';document.querySelector('.theme-picker').dispatchEvent(new Event('change'))`,
        );
        for (const win of pages) {
          await wait(() =>
            js(
              win,
              `document.documentElement.dataset.theme==='${mode}' && document.querySelector('.theme-picker').value==='${mode}'`,
            ),
          );
          assert.equal(
            await js(
              win,
              "getComputedStyle(document.documentElement).colorScheme",
            ),
            mode,
          );
          const body = await js(
            win,
            "getComputedStyle(document.body).backgroundColor",
          );
          if (mode === "dark") assert.equal(body, "rgb(21, 28, 37)");
        }
        assert(
          Menu.getApplicationMenu().getMenuItemById("theme-" + mode).checked,
        );
        await js(
          main,
          'document.querySelector("[data-action=settings]").click()',
        );
        await wait(() => js(main, 'document.querySelector("#dialog").open'));
        if (mode === "dark")
          assert.equal(
            await js(
              main,
              'getComputedStyle(document.querySelector("#dialog")).backgroundColor',
            ),
            "rgb(28, 38, 50)",
          );
        await fs.mkdir(path.join(root, "docs/screenshots"), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(root, `docs/screenshots/theme-${mode}-dialog.png`),
          (await main.webContents.capturePage()).toPNG(),
        );
        await js(main, 'document.querySelector("#dialog").close()');

        await fs.mkdir(path.join(root, "docs/screenshots"), {
          recursive: true,
        });
        for (const [i, win] of pages.entries())
          await fs.writeFile(
            path.join(
              root,
              `docs/screenshots/theme-${mode}-${["main", "capture", "answer", "history"][i]}.png`,
            ),
            (await win.webContents.capturePage()).toPNG(),
          );
      }
      await assert.rejects(
        js(main, 'window.appearance.set("invalid")'),
        /模式无效/,
      );
      await theme.set("system");
      const descriptor = Object.getOwnPropertyDescriptor(
        nativeTheme,
        "shouldUseDarkColors",
      );
      let simulatedDark = false;
      Object.defineProperty(nativeTheme, "shouldUseDarkColors", {
        configurable: true,
        get: () =>
          nativeTheme.themeSource === "system"
            ? simulatedDark
            : nativeTheme.themeSource === "dark",
      });
      try {
        for (const dark of [true, false]) {
          simulatedDark = dark;
          nativeTheme.emit("updated");
          for (const win of pages)
            await wait(() =>
              js(
                win,
                `document.documentElement.dataset.theme==='${dark ? "dark" : "light"}' && document.documentElement.dataset.themeSource==='system'`,
              ),
            );
        }
        await theme.set("light");
        simulatedDark = true;
        nativeTheme.emit("updated");
        assert.equal(theme.state().resolved, "light");
      } finally {
        if (descriptor)
          Object.defineProperty(nativeTheme, "shouldUseDarkColors", descriptor);
        else delete nativeTheme.shouldUseDarkColors;
      }
      await theme.set("dark");
      // New windows inherit dark before their document paints.
      entry.aiAnswer.win.destroy();
      await require("../src/capture/ai/answer-window").show(entry);
      await wait(() =>
        js(
          entry.aiAnswer.win,
          'document.documentElement.dataset.theme==="dark"',
        ),
      );
      assert.equal(
        JSON.parse(
          await fs.readFile(path.join(profile, "appearance.json"), "utf8"),
        ).theme,
        "dark",
      );
    }
    await fs.writeFile(
      path.join(
        root,
        restart ? "theme-restart-result.json" : "theme-ui-result.json",
      ),
      JSON.stringify({
        passed: true,
        restart,
        systemChange:
          "simulated nativeTheme updated events; Windows settings unchanged",
      }),
    );
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    app.quit();
  } catch (error) {
    await fs.writeFile(
      path.join(
        root,
        restart ? "theme-restart-result.json" : "theme-ui-result.json",
      ),
      JSON.stringify({ passed: false, error: error.stack }),
    );
    app.exit(1);
  }
});
