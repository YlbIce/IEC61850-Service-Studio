import { datasetMembers, renderDatasetPane } from "./views/datasets.mjs";
import { createEditors } from "./views/editors.mjs";
import { createVirtualTable } from "./views/virtual-table.mjs";
import { createModelTree } from "./views/model-tree.mjs";
import { createAttributeView } from "./views/attributes.mjs";
import { field, select, check } from "./views/forms.mjs";
import { createProtocolDialogs } from "./views/protocols.mjs";
("use strict");
const $ = (s) => document.querySelector(s),
  api = window.studio;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let project,
  state = { points: [], events: [], sessions: [], reports: [] },
  model = { nodes: [], datasets: [], reports: [] },
  dirty = false,
  file = "",
  tab = "model",
  selected = "",
  scope = "",
  sortKey = "",
  ascending = true,
  paused = false,
  clearBefore = 0,
  lastLogSequence = -1;
let rows = [],
  columns = [],
  history = new Map(),
  nodeIndex = new Map(),
  collapsed = new Set(),
  dialogSubmit = null,
  toastTimer;
const tabs = {
  model: "数据模型",
  datasets: "数据集",
  reports: "报告控制块",
  controls: "遥控监视",
  simulation: "数值仿真",
  sessions: "客户端连接",
  files: "文件服务",
};

let activeDataset = "";
let liveIndex = new Map(),
  rowIndex = new Map(),
  scrollFrame = 0,
  filterTimer;
const types = [
  "BOOLEAN",
  "INT8",
  "INT16",
  "INT32",
  "INT64",
  "INT128",
  "INT8U",
  "INT16U",
  "INT24U",
  "INT32U",
  "FLOAT32",
  "FLOAT64",
  "ENUM",
  "OCTET64",
  "OCTET6",
  "OCTET8",
  "VIS32",
  "VIS64",
  "VIS65",
  "VIS129",
  "VIS255",
  "UNICODE255",
  "TIMESTAMP",
  "QUALITY",
  "CHECK",
  "DBPOS",
  "BITSTRING",
  "STRUCT",
  "ENTRY_TIME",
  "PHYCOMADDR",
  "CURRENCY",
  "OPTFLDS",
  "TRGOPS",
];
const controlNames = {
  1: "直接控制 · 普通",
  2: "SBO · 普通",
  3: "直接控制 · 增强",
  4: "SBO · 增强",
};
const waveNames = {
  constant: "恒定",
  sine: "正弦",
  ramp: "斜坡",
  square: "方波",
};
const key = (p) => `${p.ld}/${p.ln}.${p.name}`;
const time = (v) =>
  v ? new Date(Number(v)).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
const num = (v) =>
  Number.isInteger(Number(v))
    ? String(v)
    : Number(v).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
