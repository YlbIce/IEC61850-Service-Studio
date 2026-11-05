const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function field(name, label, value, type = "text", extra = "") {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
export function select(name, label, value, options) {
  return `<label>${esc(label)}<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
}
export function check(name, label, value) {
  return `<label class="check"><input name="${name}" type="checkbox" ${value ? "checked" : ""}>${esc(label)}</label>`;
}
