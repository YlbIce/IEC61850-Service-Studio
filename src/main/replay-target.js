"use strict";

// Semantic replay writes measurements only. Captured control transactions are never executed.
function createReplayTarget({ backend, project, model }) {
  function controlReferences() {
    const p = project();
    if (!p.source)
      return new Set(
        p.points
          .filter((point) => ["SPC", "DPC"].includes(point.cdc))
          .map((point) => `${p.ied_name}${point.ld}/${point.ln}.${point.name}`),
      );
    return new Set(
      model()
        .nodes.filter((node) => /\.(Oper|ctlModel)$/.test(node.reference))
        .map((node) => node.reference.replace(/\.(Oper|ctlModel)$/, "")),
    );
  }
  return {
    async catalog() {
      const state = await backend().call("Snapshot");
      const controls = controlReferences();
      return {
        running: state.running,
        points: state.points.filter((point) => !controls.has(point.reference)),
        simulation: state.simulation,
      };
    },
    async apply({ reference, value, quality }) {
      if (
        typeof reference !== "string" ||
        !Number.isFinite(value) ||
        (quality !== undefined &&
          (!Number.isInteger(quality) || quality < 0 || quality > 8191))
      )
        throw new Error("回放值或品质无效");
      const state = await backend().call("Snapshot");
      if (!state.running) throw new Error("请先启动目标 MMS 服务");
      if (state.simulation) throw new Error("请先暂停波形仿真，避免覆盖回放值");
      const target = state.points.find(
        (point) => point.reference === reference,
      );
      if (!target || controlReferences().has(reference))
        throw new Error("回放目标必须是已有的非遥控测量点");
      return backend().call("Update", {
        reference,
        value,
        quality: quality ?? target.quality,
        blocked: target.blocked,
      });
    },
  };
}
module.exports = { createReplayTarget };