const modelTree = createModelTree({
  element: $("#tree"),
  esc,
  getState: () => ({
    model,
    project,
    scope,
    collapsed,
    filter: $("#tree-search").value.toLowerCase(),
  }),
});
const attributeView = createAttributeView({ $, call, esc, types, time });
const protocolDialogs = createProtocolDialogs({
  $,
  call,
  esc,
  field,
  select,
  check,
  modal,
  replace,
  getProject: () => project,
  getState: () => state,
});
const tableView = createVirtualTable({
  element: $("#table-area"),
  esc,
  getContext: () => ({
    rows,
    columns,
    tab,
    sortKey,
    ascending,
    selected,
    liveIndex,
    project,
  }),
});
const {
  editPoint,
  updateValue,
  settings,
  datasetDialog,
  reportDialog,
  deleteSelected,
} = createEditors({
  getContext: () => ({ project, state, tab }),
  setSelected: (value) => {
    selected = value;
  },
  field,
  select,
  check,
  modal,
  replace,
  call,
  toast,
  esc,
  $,
  key,
  controlNames,
  waveNames,
  points,
  current,
  requireEditable,
});
function showError(message) {
  $("#error-text").textContent = message;
  $("#error-banner").hidden = false;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 2800);
}
async function call(name, arg) {
  try {
    return await api.command(name, arg);
  } catch (e) {
    throw new Error(
      e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
    );
  }
}
function take(e) {
  if (project?.name !== e.project.name) {
    history.clear();
    scope = "";
    selected = "";
  }
  project = e.project;
  state = e.state;
  liveIndex = new Map((state.points || []).map((p) => [p.reference, p]));
  model = e.model;
  nodeIndex = new Map(model.nodes.map((n) => [n.reference, n]));
  dirty = e.dirty;
  file = e.projectFile;
  renderProject();
}
function points() {
  const live = liveIndex;
  if (!project.source)
    return project.points.map((p) => ({
      ...p,
      reference: project.ied_name + key(p),
      ...(live.get(project.ied_name + key(p)) || {}),
    }));
  return (state.points || []).map((p) => {
    const mag = nodeIndex.get(p.reference + ".mag.f"),
      st = nodeIndex.get(p.reference + ".stVal");
    const ctl = nodeIndex.get(p.reference + ".ctlModel");
    return {
      ...p,
      name: p.reference.split(".").at(-1),
      cdc: mag
        ? "MV"
        : st?.type === "0"
          ? ctl
            ? "SPC"
            : "SPS"
          : st?.type === "25"
            ? "DPC"
            : "INS",
      control_model: Number(ctl?.value || 0),
      description: "导入模型",
      waveform: p.waveform || "constant",
      amplitude: p.amplitude || 0,
      period: p.period || 10,
    };
  });
}
function renderProject() {
  $("#project-title").textContent =
    `${project.name}${dirty ? " · 未保存" : ""}`;
  $("#project-title").title = file || "尚未保存";
  $("#source-label").textContent = project.source
    ? `${project.source.format} · ${project.source.filename}`
    : "可编辑工程";
  $("#endpoint").textContent = `${project.host}:${project.port}`;
  $("#model-count").textContent =
    `${model.nodes.filter((n) => n.kind === "LD").length} LD · ${model.nodes.filter((n) => n.kind === "LN").length} LN · ${model.nodes.filter((n) => n.kind === "DA").length} DA`;
  renderTree();
  renderTabs();
  renderView();
  renderState();
}
function renderTree() {
  modelTree.render();
}
function renderTabs() {
  $("#tabs").innerHTML = Object.entries(tabs)
    .map(
      ([k, v]) =>
        `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? "active" : ""}" data-tab="${k}">${v}</button>`,
    )
    .join("");
}
function matchScope(ref) {
  return (
    !scope ||
    ref === scope ||
    ref.startsWith(scope + "/") ||
    ref.startsWith(scope + ".")
  );
}
function renderView() {
  document.body.classList.toggle("dataset-focus", tab === "datasets");
  if (!project) return;
  const list = points(),
    c = (key, label, format) => ({ key, label, format });
  $("#view-title").textContent = tabs[tab] || "使用说明";
  $("#filter").hidden = tab === "files" || tab === "help";
  const add = $("#add-button");
  add.hidden =
    !!project.source || !["model", "datasets", "reports"].includes(tab);
  add.disabled = state.running;
  add.dataset.action =
    tab === "datasets"
      ? "add-dataset"
      : tab === "reports"
        ? "add-report"
        : "add-point";
  add.textContent =
    tab === "datasets"
      ? "＋ 新建数据集"
      : tab === "reports"
        ? "＋ 新建报告"
        : "＋ 新增点位";
  $("#value-button").hidden = !["model", "controls", "simulation"].includes(
    tab,
  );
  $("#value-button").disabled = !selected;
  $("#view-note").hidden = true;
  if (project.source && tab !== "help") {
    $("#view-note").hidden = false;
    $("#view-note").textContent =
      "导入模型保留完整结构；结构配置只读。运行值与品质可在线修改，右键“查看数据属性”可查看对象的全部 DA。" +
      (model.notices?.length ? " 部分服务有支持限制，见帮助与属性面板。" : "");
  }
  switch (tab) {
    case "model":
    case "controls":
    case "simulation":
      rows = list.filter(
        (p) =>
          matchScope(p.reference) &&
          (tab !== "controls" || ["SPC", "DPC"].includes(p.cdc)),
      );
      columns = [
        c("reference", "对象引用"),
        c("cdc", "CDC", (v) => `<span class="badge">${esc(v)}</span>`),
        c("value", "当前值", (v) => esc(num(v))),
        c(
          "quality",
          "品质",
          (v) =>
            `<span class="${v ? "warn" : "good"}">${v ? "0x" + Number(v).toString(16) : "Good"}</span>`,
        ),
      ];
      if (tab === "controls")
        columns.push(
          c("control_model", "控制模型", (v) =>
            esc(controlNames[v] || "未配置"),
          ),
          c("blocked", "闭锁", (v) =>
            v ? '<span class="bad">闭锁</span>' : "允许",
          ),
        );
      else if (tab === "simulation")
        columns.push(
          c("waveform", "波形", (v) => waveNames[v]),
          c("amplitude", "幅值"),
          c("period", "周期 / s"),
        );
      else
        columns.push(
          c("timestamp", "更新时间", (v) => time(v)),
          c("description", "描述"),
        );
      break;
    case "datasets":
      rows = datasetMembers(model, project, points(), activeDataset);
      activeDataset = rows.datasetReference;
      columns = [c("reference", "数据对象引用"), c("du", "数据名称（dU）"), c("value", "数据值"), c("quality", "质量")];
      break;
    case "reports":
      rows = (model.reports || []).map((r) => {
        const live = state.reports.find((l) =>
          l.name.endsWith(`${r.ln}.${r.name}`),
        );
        return {
          ...r,
          reference: `${r.ld}/${r.ln}.${r.name}`,
          enabled: live?.enabled,
          owner: live?.owner,
          events: live?.events || 0,
        };
      });
      columns = [
        c("reference", "报告控制块"),
        c("buffered", "类型", (v) => (v ? "BRCB" : "URCB")),
        c("dataset", "数据集"),
        c("enabled", "状态", (v) =>
          v ? '<span class="good">已启用</span>' : "未启用",
        ),
        c("integrity_ms", "IntgPd / ms"),
        c("events", "生成报告"),
        c("owner", "客户端"),
      ];
      break;
    case "sessions":
      rows = (state.sessions || []).map((s) => ({
        ...s,
        reference: s.address,
      }));
      columns = [
        c("address", "客户端地址"),
        c("since", "连接建立时间", (v) => new Date(v).toLocaleString("zh-CN")),
      ];
      break;
    case "files":
      renderFiles();
      return;
    case "help":
      renderHelp();
      return;
  }
  const filter = $("#filter").value.toLowerCase();
  if (filter)
    rows = rows.filter((r) =>
      Object.values(r).join(" ").toLowerCase().includes(filter),
    );
  if (sortKey)
    rows.sort(
      (a, b) =>
        (typeof a[sortKey] === "number"
          ? a[sortKey] - b[sortKey]
          : String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""))) *
        (ascending ? 1 : -1),
    );
  $("#view-count").textContent = `${rows.length} 项`;
  rowIndex = new Map(rows.map((r) => [r.reference, r]));
  renderTable(true);
  $("#refresh-time").textContent = `更新于 ${time(Date.now())}`;
  renderProperties();
}
function renderTable(force = false) {
  if (tab === "datasets") {
    renderDatasetPane($("#table-area"), model, project, rows, activeDataset, esc);
    return;
  }
  tableView.render(force);
}
function selectRow(reference) {
  selected = reference;
  for (const tr of document.querySelectorAll("#table-area [data-row]"))
    tr.classList.toggle("selected", tr.dataset.row === selected);
  $("#value-button").disabled = !selected;
  renderProperties();
}
function updateLiveCells() {
  for (const tr of document.querySelectorAll("#table-area [data-row]")) {
    const live = liveIndex.get(tr.dataset.row),
      r = rowIndex.get(tr.dataset.row);
    if (!live || !r) continue;
    for (const c of columns) {
      if (
        !["value", "quality", "timestamp", "blocked"].includes(c.key) ||
        r[c.key] === live[c.key]
      )
        continue;
      r[c.key] = live[c.key];
      const cell = tr.querySelector(`[data-column="${c.key}"]`);
      const html = c.format ? c.format(r[c.key], r) : esc(r[c.key]);
      if (cell && cell.innerHTML !== html) {
        cell.innerHTML = html;
        cell.title = String(r[c.key]);
      }
    }
  }
  const p = rowIndex.get(selected);
  if (p) {
    Object.assign(p, liveIndex.get(selected) || {});
    for (const [key, label] of [
      ["value", "当前值"],
      ["quality", "品质位"],
      ["blocked", "闭锁"],
    ]) {
      const cell = $(`#properties [data-property="${label}"] b`);
      const value = key === "value" ? num(p[key]) : String(p[key]);
      if (cell && cell.textContent !== value) cell.textContent = value;
    }
    updateTrend();
  }
  $("#refresh-time").textContent = `更新于 ${time(Date.now())}`;
}
function renderProperties() {
  const p = rowIndex.get(selected);
  const field = (k, v) =>
    `<div class="property" data-property="${esc(k)}"><span>${esc(k)}</span><b>${esc(v ?? "—")}</b></div>`;
  let html = "";
  if (p) {
    html = `<div class="property-title"><strong>${esc(p.name || p.reference.split(".").at(-1))}</strong><small>${esc(p.reference)}</small></div><div class="property-section">对象属性</div>`;
    const labels = {
      cdc: "公共数据类",
      fc: "功能约束",
      type: "属性类型",
      value: "当前值",
      quality: "品质位",
      control_model: "控制模型",
      blocked: "闭锁",
      description: "描述",
      waveform: "波形",
      amplitude: "幅值",
      period: "周期 / s",
      dataset: "数据集",
      buffered: "缓冲报告",
      integrity_ms: "完整性 / ms",
      buffer_ms: "缓冲 / ms",
      triggers: "触发位",
      conf_rev: "版本",
      owner: "客户端",
      events: "报告计数",
    };
    for (const [k, label] of Object.entries(labels))
      if (p[k] !== undefined)
        html += field(
          label,
          k === "control_model"
            ? controlNames[p[k]]
            : k === "value"
              ? num(p[k])
              : p[k],
        );
    if (p.members)
      html +=
        `<div class="property-section">数据集成员</div>` +
        p.members.map((v, i) => field(String(i + 1), v)).join("");
    if (["model", "controls", "simulation"].includes(tab))
      html +=
        '<div id="live-trend" class="property-section"><span></span><svg class="sparkline" viewBox="0 0 230 65" aria-label="实时趋势"><polyline/></svg></div>';
    html += `<div class="property-actions"><button data-action="copy-reference">复制引用</button>${["model", "controls", "simulation"].includes(tab) ? '<button data-action="update-value">修改运行值</button>' : ""}</div>`;
  } else
    html = `<div class="property-title"><strong>${esc(model.ied_name || project.ied_name)}</strong><small>IED 服务实例</small></div><div class="property-section">服务配置</div>${field("监听地址", project.host)}${field("MMS 端口", project.port)}${field("最大连接", project.max_clients)}${field("遥控策略", project.allow_controls ? "允许；按点位闭锁" : "拒绝全部遥控")}${field("模型来源", project.source?.format || "可编辑工程")}${field("管理链路", "本机 gRPC · 随机令牌")}<div class="property-actions"><button data-action="settings">服务配置</button><button data-action="help">使用说明</button></div>`;
  if (model.notices?.length)
    html +=
      '<div class="property-section">导入诊断</div>' +
      model.notices.map((n) => field("提示", n)).join("");
  $("#properties").innerHTML = html;
  updateTrend();
  $("#selection-label").textContent = p
    ? p.reference
    : "选择对象查看属性；双击编辑，右键更多操作";
}
function updateTrend() {
  const trend = $("#live-trend");
  if (!trend) return;
  const samples = history.get(selected) || [];
  trend.hidden = samples.length < 3;
  if (samples.length < 3) return;
  const min = Math.min(...samples),
    max = Math.max(...samples);
  trend.querySelector("span").textContent = `最近 ${samples.length} 次采样`;
  trend
    .querySelector("polyline")
    .setAttribute(
      "points",
      samples
        .map(
          (v, i) =>
            `${(i * 230) / (samples.length - 1)},${58 - ((v - min) / (max - min || 1)) * 50}`,
        )
        .join(" "),
    );
}
function renderState() {
  const on = state.running;
  $("#add-button").disabled = on;
  $("#connection-pill").className = "pill" + (on ? " running" : "");
  $("#connection-pill").textContent = on ? "● MMS 服务运行中" : "● 服务已停止";
  $("#status-text").textContent = on
    ? `MMS ${project.host}:${project.port}`
    : "MMS 服务已停止";
  $("#status-led").classList.toggle("running",on);
  $("#status-clients").textContent =
    `客户端 ${state.sessions?.length || 0} / ${project.max_clients}`;
  $("#status-updates").textContent = `更新 ${state.updates || 0}`;
  $("#status-controls").textContent = `遥控 ${state.controls || 0}`;
  $("#status-uptime").textContent = on
    ? `运行 ${Math.floor((Date.now() - state.started_at) / 1000)} s`
    : "运行时间 —";
  $("#status-lib").textContent = `libiec61850 ${state.library_version || ""}`;
  $('[data-action="start"]').disabled = on || !state.configured;
  $('[data-action="stop"]').disabled = !on;
  $('[data-action="simulation"]').disabled = !on;
  $("#sim-label").textContent = state.simulation ? "暂停仿真" : "运行仿真";
  renderLogs();
}
function renderLogs() {
  const seq = state.events?.at(-1)?.sequence || 0;
  if (paused || seq === lastLogSequence) return;
  lastLogSequence = seq;
  const level = $("#log-level").value,
    category = $("#log-category").value;
  const events = (state.events || []).filter(
    (e) =>
      e.sequence > clearBefore &&
      (!level || e.level === level) &&
      (!category || e.category === category),
  );
  $("#event-count").textContent = events.length;
  $("#logs").innerHTML =
    `<table><colgroup><col style="width:112px"><col style="width:64px"><col style="width:110px"><col></colgroup><tbody>${events
      .slice(-500)
      .map(
        (e) =>
          `<tr><td class="subtle">${time(e.timestamp)}</td><td class="${e.level === "ERROR" ? "bad" : e.level === "WARN" ? "warn" : "good"}">${e.level}</td><td>${esc(e.category)}</td><td title="${esc(e.message)}">${esc(e.message)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  $("#logs").scrollTop = $("#logs").scrollHeight;
}
async function renderFiles() {
  $("#view-count").textContent = project.file_service ? "已启用" : "未启用";
  $("#table-area").innerHTML =
    `<div class="file-list"><strong>MMS 文件服务</strong><p>根目录：${esc(project.file_root || "未选择")}</p><p>只共享明确选择的目录。此服务提供协议库的文件操作能力；请使用专用交换目录。</p><button data-action="settings">配置文件目录</button> <button data-action="file-folder">在资源管理器中打开</button><div id="file-items"></div></div>`;
  try {
    const files = await call("list-files");
    if (tab === "files")
      $("#file-items").innerHTML =
        "<table><thead><tr><th>名称</th><th>类型</th></tr></thead><tbody>" +
        files
          .map(
            (f) =>
              `<tr><td>${esc(f.name)}</td><td>${f.directory ? "文件夹" : "文件"}</td></tr>`,
          )
          .join("") +
        "</tbody></table>";
  } catch (e) {
    showError(e.message);
  }
}
function renderHelp() {
  $("#view-count").textContent = "0.2.2";
  $("#table-area").innerHTML =
    `<article class="help-content"><h2>IEC61850 Service Studio</h2><p>用于工程联调的桌面 IEC 61850 IED 服务工具。通信由本地 C++ / libiec61850 后端提供。</p><h3>1. 建立服务工程</h3><p>使用默认工程，或通过“文件 → 导入模型”加载 ICD、CID、SCD、IID 或 libiec61850 CFG。SCL 导入需要 Java 17+；多 IED / 访问点文件会弹出选择窗口。工程文件内嵌 CFG，可移动后重新打开。</p><h3>2. 启动与客户端联调</h3><p>F5 启动 MMS。配套 Client Studio 选择真实连接，地址 ${esc(project.host)}，端口 ${project.port}。默认工程包含 GGIO 遥测、遥信、直接控制和 SBO 增强控制，以及 URCB / BRCB。报告需由客户端保留并启用；F6 运行波形将触发数据变更报告。</p><h3>3. 桌面操作</h3><p>双击点位修改配置，运行时双击修改值。右键可复制引用、编辑或删除。所有结构变更要求先停止服务。Ctrl+S 保存配置；在线改值只作用于运行模型，不改变已保存的初值。右键“查看数据属性”在弹窗中显示对象的全部属性树及值，可展开、折叠并刷新读取值。拖动分隔条调整面板。</p><h3>4. 导入模型与服务边界</h3><p>导入使用 libiec61850 官方 genconfig 转换器与 CFG 解析器，保留原有模型、数据集和控制块。不是任意厂商 SCL 的一致性认证工具；转换错误会显示诊断。导入模型的结构只读，支持具有 value / q / t 结构的 MV、SPS、INS、SPC、DPC 在线改值；其他类型保留并可读取。布尔值控制器用于 SPC / DPC，其他 CDC 的执行逻辑尚未实现。</p><p>通过“工程”菜单配置 GOOSE / SV 发布、双向 TLS 与持久化定值组。发布需选择以太网卡并安装 Npcap；SV 显示漏期计数，smpSynch=0。定值组通过 SG / SE / SGCB 编辑、确认与切换。MMS 日志存储尚未配置。</p><h3>5. 日志与恢复</h3><p>审计事件写入应用数据目录，单文件 5 MB 轮转，保留一份历史。工程修改自动写入恢复文件。C++ 后端随桌面进程退出，通信异常会明确显示，服务不自动暴露到网络。关闭运行中的应用会提示停止服务。</p><h3>快捷键</h3><p>Ctrl+N 新建 · Ctrl+O 打开 · Ctrl+I 导入 · Ctrl+S 保存 · F5 启动 · Shift+F5 停止 · F6 仿真 · F2 编辑 · Insert 新增 · Delete 删除 · Ctrl+F 筛选</p></article>`;
}
function modal(title, body, submit, label = "确定") {
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  $("#dialog-error").textContent = "";
  $("#dialog-ok").textContent = label;
  dialogSubmit = submit;
  $("#dialog").showModal();
}
function requireEditable() {
  if (state.running) throw new Error("请先停止 MMS 服务再修改结构");
  if (project.source)
    throw new Error(
      "导入模型的结构只读。可修改运行值，或在 SCL 配置工具编辑后重新导入。",
    );
}
function current() {
  const p = rowIndex.get(selected);
  if (!p) throw new Error("请先选择一个对象");
  return p;
}
async function replace(p) {
  await call("replace", p);
  toast("配置已应用");
}
async function action(name) {
  try {
    if (typeof name === "object") {
      if (name.name === "object-attributes")
        await attributeView.open(name.reference);
      return;
    }
    if (name.startsWith("tab:")) {
      tab = name.slice(4);
      selected = "";
      sortKey = "";
      renderTabs();
      renderView();
      return;
    }
    if (name === "tls-settings") {
      protocolDialogs.tls();
      return;
    }
    if (name === "publishers") {
      await protocolDialogs.publishers();
      return;
    }
    if (name === "setting-groups") {
      await protocolDialogs.settings();
      return;
    }
    switch (name) {
      case "add-point":
        editPoint(true);
        return;
      case "add-dataset":
        datasetDialog(true);
        return;
      case "add-report":
        reportDialog(true);
        return;
      case "settings":
        settings();
        return;
      case "update-value":
        updateValue();
        return;
      case "edit":
        if (tab === "datasets") updateValue();
        else if (tab === "simulation") configureWaveform();
        else if (tab === "reports") reportDialog();
        else if (["model", "controls", "simulation"].includes(tab)) {
          if (state.running || project.source) updateValue();
          else editPoint();
        } else throw new Error("请选择可编辑的数据点、数据集或报告");
        return;
      case "delete":
        await deleteSelected();
        return;
      case "copy-reference":
        await call("copy", current().reference);
        toast("已复制引用");
        return;
      case "find":
        $("#filter").focus();
        return;
      case "toggle-properties":
        document.body.classList.toggle("hide-properties");
        return;
      case "toggle-log":
        document.body.classList.toggle("hide-log");
        return;
      case "reset-layout":
        for (const k of ["left", "right", "bottom"])
          document.documentElement.style.removeProperty("--" + k);
        document.body.classList.remove("hide-log", "hide-properties");
        localStorage.removeItem("layout");
        return;
      case "help":
        tab = "help";
        selected = "";
        renderTabs();
        renderView();
        return;
      case "import": {
        const result = await call("import");
        if (result?.choices) {
          modal(
            "选择 IED 与访问点",
            `<p class="hint">${esc(result.file)}</p>${select(
              "choice",
              "可导入的服务实例",
              0,
              result.choices.map((c, i) => [i, `${c.ied} / ${c.ap}`]),
            )}`,
            async (data) => {
              await call(
                "finish-import",
                result.choices[Number(data.get("choice"))],
              );
              scope = "";
              selected = "";
              renderTree();
              renderView();
              toast("模型已导入");
            },
            "导入",
          );
        } else if (result?.imported) {
          scope = "";
          selected = "";
          renderTree();
          renderView();
          toast("模型已导入");
        }
        return;
      }
      default: {
        const r = await call(name);
        if (r?.message) toast(r.message);
        if (name === "new" || name === "open") {
          scope = "";
          selected = "";
          renderTree();
          renderView();
        }
        break;
      }
    }
  } catch (e) {
    showError(e.message);
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (b && !b.disabled) action(b.dataset.action);
});
$("#tabs").onclick = (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) action("tab:" + b.dataset.tab);
};
$("#tree").onclick = (e) => {
  const toggle = e.target.closest("[data-collapse]");
  if (toggle && toggle.textContent) {
    const ref = toggle.dataset.collapse;
    if (collapsed.has(ref)) collapsed.delete(ref);
    else collapsed.add(ref);
    renderTree();
    return;
  }
  const row = e.target.closest("[data-scope]");
  if (row) {
    scope = row.dataset.scope;
    selected = scope;
    tab = "model";
    renderTree();
    renderTabs();
    renderView();
  }
};
$("#table-area").onclick = (e) => {
  const dataset = e.target.closest("[data-dataset]");
  if (dataset) { activeDataset = dataset.dataset.dataset; selected = ""; renderView(); return; }
  const editDataset = e.target.closest("[data-edit-dataset]");
  if (editDataset) {
    const d = (model.datasets || []).find((d) => `${d.ld}/${d.ln ? d.ln + "." : ""}${d.name}` === activeDataset);
    if (d) { rowIndex.set(activeDataset, { ...d, reference: activeDataset }); selected = activeDataset; datasetDialog(); }
    return;
  }
  if (tab === "datasets") {
    const row = e.target.closest("[data-row]");
    if (row) { selectRow(row.dataset.row); try { updateValue(); } catch (error) { showError(error.message); } }
    return;
  }
  const sort = e.target.closest("[data-sort]");
  if (sort) {
    ascending = sortKey === sort.dataset.sort ? !ascending : true;
    sortKey = sort.dataset.sort;
    renderView();
    return;
  }
  const r = e.target.closest("[data-row]");
  if (r) selectRow(r.dataset.row);
};
$("#table-area").ondblclick = (e) => {
  if (e.target.closest("[data-row]")) action("edit");
};
$("#table-area").onkeydown = (e) => {
  if (["ArrowDown", "ArrowUp"].includes(e.key) && rows.length) {
    e.preventDefault();
    const index = rows.findIndex((r) => r.reference === selected),
      next = Math.max(
        0,
        Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)),
      ),
      area = $("#table-area");
    selectRow(rows[next].reference);
    if (next * 28 < area.scrollTop) area.scrollTop = next * 28;
    else if ((next + 1) * 28 > area.scrollTop + area.clientHeight - 29)
      area.scrollTop = (next + 1) * 28 - area.clientHeight + 29;
    renderTable();
  }
  if (e.key === "Enter") action("edit");
};
$("#table-area").oncontextmenu = (e) => {
  const r = e.target.closest("[data-row]");
  if (r) {
    e.preventDefault();
    selectRow(r.dataset.row);
    api.context({
      kind: ["model", "controls", "simulation", "datasets"].includes(tab) ? "point" : tab,
      reference: selected,
    });
  }
};
$("#tree").oncontextmenu = (e) => {
  const r = e.target.closest("[data-scope]");
  if (r) {
    e.preventDefault();
    scope = r.dataset.scope;
    selected = scope;
    tab = "model";
    renderTree();
    renderTabs();
    renderView();
    api.context({ kind: "point", reference: selected });
  }
};
$("#filter").oninput = () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    $("#table-area").scrollTop = 0;
    renderView();
  }, 120);
};
let treeFilterTimer;
$("#tree-search").oninput = () => {
  clearTimeout(treeFilterTimer);
  treeFilterTimer = setTimeout(renderTree, 120);
};
$("#dismiss-error").onclick = () => ($("#error-banner").hidden = true);
for (const id of ["log-level", "log-category"])
  $("#" + id).onchange = () => {
    lastLogSequence = -1;
    renderLogs();
  };
