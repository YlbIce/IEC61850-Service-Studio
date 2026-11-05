export function createProtocolDialogs({
  $,
  call,
  esc,
  field,
  select,
  check,
  modal,
  replace,
  getProject,
  getState,
}) {
  const stopped = () => {
    if (getState().running) throw new Error("请先停止服务，再修改协议配置");
  };
  const error = (e) => {
    $("#dialog-error").textContent = e.message;
  };
  function tls() {
    stopped();
    const config = getProject().tls || {};
    const credential = (name, label) =>
      `<label class="wide">${label}<div class="path-picker"><input name="${name}" value="${esc(config[name] || "")}"><button type="button" data-credential="${name}">浏览…</button></div></label>`;
    modal(
      "TLS 安全通信",
      `<div class="form-grid">${check("enabled", "启用 MMS 双向 TLS", config.enabled)}${check("tls13_only", "仅允许 TLS 1.3", config.tls13_only)}${credential("certificate", "服务端证书 / 证书链 PEM")}${credential("private_key", "服务端私钥 PEM")}${credential("ca", "可信客户端 CA PEM")}${credential("crl", "证书吊销列表 CRL（可选）")}${credential("peer_certificate", "限定客户端证书（可选，仍校验 CA）")}</div><p class="hint">双方必须提供有效证书。默认允许 TLS 1.2 / 1.3，验证证书链、有效期与已配置的 CRL。私钥文件路径随工程保存，私钥内容不写入工程。TLS 监听端口请在服务配置中设置，常用端口 3782。</p>`,
      async (data) => {
        await replace({
          ...getProject(),
          tls: {
            ...Object.fromEntries(data),
            enabled: data.has("enabled"),
            tls13_only: data.has("tls13_only"),
          },
        });
      },
      "应用",
    );
    for (const button of document.querySelectorAll("[data-credential]"))
      button.onclick = async () => {
        try {
          const file = await call("choose-certificate");
          if (file) $(`[name="${button.dataset.credential}"]`).value = file;
        } catch (e) {
          error(e);
        }
      };
  }
  async function publishers() {
    const state = getState(),
      configs = getProject().publishers || [];
    const envelope = await call("bootstrap"),
      templates = envelope.model.publisher_templates || [];
    modal(
      "GOOSE / SV 发布管理",
      `<div class="dialog-toolbar"><button type="button" id="publisher-add" ${state.running ? "disabled" : ""}>新建发布流…</button><button type="button" id="publisher-template" ${state.running || !templates.length ? "disabled" : ""}>从模型控制块添加…</button><button type="button" id="publisher-refresh">刷新统计</button></div><div class="protocol-list"><table><thead><tr><th>流 / 类型</th><th>数据集</th><th>状态</th><th>提交帧数</th><th>漏过采样期限</th><th>操作</th></tr></thead><tbody>${
        configs
          .map((c, i) => {
            const live = state.publishers?.find((s) => s.name === c.name);
            return `<tr><td>${esc(c.name)} / ${esc(c.kind)}</td><td>${esc(c.dataset)}</td><td>${esc(live?.error || (live?.running ? "发布中" : c.enabled ? "随服务启动" : "禁用"))}</td><td>${live?.frames || 0}</td><td>${live?.late || 0}</td><td><button type="button" data-publisher="${i}" ${state.running ? "disabled" : ""}>编辑…</button><button type="button" data-publisher-delete="${i}" ${state.running ? "disabled" : ""}>删除</button></td></tr>`;
          })
          .join("") || '<tr><td colspan="6">尚未配置发布流</td></tr>'
      }</tbody></table></div><p class="hint">发布使用所选以太网卡，需要 Npcap。GOOSE 在数据变化后快速重传，再退避到最大周期。SV 使用独立采样调度，smpSynch=0；桌面操作系统不保证实时采样，漏过期限会记录。帧数表示已提交给网卡驱动，接收端应抓包确认。</p>`,
      async () => {},
      "关闭",
    );
    $("#publisher-add").onclick = () => editPublisher().catch(error);
    $("#publisher-template").onclick = () => {
      modal(
        "从模型控制块添加发布流",
        select(
          "template",
          "模型中的控制块",
          0,
          templates.map((p, i) => [i, `${p.kind} · ${p.control_ref}`]),
        ) +
          '<p class="hint">导入参数作为配置初值。请检查网卡、SV 采样率及帧布局，再启用发布。</p>',
        async (data) => {
          const preset = templates[Number(data.get("template"))];
          setTimeout(() => editPublisher(-1, preset).catch(error), 0);
        },
        "编辑配置…",
      );
    };
    $("#publisher-refresh").onclick = async () => {
      try {
        await call("refresh");
        $("#dialog").close();
        await publishers();
      } catch (e) {
        error(e);
      }
    };
    for (const b of document.querySelectorAll("[data-publisher]"))
      b.onclick = () => editPublisher(Number(b.dataset.publisher)).catch(error);
    for (const b of document.querySelectorAll("[data-publisher-delete]"))
      b.onclick = async () => {
        try {
          stopped();
          const next = structuredClone(getProject());
          next.publishers.splice(Number(b.dataset.publisherDelete), 1);
          await replace(next);
          $("#dialog").close();
          await publishers();
        } catch (e) {
          error(e);
        }
      };
  }
  async function editPublisher(index = -1, preset = null) {
    stopped();
    const project = getProject();
    const [{ interfaces }, envelope] = await Promise.all([
      call("interfaces"),
      call("bootstrap"),
    ]);
    const sets = project.source
      ? envelope.model.datasets.map(
          (d) =>
            `${d.ld.startsWith(project.ied_name) ? "" : project.ied_name}${d.ld}/${d.name}`,
        )
      : project.datasets.map(
          (d) => `${project.ied_name}${d.ld}/${d.ln}$${d.name}`,
        );
    const config = preset ||
      project.publishers?.[index] || {
        name: `Publisher${(project.publishers?.length || 0) + 1}`,
        kind: "GOOSE",
        enabled: false,
        interface_id: "",
        destination: "01:0c:cd:01:00:01",
        app_id: 1000,
        vlan_id: 0,
        priority: 4,
        vlan: true,
        dataset: sets[0] || "",
        control_ref: `${project.ied_name}LD0/LLN0$GO$Goose1`,
        conf_rev: 1,
        min_ms: 4,
        max_ms: 1000,
        sample_rate: 80,
        sv_id: "StudioSV1",
      };
    modal(
      index < 0 ? "新建发布流" : "编辑发布流",
      `<div class="form-grid">${field("name", "名称 / goID", config.name, "text", 'required maxlength="64"')}${select(
        "kind",
        "发布协议",
        config.kind,
        [
          ["GOOSE", "GOOSE"],
          ["SV", "Sampled Values"],
        ],
      )}${select("interface_id", "以太网卡", config.interface_id, [["", "请选择网卡"], ...interfaces.map((d) => [d.id, d.description])])}${select(
        "dataset",
        "数据集引用",
        config.dataset,
        sets.map((s) => [s, s]),
      )}${field("destination", "组播目的 MAC", config.destination, "text", "required")}${field("app_id", "APPID（十进制）", config.app_id, "number", 'min="0" max="65535" required')}${check("enabled", "随 MMS 服务启用此发布流", config.enabled)}${check("vlan", "携带 802.1Q VLAN 标签", config.vlan)}${field("vlan_id", "VLAN ID", config.vlan_id, "number", 'min="0" max="4094" required')}${field("priority", "VLAN 优先级", config.priority, "number", 'min="0" max="7" required')}${field("conf_rev", "ConfRev", config.conf_rev, "number", 'min="1" required')}${field("control_ref", "GOOSE 控制块引用", config.control_ref)}${field("min_ms", "GOOSE 最小重传 / ms", config.min_ms, "number", 'min="1" required')}${field("max_ms", "GOOSE 最大重传 / ms", config.max_ms, "number", 'min="1" max="60000" required')}${field("sv_id", "SV 流标识 svID", config.sv_id)}${field("sample_rate", "SV 每秒采样数", config.sample_rate, "number", 'min="1" max="4800" required')}</div><p class="hint">SV 顺序展开数据集的叶属性：BOOLEAN 1 字节；INT32 / UINT32 / FLOAT32 / QUALITY 4 字节；INT64 / FLOAT64 / TIMESTAMP 8 字节。接收端应使用相同数据集布局。变更成员或编码后请递增 ConfRev。</p>`,
      async (data) => {
        const value = Object.fromEntries(data);
        for (const k of [
          "app_id",
          "vlan_id",
          "priority",
          "conf_rev",
          "min_ms",
          "max_ms",
          "sample_rate",
        ])
          value[k] = Number(value[k]);
        value.enabled = data.has("enabled");
        value.vlan = data.has("vlan");
        const next = structuredClone(getProject());
        next.publishers ||= [];
        if (index < 0) next.publishers.push(value);
        else next.publishers[index] = value;
        await replace(next);
      },
      "应用",
    );
  }
  async function settings() {
    const state = await call("setting-banks");
    modal(
      "定值组管理",
      `<p class="hint">确认的定值和激活组号自动持久化。MMS 客户端通过 EditSG / SE / CnfEdit 编辑；已有客户端预约时，桌面修改会被拒绝。</p><div id="setting-content"></div>`,
      async () => {},
      "关闭",
    );
    if (state.error) error(new Error(state.error));
    if (!state.devices.length) {
      $("#setting-content").textContent =
        "当前模型没有 SGCB 和 SG / SE 定值。请导入包含定值组的 ICD / CID / CFG 文件。";
      return;
    }
    $("#setting-content").innerHTML = `<div class="form-grid">${select(
      "setting-device",
      "逻辑设备 / 控制块",
      0,
      state.devices.map((d, i) => [i, d.reference]),
    )}<label>定值组<select name="setting-bank"></select></label></div><div class="dialog-toolbar"><button type="button" id="setting-activate">激活此组</button><button type="button" id="setting-refresh">重新读取</button></div><div class="protocol-list" id="setting-values"></div>`;
    const device = () =>
      state.devices[Number($("[name=setting-device]").value)];
    const bank = () =>
      device().banks.find(
        (b) => b.number === Number($("[name=setting-bank]").value),
      );
    function render() {
      const d = device(),
        b = bank();
      $("#setting-activate").disabled = d.active === b.number;
      $("#setting-values").innerHTML =
        `<table><thead><tr><th>属性引用</th><th>值</th><th>操作</th></tr></thead><tbody>${b.values.map((v, i) => `<tr><td>${esc(v.reference)}</td><td>${esc(v.value)}</td><td><button type="button" data-setting="${i}">修改…</button></td></tr>`).join("")}</tbody></table>`;
      for (const button of document.querySelectorAll("[data-setting]"))
        button.onclick = () => {
          const value = b.values[Number(button.dataset.setting)];
          modal(
            "修改持久化定值",
            `<p class="hint">${esc(d.reference)} · 第 ${b.number} 组</p><p>${esc(value.reference)}</p>${field("value", "新值", value.value, "text", "required")}`,
            async (data) => {
              await call("change-setting", {
                reference: d.reference,
                bank: b.number,
                attribute: value.reference,
                value: data.get("value"),
              });
            },
          );
        };
    }
    function choose() {
      $("[name=setting-bank]").innerHTML = device()
        .banks.map(
          (b) =>
            `<option value="${b.number}">${b.number}${b.number === device().active ? " · 当前激活" : ""}</option>`,
        )
        .join("");
      render();
    }
    $("[name=setting-device]").onchange = choose;
    $("[name=setting-bank]").onchange = render;
    choose();
    $("#setting-activate").onclick = async () => {
      try {
        await call("change-setting", {
          reference: device().reference,
          bank: bank().number,
          activate: true,
        });
        $("#dialog").close();
        await settings();
      } catch (e) {
        error(e);
      }
    };
    $("#setting-refresh").onclick = async () => {
      try {
        $("#dialog").close();
        await settings();
      } catch (e) {
        error(e);
      }
    };
  }
  return { tls, publishers, settings };
}
