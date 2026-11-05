'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Backend } = require('../src/main/backend');
const { CaptureClient } = require('../src/capture/helper-client');
const { createReplayTarget } = require('../src/main/replay-target');
const { defaultProject } = require('../src/shared/project');
const root=path.resolve(__dirname,'..');
async function main() {
  const fixtures=path.join(root,'backend/capture/test-output');
  const file=process.env.CAPTURE_REPLAY_FILE || fs.readdirSync(fixtures).filter(f=>f.startsWith('中文 MMS ') && f.endsWith('.pcapng')).map(f=>path.join(fixtures,f)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
  assert(file,'Run test:capture first to create a real MMS fixture');
  const capture=new CaptureClient({root});capture.on('failure',()=>{});
  const backend=new Backend(root,path.join(root,'backend/bin/iec61850-service-backend.exe'));backend.on('failure',()=>{});
  try {
    const opened=await capture.request('open',{file,mms_ports:[18122]});
    const snapshot=await capture.request('replay',{mode:'snapshot',through_frame:opened.total});
    const observed=snapshot.values.find(v=>v.reference==='STUDIOLD0/GGIO1.AnIn1.mag.f' && v.value===220);
    assert(observed?.replayable && observed.complete && observed.fc==='MX','Real captured resolved observation');
    const project=defaultProject();project.port=18124;
    const point=project.points.find(p=>p.name==='AnIn1');point.value=991;point.quality=5;point.blocked=true;
    await backend.start();await backend.call('Apply',project);await backend.call('Start');
    const target=createReplayTarget({backend:()=>backend,project:()=>project,model:()=>({nodes:[]})});
    const reference='STUDIOLD0/GGIO1.AnIn1';
    await target.apply({reference,value:observed.value});
    const actual=(await backend.call('Snapshot')).points.find(p=>p.reference===reference);
    assert.equal(actual.value,220);assert.equal(actual.quality,5);assert.equal(actual.blocked,true);
    await assert.rejects(target.apply({reference:'STUDIOLD0/GGIO1.SPCSO1',value:1}));
    await backend.call('Simulation',{enabled:true});await assert.rejects(target.apply({reference,value:221}));
    await backend.call('Simulation',{enabled:false});await backend.call('Stop');await assert.rejects(target.apply({reference,value:221}));
    console.log('PASS real PCAPNG decoded measurement -> replay adapter -> native IED state 991 to 220; quality/blocking retained; control/simulation/stopped target rejected');
  } finally {capture.close();await backend.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
