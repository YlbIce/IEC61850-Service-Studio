export function createVirtualTable({ element, esc, getContext }) {
  let tableStart = -1;
  function renderTable(force = false) {
    const {
      rows,
      columns,
      tab,
      sortKey,
      ascending,
      selected,
      liveIndex,
      project,
    } = getContext();
    if (["files", "help"].includes(tab)) return;
    const area = element,
      top = area.scrollTop,
      left = area.scrollLeft;
    const start = Math.min(
      Math.max(0, rows.length - 1),
      Math.max(0, Math.floor((top - 29) / 28) - 8),
    );
    if (!force && start === tableStart) return;
    tableStart = start;
    const end = Math.min(
        rows.length,
        start + Math.ceil(area.clientHeight / 28) + 18,
      ),
      span = columns.length + 1;
    const spacer = (h) =>
      h
        ? `<tr aria-hidden="true"><td colspan="${span}" style="height:${h}px;padding:0;border:0"></td></tr>`
        : "";
    area.innerHTML = rows.length
      ? `<table><thead><tr><th style="width:38px">#</th>${columns.map((c) => `<th data-sort="${c.key}">${c.label}${sortKey === c.key ? (ascending ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${spacer(start * 28)}${rows
          .slice(start, end)
          .map((r, j) => {
            if (["model", "controls", "simulation"].includes(tab))
              Object.assign(r, liveIndex.get(r.reference) || {});
            return `<tr data-row="${esc(r.reference)}" class="${selected === r.reference ? "selected" : ""}"><td class="subtle">${start + j + 1}</td>${columns.map((c) => `<td data-column="${c.key}" class="${c.key === "reference" ? "ref" : c.key === "value" ? "value" : ""}" title="${esc(Array.isArray(r[c.key]) ? r[c.key].join("\n") : (r[c.key] ?? ""))}">${c.format ? c.format(r[c.key], r) : esc(r[c.key] ?? "—")}</td>`).join("")}</tr>`;
          })
          .join("")}${spacer((rows.length - end) * 28)}</tbody></table>`
      : `<div class="empty"><strong>${tab === "sessions" ? "暂无客户端连接" : "没有匹配的对象"}</strong>${tab === "sessions" ? `启动服务后，使用客户端连接 ${esc(project.host)}:${project.port}。` : "清除筛选条件，或通过工具栏新增、导入模型。"}</div>`;
    area.scrollTop = top;
    area.scrollLeft = left;
  }

  return { render: renderTable };
}
