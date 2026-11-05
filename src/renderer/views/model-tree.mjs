// The navigator has the same bounded DOM contract as the data table.
export function createModelTree({ element, esc, getState }) {
  let visible = [],
    frame = 0,
    start = -1,
    currentModel,
    previousFilter,
    previousCollapsed;
  const rowHeight = 28;
  function render(force = true) {
    const { model, project, scope, collapsed, filter } = getState();
    const folding = [...collapsed].join("\n");
    if (
      model !== currentModel ||
      filter !== previousFilter ||
      folding !== previousCollapsed
    ) {
      currentModel = model;
      previousFilter = filter;
      previousCollapsed = folding;
      const nodes = model.nodes.filter((n) => n.kind !== "DA");
      visible = [
        {
          reference: "",
          name: model.ied_name || project.ied_name,
          kind: "IED",
          depth: -1,
          branch: false,
        },
      ];
      let hiddenDepth = null;
      nodes.forEach((n, i) => {
        if (!filter && hiddenDepth !== null) {
          if (n.depth > hiddenDepth) return;
          hiddenDepth = null;
        }
        if (filter && !n.reference.toLowerCase().includes(filter)) return;
        const branch = nodes[i + 1]?.depth > n.depth;
        visible.push({ ...n, branch });
        if (!filter && collapsed.has(n.reference)) hiddenDepth = n.depth;
      });
      force = true;
    }
    const top = element.scrollTop;
    const next = Math.max(
      0,
      Math.min(visible.length - 1, Math.floor(top / rowHeight) - 6),
    );
    if (!force && start === next) return;
    start = next;
    const end = Math.min(
      visible.length,
      start + Math.ceil(element.clientHeight / rowHeight) + 14,
    );
    element.innerHTML = `<div aria-hidden="true" style="height:${start * rowHeight}px"></div>${visible
      .slice(start, end)
      .map(
        (n) =>
          `<div class="tree-row ${scope === n.reference ? "selected" : ""}" data-scope="${esc(n.reference)}" title="${esc(n.reference)}" role="treeitem" aria-level="${n.depth + 2}" ${n.branch ? `aria-expanded="${!collapsed.has(n.reference)}"` : ""} style="padding-left:${15 + (n.depth + 1) * 14}px"><button class="tree-toggle" data-collapse="${esc(n.reference)}" ${n.branch ? "" : "disabled"}>${n.branch ? (collapsed.has(n.reference) ? "▸" : "▾") : ""}</button><span class="tree-icon ${n.kind}">${n.kind}</span>${esc(n.name)}</div>`,
      )
      .join(
        "",
      )}<div aria-hidden="true" style="height:${(visible.length - end) * rowHeight}px"></div>`;
    element.scrollTop = top;
  }
  element.addEventListener("scroll", () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        render(false);
      });
  });
  new ResizeObserver(() => {
    if (currentModel) render();
  }).observe(element);
  return { render };
}
