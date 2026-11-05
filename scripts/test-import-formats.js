const path=require('node:path');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const {XMLParser,XMLBuilder}=require('fast-xml-parser');
const {Backend}=require('../src/main/backend');
const {readModel,convertModel}=require('../src/main/importer');
const {defaultProject}=require('../src/shared/project');
const root=path.resolve(__dirname,'..'),binary=path.join(root,'backend/bin/iec61850-service-backend.exe');
async function main(){
  const dir=path.join(root,'.tmp/format-tests');await fs.mkdir(dir,{recursive:true});
  const original=await fs.readFile(path.join(root,'examples/genericIO.icd'),'utf8');
  const doc=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(original);
  const first=doc.SCL.IED,second=structuredClone(first);second['@_name']='SECOND';doc.SCL.IED=[first,second];
  await fs.writeFile(path.join(dir,'multiple.scd'),new XMLBuilder({ignoreAttributes:false,suppressBooleanAttributes:false}).build(doc));
  await fs.writeFile(path.join(dir,'instance.iid'),original);
  const backend=new Backend(root,binary);backend.on('failure',console.error);await backend.start();
  try{
    for(const name of ['multiple.scd','instance.iid']){
      const input=await readModel(path.join(dir,name));if(name.endsWith('scd'))assert.equal(input.choices.length,2);
      const choice=name.endsWith('scd')?input.choices[1]:input.choices[0];
      const result=await convertModel(input,choice,{directory:path.join(dir,name+'.converted'),jar:path.join(root,'tools/genconfig.jar'),binary});
      const cfg=path.join(dir,name+'.cfg');await fs.writeFile(cfg,result.cfg);
      await backend.call('Apply',{...defaultProject(),config_path:cfg,points:[],datasets:[],reports:[]});
      const model=await backend.call('GetModel');assert.equal(model.ied_name,choice.ied);assert(model.nodes.length>50);
      console.log('PASS '+name+' -> '+choice.ied+' / '+choice.ap);
    }
    const cfg=(await fs.readFile(path.join(root,'examples/model.cfg'),'utf8')).replace(/MODEL\([^)]+\)/,'MODEL');
    const unnamed=path.join(dir,'unnamed.cfg');await fs.writeFile(unnamed,cfg);
    const input=await readModel(unnamed);await convertModel(input,null,{directory:path.join(dir,'unnamed'),jar:'',binary});
    await backend.call('Apply',{...defaultProject(),config_path:unnamed,points:[],datasets:[],reports:[]});assert((await backend.call('GetModel')).nodes.length>50);console.log('PASS unnamed MODEL{ CFG');
  }finally{await backend.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
