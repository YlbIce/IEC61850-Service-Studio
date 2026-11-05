const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { Backend } = require('../src/main/backend');
const { defaultProject } = require('../src/shared/project');
const root = path.resolve(__dirname, '..');
function tlvs(buffer) {
  const result = []; let offset = 0;
  while (offset < buffer.length) {
    const tag = buffer[offset++]; let length = buffer[offset++];
    if (length & 128) { const n = length & 127; length = 0; for (let i = 0; i < n; ++i) length = length * 256 + buffer[offset++]; }
    assert(offset + length <= buffer.length, 'valid ASN.1 length');
    result.push({ tag, value: buffer.subarray(offset, offset + length) }); offset += length;
  }
  return result;
}
const integer = bytes => [...bytes].reduce((n, b) => n * 256 + b, 0);
async function main() {
  const backend = new Backend(root, path.join(root, 'backend/bin/iec61850-service-backend.exe'));
  backend.on('log', message => process.stdout.write(message));
  backend.on('failure', message => console.error(message));
  await backend.start(); let capture;
  try {
    const { interfaces } = await backend.call('Interfaces');
    // Never auto-select a physical/production NIC for tests. VMnet1 is host-only.
    const adapter = interfaces.find(d => /VMnet1\b/i.test(d.description));
    assert(adapter, 'isolated VMware VMnet1 adapter required for Ethernet integration');
    const p = defaultProject(); p.port = 18113;
    const base = { enabled: true, interface_id: adapter.id, vlan: true, vlan_id: 0, priority: 4, conf_rev: 1, min_ms: 4, max_ms: 500, sample_rate: 80, dataset: 'STUDIOLD0/LLN0$Measurements', control_ref: 'STUDIOLD0/LLN0$GO$TestGoose', sv_id: 'StudioTestSV' };
    p.publishers = [{ ...base, name: 'TestGoose', kind: 'GOOSE', destination: '01:0c:cd:01:00:ee', app_id: 1001 }, { ...base, name: 'TestSV', kind: 'SV', destination: '01:0c:cd:04:00:ee', app_id: 0x4001 }];
    await backend.call('Apply', p);
    const file = path.join(root, '.tmp/publisher-capture.pcap'); await fs.mkdir(path.dirname(file), { recursive: true });
    capture = spawn(path.join(root, 'backend/bin/capture-integration.exe'), [adapter.id, file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const done = new Promise((resolve, reject) => { capture.once('error', reject); capture.once('exit', code => code === 0 ? resolve() : reject(new Error('Capture exit ' + code))); });
    done.catch(() => {});
    await new Promise((resolve, reject) => { capture.stdout.on('data', b => { if (b.toString().includes('READY')) resolve(); }); capture.once('error', reject); capture.once('exit', code => reject(new Error('Capture ended before ready ' + code))); });
    await backend.call('Start'); await new Promise(r => setTimeout(r, 500));
    await backend.call('Update', { reference: 'STUDIOLD0/GGIO1.AnIn1', value: 233.5, quality: 0 });
    await done; const state = await backend.call('Snapshot'); await backend.call('Stop');
    assert(state.publishers.every(p => p.frames > 5 && p.running));
    const bytes = await fs.readFile(file), goose = [], sv = [];
    for (let offset = 24; offset + 16 <= bytes.length;) {
      const length = bytes.readUInt32LE(offset + 8); const frame = bytes.subarray(offset + 16, offset + 16 + length); offset += 16 + length;
      const vlan = frame.readUInt16BE(12) === 0x8100, ethernet = vlan ? 18 : 14, type = frame.readUInt16BE(ethernet - 2);
      const appid = frame.readUInt16BE(ethernet), pdu = frame.subarray(ethernet + 8, ethernet + frame.readUInt16BE(ethernet + 2));
      if (appid === 1001 && type === 0x88b8) goose.push(tlvs(tlvs(pdu)[0].value));
      if (appid === 0x4001 && type === 0x88ba) sv.push(tlvs(tlvs(tlvs(pdu)[0].value).find(t => t.tag === 0xa2).value).flatMap(t => tlvs(t.value)));
    }
    assert(goose.length > 5 && sv.length > 50, 'both protocols captured on actual adapter');
    const field = (row, tag) => row.find(t => t.tag === tag)?.value;
    assert(new Set(goose.map(g => integer(field(g, 0x85)))).size >= 2, 'GOOSE stNum changes with value');
    assert(goose.some(g => integer(field(g, 0x86)) > 0), 'GOOSE retransmission sqNum increments');
    assert(goose.every(g => field(g, 0x82).toString() === base.dataset), 'GOOSE dataset reference');
    assert(sv.every(s => field(s, 0x80).toString() === base.sv_id), 'SV svID');
    assert(sv.some(s => Math.abs(field(s, 0x87).readFloatBE(0) - 233.5) < 0.001), 'SV carries updated FLOAT32 value');
    assert(new Set(sv.map(s => integer(field(s, 0x82)))).size > 20, 'SV sample counter advances');
    assert(sv.every(s => integer(field(s, 0x85)) === 0), 'SV reports unsynchronized clock truthfully');
    console.log('PASS real Ethernet capture: ' + goose.length + ' GOOSE / ' + sv.length + ' SV frames; state/sequence/sample counters and values verified');
    console.log('SCHEDULER ' + JSON.stringify(state.publishers));
  } finally { if (capture && capture.exitCode === null) capture.kill(); await backend.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
