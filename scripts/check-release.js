const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of [
  'backend/bin/iec61850-service-backend.exe',
  'backend/capture/bin/capture-helper.exe',
  'backend/capture/bin/iec61850-capture.dll',
  'backend/capture/bin/wireshark/tshark.exe',
  'backend/capture/bin/wireshark/dumpcap.exe',
  'backend/capture/bin/wireshark/COPYING.txt',
  'backend/capture/bin/wireshark/studio-runtime.json',
]) {
  if (!fs.existsSync(path.join(root, name))) {
    throw new Error(`Full release resource missing: ${name}. See backend/capture/README.md for runtime preparation.`);
  }
}
console.log('Full release backend, optional capture engine, decoder and license resources present');