$("#pause-log").onclick = () => {
  paused = !paused;
  $("#pause-log").textContent = paused ? "恢复滚动" : "暂停滚动";
  lastLogSequence = -1;
  renderLogs();
};
$("#clear-log").onclick = () => {
  clearBefore = state.events?.at(-1)?.sequence || 0;
  lastLogSequence = -1;
  renderLogs();
};
$("#dialog-close").onclick = $("#dialog-cancel").onclick = () =>
  $("#dialog").close();
$("#dialog-form").onsubmit = async (e) => {
  e.preventDefault();
  $("#dialog-ok").disabled = true;
  try {
    await dialogSubmit(new FormData(e.target));
    $("#dialog").close();
  } catch (error) {
    $("#dialog-error").textContent = error.message;
  } finally {
    $("#dialog-ok").disabled = false;
  }
};
$("#table-area").onscroll = () => {
  if (!scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      renderTable();
    });
};
new ResizeObserver(() => {
  renderTable(true);
}).observe($("#table-area"));
for (const bar of document.querySelectorAll("[data-split]"))
  bar.onpointerdown = (e) => {
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    const type = bar.dataset.split;
    bar.onpointermove = (event) => {
      let size =
        type === "left"
          ? event.clientX
          : type === "right"
            ? innerWidth - event.clientX
            : innerHeight - event.clientY - 25;
      size = Math.max(
        type === "bottom" ? 95 : 180,
        Math.min(
          size,
          type === "bottom" ? innerHeight * 0.45 : innerWidth * 0.32,
        ),
      );
      document.documentElement.style.setProperty("--" + type, size + "px");
    };
    bar.onpointerup = () => {
      bar.classList.remove("dragging");
      bar.onpointermove = null;
      localStorage.setItem(
        "layout",
        JSON.stringify(
          Object.fromEntries(
            ["left", "right", "bottom"].map((k) => [
              k,
              document.documentElement.style.getPropertyValue("--" + k),
            ]),
          ),
        ),
      );
    };
  };
