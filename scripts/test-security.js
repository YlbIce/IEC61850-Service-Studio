const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const { Backend } = require('../src/main/backend');
const { defaultProject } = require('../src/shared/project');
const { readModel, convertModel } = require('../src/main/importer');
const exec = promisify(execFile), root = path.resolve(__dirname, '..');
const dir = path.join(root, '.tmp/security'), binary = path.join(root, 'backend/bin/iec61850-service-backend.exe');
const openssl = process.env.OPENSSL || 'C:/Strawberry/c/bin/openssl.exe';
async function ssl(...args) { await exec(openssl, args, { cwd: dir, windowsHide: true, env: {...process.env, OPENSSL_CONF:path.join(dir,'openssl.cnf')} }); }
async function client(...args) { const result = await exec(path.join(root, 'backend/bin/security-integration.exe'), args, { windowsHide: true, timeout: 15000 }); process.stdout.write(result.stdout); }
async function main() {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'openssl.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=keyCertSign,cRLSign\n');
  await ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Studio Test CA', '-days', '2');
  for (const name of ['server', 'client']) {
    await ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`);
    await fs.writeFile(path.join(dir, `${name}.ext`), `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=${name === 'server' ? 'serverAuth' : 'clientAuth'}\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n`);
    await ssl('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.ext`);
  }
  await ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'rogue.key', '-out', 'rogue.pem', '-subj', '/CN=Untrusted', '-days', '2');
  let backend = new Backend(root, binary); await backend.start();
  const p = defaultProject(); p.port = 18112;
  p.tls = { enabled: true, certificate: path.join(dir, 'server.pem'), private_key: path.join(dir, 'server.key'), ca: path.join(dir, 'ca.pem') };
  try {
    await backend.call('Apply', p); await backend.call('Start');
    await client('18112', 'tls', p.tls.ca, path.join(dir, 'client.pem'), path.join(dir, 'client.key'));
    await client('18112', 'reject', p.tls.ca, path.join(dir, 'rogue.pem'), path.join(dir, 'rogue.key'));
    await client('18112', 'reject-plain'); await backend.call('Stop');
    await assert.rejects(backend.call('Apply', { ...p, tls: { ...p.tls, private_key: path.join(dir, 'missing.key') } }), /TLS|credential/);
    await assert.rejects(backend.call('Start'), /Apply/);
    await assert.rejects(backend.call('Apply', { ...p, tls: { ...p.tls, private_key: path.join(dir, 'client.key') } }), /match private key/);
    console.log('PASS TLS invalid credential fails closed');
    const input = await readModel(path.join(root, 'third_party/libiec61850/examples/server_example_setting_groups/sg_demo.cid'));
    const converted = await convertModel(input, input.choices[0], { directory: path.join(dir, 'model'), jar: path.join(root, 'tools/genconfig.jar'), binary });
    const cfg = path.join(dir, 'settings.cfg'); await fs.writeFile(cfg, converted.cfg);
    const settingsPath = path.join(dir, 'banks.pb'); await fs.rm(settingsPath, { force: true });
    const sg = { ...defaultProject(), port: 18112, config_path: cfg, settings_path: settingsPath };
    await backend.call('Apply', sg);
    await backend.call('Start'); await client('18112', 'setting-write');
    await backend.close(); backend = new Backend(root, binary); await backend.start(); await backend.call('Apply', sg); await backend.call('Start');
    await client('18112', 'setting-read');
    const state = await backend.call('Settings'); assert.equal(state.devices[0].active, 2); assert(state.devices[0].banks[1].values.some(v => Number(v.value) === 42.75));
    console.log('PASS setting banks survive complete backend process restart');
    await fs.rename(settingsPath, settingsPath + '.backup'); await fs.mkdir(settingsPath);
    try { await client('18112', 'setting-fail'); }
    finally { await fs.rmdir(settingsPath); await fs.rename(settingsPath + '.backup', settingsPath); }
    await backend.call('Stop');
    p.tls.tls13_only = true;
    await backend.call('Apply', p); await backend.call('Start');
    await client('18112', 'tls', p.tls.ca, path.join(dir, 'client.pem'), path.join(dir, 'client.key'));
    console.log('PASS TLS 1.3 only server');
  } finally { await backend.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
