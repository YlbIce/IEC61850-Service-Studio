export function createAttributeView({ $, call, esc, types, time }) {
  let attributeSnapshot = null,
    attributeCollapsed = new Set(),
    attributeRequest = 0;
  async function openAttributes(reference) {
    if (!reference) throw new Error("请选择一个数据对象");
    attributeSnapshot = { reference, nodes: [] };
    attributeCollapsed.clear();
    $("#attributes-reference").textContent = reference;
    $("#attributes-tree").innerHTML = '<div class="empty">正在读取属性…</div>';
    $("#attributes-dialog").showModal();
    await refreshAttributes();
  }
  async function refreshAttributes() {
    const request = ++attributeRequest,
      reference = attributeSnapshot.reference;
    $("#attributes-refresh").disabled = true;
    $("#attributes-error").textContent = "";
    try {
      const result = await call("object-attributes", reference);
      if (request !== attributeRequest || !$("#attributes-dialog").open) return;
      attributeSnapshot = result;
      renderAttributes();
    } catch (e) {
      if (request === attributeRequest)
        $("#attributes-error").textContent = e.message;
    } finally {
      if (request === attributeRequest)
        $("#attributes-refresh").disabled = false;
    }
  }
  function renderAttributes() {
    const { nodes, read_at } = attributeSnapshot;
    if (!nodes.length) return;
    let hiddenDepth = null;
    const body = [];
    nodes.forEach((n, i) => {
      if (hiddenDepth !== null) {
        if (n.depth > hiddenDepth) return;
        hiddenDepth = null;
      }
      const branch = nodes[i + 1]?.depth > n.depth,
        isClosed = attributeCollapsed.has(i);
      body.push(
        `<tr role="row" data-attribute="${i}" aria-level="${n.depth - nodes[0].depth + 1}" ${branch ? `aria-expanded="${!isClosed}"` : ""}><td title="${esc(n.reference)}" class="attribute-name"><span style="padding-left:${(n.depth - nodes[0].depth) * 18}px"><button class="attribute-toggle" data-attribute-toggle="${i}" ${branch ? "" : "disabled"} aria-label="${isClosed ? "展开" : "折叠"} ${esc(n.name)}">${branch ? (isClosed ? "▸" : "▾") : ""}</button><span class="tree-icon ${n.kind}">${n.kind}</span> ${esc(n.name)}</span></td><td>${esc(n.fc || "—")}</td><td>${esc(n.kind === "DA" ? types[Number(n.type)] || n.type : "数据对象")}</td><td class="attribute-value" title="${esc(n.value)}">${esc(n.value || "—")}</td></tr>`,
      );
      if (branch && isClosed) hiddenDepth = n.depth;
    });
    $("#attributes-tree").innerHTML =
      `<table role="treegrid" aria-label="数据对象属性树"><colgroup><col style="width:36%"><col style="width:9%"><col style="width:18%"><col style="width:37%"></colgroup><thead><tr><th>属性树</th><th>FC</th><th>类型</th><th>当前值</th></tr></thead><tbody>${body.join("")}</tbody></table>`;
    $("#attributes-status").textContent =
      `${nodes.filter((n) => n.kind === "DA").length} 个数据属性 · 读取时间 ${time(read_at)} · 点击“刷新值”更新`;
  }
  $("#attributes-close").onclick = $("#attributes-done").onclick = () =>
    $("#attributes-dialog").close();
  $("#attributes-dialog").onclose = () => {
    attributeRequest++;
    $("#attributes-refresh").disabled = false;
  };
  $("#attributes-refresh").onclick = refreshAttributes;
  $("#attributes-expand").onclick = () => {
    attributeCollapsed.clear();
    renderAttributes();
  };
  $("#attributes-collapse").onclick = () => {
    attributeCollapsed = new Set(
      attributeSnapshot.nodes
        .map((n, i) =>
          i > 0 && attributeSnapshot.nodes[i + 1]?.depth > n.depth ? i : -1,
        )
        .filter((i) => i >= 0),
    );
    renderAttributes();
  };
  $("#attributes-tree").onclick = (e) => {
    const b = e.target.closest("[data-attribute-toggle]");
    if (b && !b.disabled) {
      const i = Number(b.dataset.attributeToggle);
      if (attributeCollapsed.has(i)) attributeCollapsed.delete(i);
      else attributeCollapsed.add(i);
      renderAttributes();
    }
  };

  return { open: openAttributes };
}
