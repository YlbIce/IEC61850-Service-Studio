const path=require('node:path');
const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const assert=require('node:assert/strict');
const net=require('node:net');
const {Backend}=require('../src/main/backend');
const {defaultProject}=require('../src/shared/project');
const {readModel,convertModel}=require('../src/main/importer');
const exec=promisify(execFile),root=path.resolve(__dirname,'..'),binary=path.join(root,'backend/bin/iec61850-service-backend.exe');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const backend=new Backend(root,binary);backend.on('failure',console.error);backend.on('log',console.error);
  await backend.start();
  try{
    const p=defaultProject();p.port=18102;p.reports[0].integrity_ms=300;
    await backend.call('Apply',p);await backend.call('Start');
    const run=async(...args)=>{try{const r=await exec(path.join(root,'backend/bin/mms-integration.exe'),args,{windowsHide:true,timeout:30000});process.stdout.write(r.stdout);}catch(e){process.stdout.write(e.stdout||'');throw new Error(e.stderr||e.message);}};
    await assert.rejects(backend.call('Apply',p),/Stop/);
    await run(String(p.port),'full');
    let state=await backend.call('Snapshot');assert(state.controls>=3);assert(state.events.some(x=>x.category==='CONTROL'));console.log('PASS server control and audit state');
    await backend.call('Update',{reference:'STUDIOLD0/GGIO1.AnIn1',value:231.5,quality:4096});state=await backend.call('Snapshot');assert.equal(state.points.find(x=>x.reference.endsWith('AnIn1')).value,231.5);assert.equal(state.points.find(x=>x.reference.endsWith('AnIn1')).quality,4096);
    await backend.call('Simulation',{enabled:true});await delay(250);state=await backend.call('Snapshot');assert.notEqual(state.points.find(x=>x.reference.endsWith('AnIn1')).value,231.5);console.log('PASS online value, quality and waveform updates');
    await backend.call('Stop');p.allow_controls=false;await backend.call('Apply',p);await backend.call('Start');await run(String(p.port),'rejected');await backend.call('Stop');
    p.allow_controls=true;p.points[6].control_model=2;p.points[7].control_model=3;
    await backend.call('Apply',p);await backend.call('Start');await run(String(p.port),'full');await backend.call('Stop');console.log('PASS all four control models');
    // A busy MMS port must fail visibly, without leaving a false running state.
    const blocker=net.createServer();await new Promise(r=>blocker.listen(p.port,'127.0.0.1',r));await assert.rejects(backend.call('Start'),/bind/);await new Promise(r=>blocker.close(r));assert.equal((await backend.call('Snapshot')).running,false);console.log('PASS bind conflict detected');
    const files=['examples/genericIO.icd','examples/model.cfg','third_party/libiec61850/examples/server_example_basic_io/simpleIO_direct_control.cid'];
    for(const relative of files){
      const source=path.join(root,relative);const input=await readModel(source);
      const dir=path.join(root,'.tmp/import-'+path.basename(relative));
      const converted=await convertModel(input,input.choices[0],{directory:dir,jar:path.join(root,'tools/genconfig.jar'),binary});
      const cfg=path.join(dir,'中文模型.cfg');await fs.writeFile(cfg,converted.cfg);
      const imported={...defaultProject(),port:p.port,config_path:cfg,points:[],datasets:[],reports:[]};
      await backend.call('Apply',imported);const m=await backend.call('GetModel');assert(m.nodes.length>10);const attr=m.nodes.find(n=>n.fc==='MX'&&n.type==='10');assert(attr,'imported float attribute');
      await backend.call('Start');await run(String(p.port),'import',attr.reference);await backend.call('Stop');console.log('PASS import '+relative+' ('+m.nodes.length+' nodes)');
    }
    const meta=backend.metadata;backend.metadata=new (require('@grpc/grpc-js').Metadata)();await assert.rejects(backend.call('Snapshot'),/token/);backend.metadata=meta;console.log('PASS unauthorized management request rejected');
    console.log('ALL INTEGRATION CHECKS PASSED');
  }finally{await backend.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
