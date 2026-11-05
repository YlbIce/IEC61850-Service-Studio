const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Backend}=require('../src/main/backend');
const {defaultProject}=require('../src/shared/project');
const root=path.resolve(__dirname,'..');
async function main(){
 const dir=path.join(root,'.tmp/no-setting-groups');await fs.mkdir(dir,{recursive:true});
 const source=await fs.readFile(path.join(root,'examples/model.cfg'),'utf8');
 const backend=new Backend(root,path.join(root,'backend/bin/iec61850-service-backend.exe'));backend.on('failure',()=>{});await backend.start();
 try{
  for(const block of ['', 'SG(0 0)', 'SG(1 0)']){
   const cfg=path.join(dir,'model.cfg');await fs.writeFile(cfg,source.replace('LN(LLN0){','LN(LLN0){\n'+block));
   await backend.call('Apply',{...defaultProject(),port:18125,config_path:cfg,settings_path:path.join(dir,'must-not-create','banks.pb')});
   assert.equal((await backend.call('Settings')).devices.length,0);
   await backend.call('Start');assert((await backend.call('Snapshot')).running);await backend.call('Stop');
   await assert.rejects(fs.stat(path.join(dir,'must-not-create')), {code:'ENOENT'});
   console.log('PASS no setting banks: '+(block||'no SGCB')+' loads and starts without storage');
  }
  for(const block of ['SG(0 2)','SG(3 2)']){
   const cfg=path.join(dir,'invalid.cfg');await fs.writeFile(cfg,source.replace('LN(LLN0){','LN(LLN0){\n'+block));
   await assert.rejects(backend.call('Apply',{...defaultProject(),config_path:cfg}),/Invalid SGCB/);
   console.log('PASS invalid populated group remains rejected: '+block);
  }
 }finally{await backend.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