try {
  const layout = JSON.parse(localStorage.getItem("layout") || "{}");
  for (const [k, v] of Object.entries(layout))
    if (/^\d+(\.\d+)?px$/.test(v))
      document.documentElement.style.setProperty("--" + k, v);
} catch {
  /* Reset malformed saved layout. */
}
api.on("project", take);
api.on("action", action);
api.on("backend-error", showError);
api.on("state", (s) => {
  const previous = state;
  state = s;
  liveIndex = new Map((s.points || []).map((p) => [p.reference, p]));
  if (!project) return;
  const point = liveIndex.get(selected);
  if (point) {
    const h = history.get(selected) || [];
    h.push(point.value);
    if (h.length > 80) h.shift();
    history.set(selected, h);
  }
  renderState();
  if (["model", "controls", "simulation", "datasets"].includes(tab)) {
    if (["value", "quality", "timestamp", "blocked"].includes(sortKey)) {
      for (const r of rows) Object.assign(r, liveIndex.get(r.reference) || {});
      renderView();
    } else updateLiveCells();
  } else if (
    (tab === "reports" &&
      JSON.stringify(previous.reports) !== JSON.stringify(s.reports)) ||
    (tab === "sessions" &&
      JSON.stringify(previous.sessions) !== JSON.stringify(s.sessions))
  )
    renderView();
});
call("bootstrap")
  .then(take)
  .catch((e) => showError(e.message));

export { take, selectRow };

function configureWaveform() {
  const p = current();
  modal("配置点位仿真", `<p>${esc(p.reference)}</p><div class="form-grid">${select("waveform", "波形", p.waveform || "constant", Object.entries(waveNames))}${field("base", "基准值", p.base ?? p.value, "number", 'step="any" required')}${field("amplitude", "幅值", p.amplitude || 1, "number", 'step="any" required')}${field("period", "周期 / 秒", p.period || 10, "number", 'min="0.2" step="0.1" required')}</div><p class="hint">保存后点击启动仿真。控制输出不参与自动波形。</p>`, async (data) => {
    await call("simulation-config", { reference: p.reference, waveform: data.get("waveform"), base: Number(data.get("base")), amplitude: Number(data.get("amplitude")), period: Number(data.get("period")) });
    take(await call("refresh"));
  });
}
