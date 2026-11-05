"use strict";
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
function pointKey(p) {
  return `${p.ld}/${p.ln}.${p.name}`;
}
function defaultProject() {
  const point = (ld, ln, name, cdc, value, description, extra = {}) => ({
    ld,
    ln,
    name,
    cdc,
    value,
    description,
    quality: 0,
    control_model: 1,
    blocked: false,
    waveform: "constant",
    amplitude: 1,
    period: 10,
    ...extra,
  });
  return {
    version: 1,
    name: "变电站联调工程",
    ied_name: "STUDIO",
    host: "127.0.0.1",
    port: 102,
    storage_id: require("node:crypto").randomUUID(),
    publishers: [],
    tls: { enabled: false },
    max_clients: 8,
    allow_controls: true,
    file_service: false,
    file_root: "",
    points: [
      point("LD0", "LLN0", "Health", "INS", 1, "装置健康状态"),
      point("LD0", "GGIO1", "AnIn1", "MV", 220, "A 相电压 / V", {
        waveform: "sine",
        amplitude: 5,
      }),
      point("LD0", "GGIO1", "AnIn2", "MV", 220, "B 相电压 / V", {
        waveform: "sine",
        amplitude: 4,
        period: 12,
      }),
      point("LD0", "GGIO1", "AnIn3", "MV", 220, "C 相电压 / V", {
        waveform: "sine",
        amplitude: 3,
        period: 14,
      }),
      point("LD0", "GGIO1", "AnIn4", "MV", 50, "系统频率 / Hz", {
        waveform: "sine",
        amplitude: 0.05,
        period: 20,
      }),
      point("LD0", "GGIO1", "Ind1", "SPS", 0, "告警输入"),
      point("LD0", "GGIO1", "SPCSO1", "SPC", 0, "直接控制输出"),
      point("LD0", "GGIO1", "SPCSO2", "SPC", 0, "SBO 增强控制输出", {
        control_model: 4,
      }),
      point("LD0", "XCBR1", "Pos", "DPC", 1, "断路器位置 · 分位", {
        control_model: 4,
      }),
      point("LD0", "GGIO1", "IntIn1", "INS", 0, "累计动作次数"),
    ],
    datasets: [
      {
        ld: "LD0",
        ln: "LLN0",
        name: "Measurements",
        members: [
          "LD0/GGIO1.AnIn1",
          "LD0/GGIO1.AnIn2",
          "LD0/GGIO1.AnIn3",
          "LD0/GGIO1.AnIn4",
        ],
      },
      {
        ld: "LD0",
        ln: "LLN0",
        name: "Events",
        members: [
          "LD0/GGIO1.Ind1",
          "LD0/GGIO1.SPCSO1",
          "LD0/GGIO1.SPCSO2",
          "LD0/XCBR1.Pos",
        ],
      },
    ],
    reports: [
      {
        ld: "LD0",
        ln: "LLN0",
        name: "Measurements01",
        dataset: "Measurements",
        buffered: false,
        integrity_ms: 5000,
        buffer_ms: 100,
        triggers: 27,
        conf_rev: 1,
      },
      {
        ld: "LD0",
        ln: "LLN0",
        name: "Events01",
        dataset: "Events",
        buffered: true,
        integrity_ms: 10000,
        buffer_ms: 50,
        triggers: 27,
        conf_rev: 1,
      },
    ],
  };
}
function validateProject(p) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!p || typeof p !== "object" || Array.isArray(p))
    return ["工程必须是 JSON 对象"];
  if (p.version !== 1) fail("不支持的工程版本");
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 100)
    fail("工程名称需要 1–100 个字符");
  if (
    !(p.source ? /^[A-Za-z][A-Za-z0-9_]{0,63}$/ : identifier).test(p.ied_name)
  )
    fail("IED 名称必须以字母开头；工程名称最长 32 位，导入名称最长 64 位");
  if (
    typeof p.host !== "string" ||
    !/^\d{1,3}(\.\d{1,3}){3}$/.test(p.host) ||
    p.host.split(".").some((x) => Number(x) > 255)
  )
    fail("监听地址必须是有效 IPv4 地址");
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535)
    fail("端口范围为 1–65535");
  if (
    !Number.isInteger(p.max_clients) ||
    p.max_clients < 1 ||
    p.max_clients > 32
  )
    fail("最大连接数范围为 1–32");
  for (const k of ["allow_controls", "file_service"])
    if (typeof p[k] !== "boolean") fail(`${k} 必须为布尔值`);
  if (typeof p.file_root !== "string" || (p.file_service && !p.file_root))
    fail("启用文件服务时必须选择目录");
  if (
    p.tls?.enabled &&
    ["certificate", "private_key", "ca"].some(
      (k) => typeof p.tls[k] !== "string" || !p.tls[k],
    )
  )
    fail("TLS 需要服务证书、私钥和可信 CA");
  if (
    p.publishers !== undefined &&
    (!Array.isArray(p.publishers) || p.publishers.length > 16)
  )
    fail("最多配置 16 个发布流");
  if (Array.isArray(p.publishers))
    for (const x of p.publishers) {
      if (
        !x ||
        !["GOOSE", "SV"].includes(x.kind) ||
        !x.name ||
        !x.dataset ||
        !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(x.destination || "")
      ) {
        fail("发布流名称、类型、数据集或 MAC 无效");
        continue;
      }
      if (x.enabled && !x.interface_id) fail("启用发布前必须选择网卡");
      for (const [k, min, max] of [
        ["app_id", 0, 65535],
        ["vlan_id", 0, 4094],
        ["priority", 0, 7],
        ["conf_rev", 1, 2147483647],
      ])
        if (!Number.isInteger(x[k]) || x[k] < min || x[k] > max)
          fail("发布参数 " + k + " 超出范围");
      if (
        x.kind === "GOOSE" &&
        (!x.control_ref ||
          !Number.isInteger(x.min_ms) ||
          x.min_ms < 1 ||
          !Number.isInteger(x.max_ms) ||
          x.max_ms < x.min_ms ||
          x.max_ms > 60000)
      )
        fail("GOOSE 重传周期或控制块引用无效");
      if (
        x.kind === "SV" &&
        (!x.sv_id ||
          !Number.isInteger(x.sample_rate) ||
          x.sample_rate < 1 ||
          x.sample_rate > 4800)
      )
        fail("SV 需要 svID 和 1–4800/s 采样率");
    }
  if (p.source) {
    if (
      typeof p.source.cfg !== "string" ||
      !p.source.cfg.trim() ||
      p.source.cfg.length > 8 * 1024 * 1024
    )
      fail("导入模型缺少 CFG 内容或超过 8 MB");
    return errors;
  }
  for (const name of ["points", "datasets", "reports"])
    if (!Array.isArray(p[name])) fail(`${name} 必须为数组`);
  if (!["points", "datasets", "reports"].every((k) => Array.isArray(p[k])))
    return errors;
  if (!p.points.length || p.points.length > 10000)
    fail("工程需要 1–10000 个点位");
  if (p.datasets.length > 128 || p.reports.length > 128)
    fail("数据集和报告各最多 128 个");
  const keys = new Set();
  for (const x of p.points) {
    if (!x || !["ld", "ln", "name"].every((k) => identifier.test(x[k]))) {
      fail("点位标识不合法");
      continue;
    }
    const key = pointKey(x);
    if (keys.has(key)) fail(`重复点位：${key}`);
    keys.add(key);
    if (!["MV", "SPS", "INS", "SPC", "DPC"].includes(x.cdc))
      fail(`${key} CDC 不支持`);
    if (!Number.isFinite(x.value) || Math.abs(x.value) > 1e30)
      fail(`${key} 数值无效`);
    if (["SPS", "SPC"].includes(x.cdc) && ![0, 1].includes(x.value))
      fail(`${key} 需要 0 或 1`);
    if (x.cdc === "DPC" && ![0, 1, 2, 3].includes(x.value))
      fail(`${key} 双点状态需要 0–3`);
    if (
      x.cdc === "INS" &&
      (!Number.isInteger(x.value) ||
        x.value < -2147483648 ||
        x.value > 2147483647)
    )
      fail(`${key} 整数超出 INT32 范围`);
    if (!Number.isInteger(x.quality) || x.quality < 0 || x.quality > 8191)
      fail(`${key} 品质位需要 0–8191`);
    if (
      ["SPC", "DPC"].includes(x.cdc) &&
      ![1, 2, 3, 4].includes(x.control_model)
    )
      fail(`${key} 控制模型需要 1–4`);
    if (
      !["constant", "sine", "ramp", "square"].includes(x.waveform) ||
      !Number.isFinite(x.period) ||
      x.period < 0.2 ||
      !Number.isFinite(x.amplitude) ||
      Math.abs(x.amplitude) > 1e20
    )
      fail(`${key} 波形参数无效`);
  }
  const sets = new Set(),
    reports = new Set();
  for (const d of p.datasets) {
    if (!d || !["ld", "ln", "name"].every((k) => identifier.test(d[k]))) {
      fail("数据集标识不合法");
      continue;
    }
    const key = pointKey(d);
    if (sets.has(key)) fail(`重复数据集：${key}`);
    sets.add(key);
    if (
      !Array.isArray(d.members) ||
      !d.members.length ||
      d.members.length > 256
    )
      fail(`${key} 需要 1–256 个成员`);
    else
      for (const m of d.members)
        if (!keys.has(m) || !m.startsWith(d.ld + "/"))
          fail(`${key} 无效成员：${m}`);
  }
  for (const r of p.reports) {
    if (!r || !["ld", "ln", "name"].every((k) => identifier.test(r[k]))) {
      fail("报告标识不合法");
      continue;
    }
    const key = pointKey(r);
    if (reports.has(key)) fail(`重复报告：${key}`);
    reports.add(key);
    if (!sets.has(`${r.ld}/${r.ln}.${r.dataset}`))
      fail(`${key} 关联数据集不存在`);
    for (const [k, max] of [
      ["integrity_ms", 86400000],
      ["buffer_ms", 60000],
      ["triggers", 31],
      ["conf_rev", 2147483647],
    ])
      if (
        !Number.isInteger(r[k]) ||
        r[k] < (k === "conf_rev" ? 1 : 0) ||
        r[k] > max
      )
        fail(`${key} ${k} 超出范围`);
  }
  return errors;
}
function assertProject(p) {
  const errors = validateProject(p);
  if (errors.length) throw new Error(errors.join("\n"));
  return p;
}
module.exports = { defaultProject, validateProject, assertProject, pointKey };
