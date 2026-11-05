export function datasetMembers(model, project, points, selected) {
  const sets = model.datasets || [];
  const ref = d => `${d.ld}/${d.ln ? d.ln + "." : ""}${d.name}`;
  const dataset = sets.find(d => ref(d) === selected) || sets[0];
  const result = [];
  const seen = new Set();
  for (const member of dataset?.members || []) {
    let reference = member.replace(/\$(ST|MX|DC|CF|CO|SP|SG|SE|EX|SR|OR|BL)\$/, '.').replaceAll('$', '.').replace(/\[[^\]]+\]$/, '');
    if (!model.nodes.some(n => n.reference === reference)) reference = project.ied_name + reference;
    const candidates = model.nodes.filter(n => n.kind === 'DO' && (reference === n.reference || reference.startsWith(n.reference + '.')));
    reference = candidates.sort((a,b) => b.reference.length-a.reference.length)[0]?.reference || reference;
    if (seen.has(reference)) continue;
    seen.add(reference);
    const live = points.find(p => p.reference === reference);
    result.push({ reference, du: model.nodes.find(n => n.reference === reference + '.dU')?.value || '—', value: live?.value ?? '—', quality: live?.quality ?? '—', ...live });
  }
  result.datasetReference = dataset ? ref(dataset) : '';
  return result;
}
export function renderDatasetPane(area, model, project, rows, selected, esc) {
  area.innerHTML = `<div class="dataset-pane"><aside>${(model.datasets || []).map(d => {
    const ref = `${d.ld}/${d.ln ? d.ln + '.' : ''}${d.name}`;
    return `<button data-dataset="${esc(ref)}" class="${ref === selected ? 'active' : ''}"><strong>${esc(d.name)}</strong><small>${esc(ref)}</small></button>`;
  }).join('') || '<p>暂无数据集</p>'}</aside><section><header><strong>${esc(selected || '请选择数据集')}</strong>${!project.source && selected ? '<button data-edit-dataset>编辑数据集配置</button>' : ''}</header><table><thead><tr><th>数据对象引用</th><th>数据名称（dU）</th><th>数据值</th><th>质量</th></tr></thead><tbody>${rows.map(r => `<tr data-row="${esc(r.reference)}" tabindex="0" title="点击编辑运行值与品质"><td>${esc(r.reference)}</td><td>${esc(r.du)}</td><td data-column="value">${esc(r.value)}</td><td data-column="quality">${esc(r.quality)}</td></tr>`).join('')}</tbody></table>${rows.length ? '' : '<p>该数据集没有成员</p>'}</section></div>`;
}
