const theme = require("./theme");
("use strict");
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  clipboard,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { assertTrustedSender } = require("./ipc-guard");
const { randomUUID } = require("node:crypto");
const { Backend } = require("./backend");
const { readModel, convertModel, checkCfg } = require("./importer");
const { atomic, settingPath, AuditLog } = require("./storage");
const { protocolCommands } = require("./protocol-commands");
const { createReplayTarget } = require("./replay-target");
const { defaultProject, assertProject } = require("../shared/project");
const root = path.resolve(__dirname, "../..");
let win,
  backend,
  project = defaultProject(),
  projectFile = "",
  dirty = false,
  latest = { running: false },
  model = { nodes: [], datasets: [], reports: [] },
  timer,
  quitting = false,
  busy = false;
let recent = [],
  pendingImport = null,
  audit;
const protocols = protocolCommands({
  window: () => win,
  backend: () => backend,
  sendState: async () => {
    latest = await backend.call("Snapshot");
    send("state", latest);
  },
});
const bin = () =>
  path.join(
    app.isPackaged ? process.resourcesPath : root,
    "backend/bin/iec61850-service-backend.exe",
  );
const dataPath = (name) => path.join(app.getPath("userData"), name);
const envelope = () => ({
  project,
  projectFile,
  dirty,
  state: latest,
  model,
  recent,
});
function send(name, value) {
  if (win && !win.isDestroyed()) win.webContents.send(name, value);
}
async function poll() {
  if (quitting) return;
  try {
    latest = await backend.call("Snapshot");
    send("state", latest);
    await audit.append(latest.events);
  } catch (e) {
    send("backend-error", e.message);
  } finally {
    if (!quitting) timer = setTimeout(poll, 500);
  }
}
async function apply(next) {
  assertProject(next);
  const payload = {
    ...next,
    config_path: "",
    settings_path: settingPath(app.getPath("userData"), next),
  };
  if (next.source) {
    checkCfg(next.source.cfg);
    const p = dataPath("runtime/model.cfg");
    await atomic(p, next.source.cfg);
    payload.config_path = p;
  }
  if (next.file_service) {
    const st = await fs.stat(next.file_root);
    if (!st.isDirectory()) throw new Error("文件服务根目录不存在");
    payload.file_root = next.file_root
      .replaceAll("\\", "/")
      .replace(/\/?$/, "/");
  }
  await backend.call("Apply", payload);
  for (const config of Object.values(next.simulation_overrides || {})) await backend.call("Simulation", config);
  model = await backend.call("GetModel");
  latest = await backend.call("Snapshot");
}
async function setProject(next, file = "", modified = true) {
  await apply(next);
  project = next;
  projectFile = file;
  dirty = modified;
  if (modified)
    await atomic(dataPath("recovery.json"), JSON.stringify(project, null, 2));
  title();
  send("project", envelope());
}
function title() {
  win?.setTitle(
    `${dirty ? "● " : ""}${project.name} — IEC61850 Service Studio`,
  );
  buildMenu();
}
async function save(as = false) {
  let file = projectFile;
  if (!file || as) {
    const result = await dialog.showSaveDialog(win, {
      title: "保存服务端工程",
      defaultPath: file || `${project.name}.i61850`,
      filters: [{ name: "Service Studio 工程", extensions: ["i61850"] }],
    });
    if (result.canceled) return false;
    file = result.filePath;
  }
  await atomic(file, JSON.stringify(project, null, 2));
  projectFile = file;
  dirty = false;
  await fs.rm(dataPath("recovery.json"), { force: true });
  await addRecent(file);
  title();
  send("project", envelope());
  return true;
}
async function discard() {
  if (!dirty) return true;
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    title: "未保存的工程",
    message: "是否保存当前工程的更改？",
    buttons: ["保存", "不保存", "取消"],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 2) return false;
  if (response === 0) return save();
  await fs.rm(dataPath("recovery.json"), { force: true });
  return true;
}
async function stopped() {
  latest = await backend.call("Snapshot");
  if (latest.running) throw new Error("请先停止 MMS 服务，再修改工程配置");
}
async function addRecent(file) {
  recent = [file, ...recent.filter((p) => p !== file)].slice(0, 8);
  await atomic(dataPath("recent.json"), JSON.stringify(recent));
  buildMenu();
}
async function openProject(file) {
  await stopped();
  if (!(await discard())) return;
  if (!file) {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [
        { name: "Service Studio 工程", extensions: ["i61850", "json"] },
      ],
    });
    if (r.canceled) return;
    file = r.filePaths[0];
  }
  const st = await fs.stat(file);
  if (st.size > 12 * 1024 * 1024) throw new Error("工程文件超过 12 MB");
  const p = JSON.parse(await fs.readFile(file, "utf8"));
  await setProject(p, file, false);
  await addRecent(file);
}
async function beginImport() {
  await stopped();
  if (!(await discard())) return null;
  const r = await dialog.showOpenDialog(win, {
    title: "导入 IEC 61850 模型",
    properties: ["openFile"],
    filters: [
      {
        name: "IEC 61850 模型",
        extensions: ["icd", "cid", "scd", "iid", "cfg"],
      },
    ],
  });
  if (r.canceled) return null;
  const file = r.filePaths[0],
    input = await readModel(file);
  pendingImport = { file, input };
  if (input.choices.length > 1)
    return { choices: input.choices, file: path.basename(file) };
  return finishImport(input.choices[0]);
}
async function finishImport(choice) {
  await stopped();
  if (!pendingImport) throw new Error("没有等待导入的文件");
  const { file, input } = pendingImport;
  const result = await convertModel(input, choice, {
    directory: dataPath("import/" + randomUUID()),
    jar: path.join(
      app.isPackaged ? root.replace(/app\.asar$/, "app.asar.unpacked") : root,
      "tools/genconfig.jar",
    ),
    binary: bin(),
  });
  const next = defaultProject();
  next.name = path.basename(file);
  next.source = {
    format: input.ext.slice(1).toUpperCase(),
    filename: path.basename(file),
    ied: choice?.ied || "",
    accessPoint: choice?.ap || "",
    cfg: result.cfg,
    diagnostics: result.diagnostics,
  };
  next.points = [];
  next.datasets = [];
  next.reports = [];
  const match = result.cfg.match(/MODEL\(([^)]+)\)/);
  next.ied_name = match?.[1] || "IMPORTED";
  await setProject(next, "", true);
  pendingImport = null;
  return {
    imported: true,
    diagnostics: result.diagnostics,
    notices: model.notices,
  };
}
function emitAction(action) {
  send("action", action);
}
function buildMenu() {
  require("./native-menu").buildMenu({
    project,
    recent,
    emitAction,
    run,
    openProject,
  });
}
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    send("backend-error", e.message);
    return { error: e.message };
  }
}
async function command(action, arg) {
  if (Object.hasOwn(protocols, action)) return protocols[action](arg);
  switch (action) {
    case "bootstrap":
      return envelope();
    case "capture": {
      const { createCaptureWindow } = require("../capture/window");
      await createCaptureWindow({
        parent: win,
        root,
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
        replay: createReplayTarget({
          backend: () => backend,
          project: () => project,
          model: () => model,
        }),
      });
      return { ok: true };
    }
    case "new":
      await stopped();
      if (await discard()) await setProject(defaultProject());
      break;
    case "open":
      await openProject();
      break;
    case "save":
      return save();
    case "save-as":
      return save(true);
    case "import":
      return beginImport();
    case "finish-import":
      return finishImport(arg);
    case "replace":
      await stopped();
      await setProject(arg, projectFile, true);
      break;
    case "validate":
      assertProject(project);
      return { message: "工程校验通过；原生模型已成功加载" };
    case "simulation-config":
      await backend.call("Simulation", arg);
      project.simulation_overrides = { ...project.simulation_overrides, [arg.reference]: arg };
      dirty = true;
      latest = await backend.call("Snapshot");
      send("project", envelope());
      break;
    case "simulation":
      await backend.call("Simulation", { enabled: !latest.simulation });
      break;
    case "refresh":
      model = await backend.call("GetModel");
      latest = await backend.call("Snapshot");
      send("project", envelope());
      return envelope();
    case "object-attributes": {
      if (typeof arg !== "string") throw new Error("请选择一个数据对象");
      const fresh = await backend.call("GetModel");
      const index = fresh.nodes.findIndex(
        (n) => n.reference === arg && n.kind === "DO",
      );
      if (index < 0) throw new Error("数据对象不存在，请刷新模型后重试");
      const nodes = [fresh.nodes[index]],
        depth = nodes[0].depth;
      for (
        let i = index + 1;
        i < fresh.nodes.length && fresh.nodes[i].depth > depth;
        i++
      )
        nodes.push(fresh.nodes[i]);
      return { reference: arg, nodes, read_at: Date.now() };
    }
    case "choose-folder": {
      const r = await dialog.showOpenDialog(win, {
        properties: ["openDirectory"],
      });
      return r.canceled ? null : r.filePaths[0];
    }
    case "list-files": {
      if (!project.file_root) return [];
      return (await fs.readdir(project.file_root, { withFileTypes: true })).map(
        (f) => ({ name: f.name, directory: f.isDirectory() }),
      );
    }
    case "file-folder":
      if (project.file_root) await shell.openPath(project.file_root);
      break;
    case "audit-folder":
      await shell.openPath(app.getPath("userData"));
      break;
    case "copy":
      clipboard.writeText(String(arg).slice(0, 100000));
      break;
    case "export-log": {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: "service-events.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!r.canceled) {
        const esc = (v) =>
          '"' +
          String(v)
            .replace(/^[=+@-]/, "'$&")
            .replaceAll('"', '""') +
          '"';
        await atomic(
          r.filePath,
          "\uFEFF时间,级别,类别,消息\r\n" +
            (latest.events || [])
              .map((e) =>
                [
                  new Date(e.timestamp).toISOString(),
                  e.level,
                  e.category,
                  e.message,
                ]
                  .map(esc)
                  .join(","),
              )
              .join("\r\n"),
        );
      }
      break;
    }
    case "export-cfg": {
      if (!project.source)
        throw new Error("此操作用于导出已导入的原始 CFG 模型");
      const r = await dialog.showSaveDialog(win, {
        defaultPath: "model.cfg",
        filters: [{ name: "libiec61850 CFG", extensions: ["cfg"] }],
      });
      if (!r.canceled) await atomic(r.filePath, project.source.cfg);
      break;
    }
    case "restart-backend": {
      const current = await backend.call("Snapshot").catch(() => null);
      if (current?.running) throw new Error("请先停止 MMS 服务再重启通信后端");
      await backend.close();
      await startBackend();
      await apply(project);
      send("project", envelope());
      break;
    }
    case "about":
      await dialog.showMessageBox(win, {
        type: "info",
        title: "关于",
        message: "IEC61850 Service Studio",
        detail: `版本 0.2.2\nElectron ${process.versions.electron} · C++17 · gRPC\nlibiec61850 ${latest.library_version || ""}\n\n桌面 IED 工程与 MMS 服务工具\nGPL-3.0-or-later；第三方许可见项目 LICENSE。`,
      });
      break;
    case "quit":
      win.close();
      break;
    default:
      throw new Error("不支持的操作");
  }
  return { ok: true };
}
async function startBackend() {
  backend = new Backend(root, bin());
  backend.on("failure", (message) => {
    latest = {
      ...latest,
      running: false,
      configured: false,
      simulation: false,
      sessions: [],
    };
    send("state", latest);
    send("backend-error", message);
  });
  backend.on("log", (message) => {
    fs.appendFile(dataPath("backend.log"), message).catch(() => {});
  });
  await backend.start();
  audit.reset();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      audit = new AuditLog(dataPath("audit.jsonl"));
      recent = JSON.parse(
        await fs.readFile(dataPath("recent.json"), "utf8").catch(() => "[]"),
      );
      win = new BrowserWindow({
        width: 1480,
        height: 940,
        minWidth: 1050,
        minHeight: 700,
        icon: path.join(root, "build/icon.ico"),
        backgroundColor: "#eef1f5",
        show: false,
        webPreferences: {
          preload: path.join(root, "src/preload/preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      theme.attach(win, path.join(root, "src/renderer/index.html"));
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      ipcMain.handle("command", async (e, action, arg) => {
        assertTrustedSender(e, win, root);
        if (busy && action !== "bootstrap" && action !== "copy")
          throw new Error("上一项操作正在执行，请稍候");
        if (action === "bootstrap") return envelope();
        busy = true;
        try {
          return await command(action, arg);
        } finally {
          busy = false;
        }
      });
      ipcMain.handle("context", (e, target) => {
        assertTrustedSender(e, win, root);
        const controls = target?.kind === "point";
        const object =
          controls &&
          model.nodes.some(
            (n) => n.reference === target.reference && n.kind === "DO",
          );
        Menu.buildFromTemplate([
          { label: "刷新", click: () => emitAction("refresh") },
          ...(controls
            ? [
                {
                  label: "查看数据属性…",
                  enabled: object,
                  click: () =>
                    send("action", {
                      name: "object-attributes",
                      reference: target.reference,
                    }),
                },
                { type: "separator" },
              ]
            : []),
          ...(controls
            ? [
                {
                  label: "修改运行值 / 品质…",
                  click: () => emitAction("update-value"),
                },
                {
                  label: "编辑点位配置…",
                  enabled: !latest.running && !project.source,
                  click: () => emitAction("edit"),
                },
                {
                  label: "复制引用",
                  click: () => emitAction("copy-reference"),
                },
              ]
            : [
                {
                  label: "编辑配置…",
                  enabled: !latest.running && !project.source,
                  click: () => emitAction("edit"),
                },
              ]),
          { type: "separator" },
          {
            label: "删除",
            enabled: !latest.running && !project.source,
            click: () => emitAction("delete"),
          },
        ]).popup({ window: win });
      });
      win.on("close", async (e) => {
        if (quitting) return;
        e.preventDefault();
        if (!(await discard())) return;
        if (latest.running) {
          const r = await dialog.showMessageBox(win, {
            message: "退出将停止 MMS 服务并断开所有客户端。",
            buttons: ["停止并退出", "取消"],
            cancelId: 1,
          });
          if (r.response !== 0) return;
        }
        quitting = true;
        clearTimeout(timer);
        await backend?.close();
        win.destroy();
        app.quit();
      });
      try {
        await startBackend();
        if (quitting || win.isDestroyed()) return;
        await apply(project);
      } catch (e) {
        if (quitting || win.isDestroyed()) return;
        await dialog.showMessageBox(win, {
          type: "error",
          message: "通信后端启动失败",
          detail: e.message,
        });
      }
      if (quitting || win.isDestroyed()) return;
      await win.loadFile(path.join(root, "src/renderer/index.html"));
      if (quitting || win.isDestroyed()) return;
      title();
      win.show();
      poll();
      const recovery = await fs
        .readFile(dataPath("recovery.json"), "utf8")
        .catch(() => null);
      if (recovery) {
        const r = await dialog.showMessageBox(win, {
          message: "检测到上次未保存的工程，是否恢复？",
          buttons: ["恢复", "忽略"],
          cancelId: 1,
        });
        if (r.response === 0) await run(() => setProject(JSON.parse(recovery)));
      }
    })
    .catch((e) => {
      if (quitting || win?.isDestroyed()) return;
      fs.appendFile(
        dataPath("startup-error.log"),
        `${new Date().toISOString()} ${e.stack || e.message}\n`,
      ).catch(() => {});
      dialog.showErrorBox("启动失败", e.stack || e.message);
      app.quit();
    });
}
