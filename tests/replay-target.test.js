const test = require('node:test');
const assert = require('node:assert/strict');
const { createReplayTarget } = require('../src/main/replay-target');

function fixture() {
  const state = { running: true, simulation: false, points: [{ reference: 'IEDLD/GGIO1.AnIn1', value: 10, quality: 4, blocked: true }, { reference: 'IEDLD/GGIO1.SPCSO1', value: 0, quality: 0 }] };
  const updates = [];
  const target = createReplayTarget({
    backend: () => ({ call: async (name, value) => name === 'Snapshot' ? state : updates.push(value) }),
    project: () => ({ ied_name: 'IED', points: [{ ld: 'LD', ln: 'GGIO1', name: 'AnIn1', cdc: 'MV' }, { ld: 'LD', ln: 'GGIO1', name: 'SPCSO1', cdc: 'SPC' }] }),
    model: () => ({ nodes: [] })
  });
  return { state, updates, target };
}
test('semantic replay excludes controls and preserves target quality/blocking', async () => {
  const { target, updates } = fixture();
  assert.equal((await target.catalog()).points.length, 1);
  await target.apply({ reference: 'IEDLD/GGIO1.AnIn1', value: 22 });
  assert.deepEqual(updates[0], { reference: 'IEDLD/GGIO1.AnIn1', value: 22, quality: 4, blocked: true });
  await assert.rejects(target.apply({ reference: 'IEDLD/GGIO1.SPCSO1', value: 1 }), /非遥控/);
});
test('semantic replay refuses a stopped/simulating target or malformed values', async () => {
  const { state, target, updates } = fixture();
  state.running = false;
  await assert.rejects(target.apply({ reference: 'IEDLD/GGIO1.AnIn1', value: 20 }), /启动/);
  state.running = true; state.simulation = true;
  await assert.rejects(target.apply({ reference: 'IEDLD/GGIO1.AnIn1', value: 20 }), /暂停/);
  await assert.rejects(target.apply({ reference: 'IEDLD/GGIO1.AnIn1', value: NaN }), /无效/);
  assert.equal(updates.length, 0);
});
