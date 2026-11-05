export function createEditors({
  getContext,
  setSelected,
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
}) {
  function editPoint(add = false) {
    const { project, state, tab } = getContext();
    requireEditable();
    const old = add ? null : current();
    const p = old || {
      ld: "LD0",
      ln: "GGIO1",
      name: "AnIn" + (project.points.length + 1),
      cdc: "MV",
      value: 0,
      quality: 0,
      description: "",
      control_model: 1,
      blocked: false,
      waveform: "constant",
      amplitude: 1,
      period: 10,
    };
    // Editing uses engineering initial value, not the transient live sample.
    const spec = old
      ? project.points.find((x) => project.ied_name + key(x) === old.reference)
      : p;
    modal(
      add ? "新增数据点位" : "编辑点位配置",
      `<div class="form-grid">${field("ld", "逻辑设备 LD", spec.ld, "text", "required")}${field("ln", "逻辑节点 LN", spec.ln, "text", "required")}${field("name", "数据对象名称", spec.name, "text", "required")}${select(
        "cdc",
        "公共数据类 CDC",
        spec.cdc,
        ["MV", "SPS", "INS", "SPC", "DPC"].map((x) => [x, x]),
      )}${field("value", "初始值", spec.value, "number", 'step="any" required')}${field("quality", "品质位（0–8191）", spec.quality, "number", 'min="0" max="8191" required')}${field("description", "描述", spec.description)}${select("control_model", "控制模型（SPC / DPC）", spec.control_model, Object.entries(controlNames))}${select("waveform", "仿真波形", spec.waveform, Object.entries(waveNames))}${field("amplitude", "幅值", spec.amplitude, "number", 'step="any" required')}${field("period", "周期 / 秒", spec.period, "number", 'step="0.1" min="0.2" required')}${check("blocked", "闭锁远方遥控", spec.blocked)}</div><p class="hint">MV = 浮点遥测；SPS / SPC = 0 或 1；DPC = 0 中间态 / 1 分位 / 2 合位 / 3 不确定。控制输出不参与自动波形。</p>`,
      async (data) => {
        const next = structuredClone(project),
          x = { ...spec, ...Object.fromEntries(data) };
        for (const k of [
          "value",
          "quality",
          "control_model",
          "amplitude",
          "period",
        ])
          x[k] = Number(x[k]);
        x.blocked = data.has("blocked");
        if (add) next.points.push(x);
        else {
          const idx = next.points.findIndex((v) => key(v) === key(spec));
          next.points[idx] = x;
          for (const d of next.datasets)
            d.members = d.members.map((m) => (m === key(spec) ? key(x) : m));
        }
        await replace(next);
      },
    );
  }
  function updateValue() {
    const { project, state, tab } = getContext();
    const p = current();
    if (!points().some((v) => v.reference === p.reference))
      throw new Error(
        "此对象没有可修改的标准 value / q / t 点位，请选择数据模型中的点位",
      );
    modal(
      "修改运行值与品质",
      `<p class="hint">${esc(p.reference)}</p><div class="form-grid">${field("value", "运行值", p.value, "number", 'step="any" required')}${field("quality", "品质位（0–8191）", p.quality, "number", 'min="0" max="8191" required')}${check("blocked", "闭锁远方控制", p.blocked)}</div><p class="hint">此操作立即更新服务端缓存并触发已启用的报告。开启波形时，该值会被后续采样覆盖。品质位：0 Good、1 Invalid、4096 Test。</p>`,
      async (data) => {
        await call("update", {
          reference: p.reference,
          value: Number(data.get("value")),
          quality: Number(data.get("quality")),
          blocked: data.has("blocked"),
        });
        toast("运行值已更新");
      },
    );
  }
  function settings() {
    const { project, state, tab } = getContext();
    if (state.running) throw new Error("请先停止服务再修改监听配置");
    modal(
      "服务与工程配置",
      `<div class="form-grid">${field("name", "工程名称", project.name, "text", "required")}${field("ied_name", "IED 名称", project.ied_name, "text", project.source ? "disabled" : "required")}${field("host", "监听 IPv4 地址", project.host, "text", "required")}${field("port", "MMS TCP 端口", project.port, "number", 'min="1" max="65535" required')}${field("max_clients", "最大客户端连接", project.max_clients, "number", 'min="1" max="32" required')}${check("allow_controls", "允许远方控制（仍受点位闭锁限制）", project.allow_controls)}${check("file_service", "启用 MMS 文件服务", project.file_service)}<label class="wide">文件服务根目录<input name="file_root" value="${esc(project.file_root)}" readonly><button type="button" id="choose-folder">选择专用交换目录…</button></label></div><p class="hint">127.0.0.1 只允许本机联调；需要远程连接时选择本机网卡 IPv4 地址或 0.0.0.0。常规 MMS 端口为 102。</p>`,
      async (data) => {
        const next = {
          ...project,
          ...Object.fromEntries(data),
          allow_controls: data.has("allow_controls"),
          file_service: data.has("file_service"),
        };
        for (const k of ["port", "max_clients"]) next[k] = Number(next[k]);
        await replace(next);
      },
    );
    $("#choose-folder").onclick = async () => {
      try {
        const folder = await call("choose-folder");
        if (folder) $("#dialog-body [name=file_root]").value = folder;
      } catch (e) {
        $("#dialog-error").textContent = e.message;
      }
    };
  }
  function datasetDialog(add = false) {
    const { project, state, tab } = getContext();
    requireEditable();
    const old = add ? null : current(),
      d = old || {
        ld: "LD0",
        ln: "LLN0",
        name: "Dataset" + (project.datasets.length + 1),
        members: [],
      };
    modal(
      add ? "新建数据集" : "编辑数据集",
      `<div class="form-grid">${field("ld", "逻辑设备", d.ld, "text", "required")}${field("ln", "逻辑节点", d.ln, "text", "required")}${field("name", "数据集名称", d.name, "text", "required")}<label class="wide">成员引用（每行一个 LD/LN.DO）<textarea name="members" required>${esc(d.members.join("\n"))}</textarea></label></div><p class="hint">采用 FCD 成员，包含 value、q、t。成员需要位于同一逻辑设备。可用点位：${esc(project.points.map(key).join("，"))}</p>`,
      async (data) => {
        const x = Object.fromEntries(data);
        x.members = x.members
          .split(/\r?\n/)
          .map((v) => v.trim())
          .filter(Boolean);
        const next = structuredClone(project);
        if (add) next.datasets.push(x);
        else {
          next.datasets[next.datasets.findIndex((v) => key(v) === key(d))] = x;
          for (const r of next.reports)
            if (r.ld === d.ld && r.ln === d.ln && r.dataset === d.name) {
              r.ld = x.ld;
              r.ln = x.ln;
              r.dataset = x.name;
              r.conf_rev++;
            }
        }
        await replace(next);
      },
    );
  }
  function reportDialog(add = false) {
    const { project, state, tab } = getContext();
    requireEditable();
    const old = add ? null : current(),
      r = old || {
        ld: "LD0",
        ln: "LLN0",
        name: "Report" + (project.reports.length + 1),
        dataset: project.datasets[0]?.name || "",
        buffered: true,
        integrity_ms: 5000,
        buffer_ms: 100,
        triggers: 27,
        conf_rev: 1,
      };
    modal(
      add ? "新建报告控制块" : "编辑报告控制块",
      `<div class="form-grid">${field("ld", "逻辑设备", r.ld, "text", "required")}${field("ln", "逻辑节点", r.ln, "text", "required")}${field("name", "报告控制块名称", r.name, "text", "required")}${field("dataset", "同一 LN 的数据集名称", r.dataset, "text", "required")}${field("integrity_ms", "完整性周期 IntgPd / ms", r.integrity_ms, "number", 'min="0" max="86400000" required')}${field("buffer_ms", "缓冲时间 BufTm / ms", r.buffer_ms, "number", 'min="0" max="60000" required')}${field("triggers", "触发位 TrgOps", r.triggers, "number", 'min="0" max="31" required')}${field("conf_rev", "配置版本 ConfRev", r.conf_rev, "number", 'min="1" required')}${check("buffered", "缓冲报告 BRCB（不选为 URCB）", r.buffered)}</div><p class="hint">触发位：dchg=1、qchg=2、dupd=4、period=8、GI=16。典型值 27。客户端负责启用报告与发起 GI。</p>`,
      async (data) => {
        const x = Object.fromEntries(data);
        for (const k of ["integrity_ms", "buffer_ms", "triggers", "conf_rev"])
          x[k] = Number(x[k]);
        x.buffered = data.has("buffered");
        const next = structuredClone(project);
        if (add) next.reports.push(x);
        else next.reports[next.reports.findIndex((v) => key(v) === key(r))] = x;
        await replace(next);
      },
    );
  }
  async function deleteSelected() {
    const { project, state, tab } = getContext();
    requireEditable();
    const p = current();
    if (tab === "datasets" && !Array.isArray(p.members)) throw new Error("请选择数据集配置；成员对象请在数据模型页管理");
    if (!["model", "datasets", "reports"].includes(tab))
      throw new Error("请在数据模型、数据集或报告页删除配置");
    modal(
      "删除配置",
      `<p>删除 ${esc(p.reference)}？</p><p class="hint">被数据集或报告引用的对象需要先解除引用。此操作会重新加载已停止的模型。</p>`,
      async () => {
        const next = structuredClone(project);
        if (tab === "model") {
          const k = p.reference.slice(project.ied_name.length);
          if (next.datasets.some((d) => d.members.includes(k)))
            throw new Error("该点位被数据集引用，请先编辑数据集");
          next.points = next.points.filter((x) => key(x) !== k);
        } else if (tab === "datasets") {
          if (
            next.reports.some(
              (r) => r.ld === p.ld && r.ln === p.ln && r.dataset === p.name,
            )
          )
            throw new Error("该数据集被报告引用，请先删除或修改报告");
          next.datasets = next.datasets.filter((x) => key(x) !== key(p));
        } else next.reports = next.reports.filter((x) => key(x) !== key(p));
        await replace(next);
        setSelected("");
      },
      "删除",
    );
  }

  return {
    editPoint,
    updateValue,
    settings,
    datasetDialog,
    reportDialog,
    deleteSelected,
  };
}
