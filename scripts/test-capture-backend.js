const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const readline = require('node:readline');
const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'backend/capture/bin/capture-helper.exe');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function helper(file = executable, env = process.env) {
  const child = spawn(file, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
  const pending = new Map(); let sequence = 0;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => { const reply = JSON.parse(line); const p = pending.get(reply.id); if (!p) return; pending.delete(reply.id); clearTimeout(p.timer); reply.error ? p.reject(new Error(reply.error.message)) : p.resolve(reply.result); });
  return { child, async call(command, args = {}) { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${command} timed out`)), 150000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, command, args }) + '\n'); }); }, async close() { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); lines.close(); } };
}
async function main() {
  const tmp = path.join(root, 'backend/capture/test-output'); fs.mkdirSync(tmp, { recursive: true });
  const isolated = path.join(tmp, 'missing-dll'); fs.mkdirSync(isolated, { recursive: true }); fs.copyFileSync(executable, path.join(isolated, 'capture-helper.exe'));
  const absent = helper(path.join(isolated, 'capture-helper.exe'));
  assert.equal((await absent.call('capabilities')).available, false); await assert.rejects(absent.call('open', { file: 'missing' }), /unavailable/); await absent.close();
  const h = helper(); let backend;
  try {
    const cap = await h.call('capabilities'); assert(cap.available); assert(cap.analysis, cap.reason); assert(cap.capture);
    await assert.rejects(h.call('open', { file: path.join(tmp, 'does-not-exist.pcap') }), /exist/);
    const ifaces = await h.call('interfaces'); const loopback = ifaces.interfaces.find(i => /loopback/i.test(i.name)); assert(loopback, 'Npcap loopback interface required; do not capture production adapters');
    const { Backend } = require('../src/main/backend'); const { defaultProject } = require('../src/shared/project');
    backend = new Backend(root, path.join(root, 'backend/bin/iec61850-service-backend.exe')); backend.on('failure', () => {}); await backend.start();
    const project = defaultProject(); project.port = 18122; await backend.call('Apply', project); await backend.call('Start');
    const capture = path.join(tmp, `中文 MMS ${Date.now()}.pcapng`);
    await h.call('capture-start', { interface: loopback.id, output: capture, filter: 'tcp port 18122' });
    await promisify(execFile)(path.join(root, 'backend/bin/mms-integration.exe'), ['18122', 'full'], { windowsHide: true, timeout: 30000 });
    const directoryClient = path.join(root, 'backend/capture/bin/capture-mms-client.exe');
    if (fs.existsSync(directoryClient)) await promisify(execFile)(directoryClient, ['18122'], { windowsHide: true, timeout: 15000 });
    await wait(400); await h.call('capture-stop');
    const opened = await h.call('open', { file: capture, mms_ports: [18122] }); assert(opened.total > 20);
    const packets = await h.call('packets', { offset: 0, limit: 200, filter: 'mms' }); assert(packets.total > 5, 'MMS decoded on custom TCP port');
    const detail = await h.call('detail', { frame: packets.packets[0].frame }); assert(detail.tree); assert(detail.layers.mms); assert(detail.hex.length > 10);
    const response = packets.packets.find(row => row.info.startsWith('GetDataValueResponse'));
    const value = await h.call('detail', { frame: response.frame });
    assert.equal(value.values[0].reference, 'STUDIOLD0/GGIO1.AnIn1.mag.f');
    assert.equal(value.values[0].value, 220); assert.equal(value.values[0].replayable, true);
    assert(value.correlation.request_frame < response.frame); assert(value.correlation.latency_ms >= 0);
    const write = packets.packets.find(row => row.info.startsWith('SetRCBValuesRequest'));
    const intent = await h.call('detail', { frame: write.frame }); assert(intent.values.every(v => !v.replayable));
    const report = packets.packets.find(row => row.info.startsWith('Unconfirmed'));
    const observed = await h.call('detail', { frame: report.frame }); assert.equal(observed.values.length, 4);
    assert(observed.values.every(v => !v.replayable), 'No guessing dataset members');
    const replay = await h.call('replay', { offset: 0, limit: 100 }); assert(replay.events.length > 0);
    assert.equal((await h.call('replay', { mode: 'snapshot', through_frame: 1 })).values.length, 0);
    assert((await h.call('replay', { mode: 'snapshot', through_frame: response.frame })).values.some(v => v.reference.endsWith('.mag.f') && v.value === 220));
    if (fs.existsSync(directoryClient)) {
      const reports = packets.packets.filter(row => row.info.startsWith('Unconfirmed'));
      const known = await h.call('detail', { frame: reports.at(-1).frame });
      assert(known.values.length === 4 && known.values.every(v => v.replayable), JSON.stringify(known.warnings));
    }
    assert((await h.call('sessions')).sessions.length >= 1);
    await assert.rejects(h.call('packets', { filter: 'mms && (' }), /filter|rejected/);
    const again = await h.call('packets', { filter: 'mms', limit: 2 }); assert.equal(again.packets.length, 2);
    const pcap = path.join(tmp, `converted-${Date.now()}.pcap`);
    await promisify(execFile)(path.join(root, 'backend/capture/bin/wireshark/editcap.exe'), ['-F', 'pcap', capture, pcap], { windowsHide: true });
    assert.equal((await h.call('open', { file: pcap, mms_ports: [18122] })).total, opened.total);
    const malformed = path.join(tmp, 'malformed.pcapng'); fs.writeFileSync(malformed, Buffer.from('0a0d0d0affffffff', 'hex'));
    await assert.rejects(h.call('open', { file: malformed }), /rejected|failed/);
    assert.equal((await h.call('packets', { filter: 'mms' })).total, packets.total, 'Failed open preserves current capture');
    console.log(`PASS optional DLL absence, UTF-8 capture, Npcap loopback, PCAPNG import, two-pass MMS decode, protocol tree, filter errors (${packets.total} MMS frames)`);
    console.log(`Capture fixture: ${capture}`);
  } finally { await h.close(); if (backend) await backend.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
