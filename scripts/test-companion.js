// Optional compatibility test against the existing sibling Client Studio executable.
const path=require('node:path');
const {spawn}=require('node:child_process');
const net=require('node:net');
const grpc=require('@grpc/grpc-js');
const loader=require('@grpc/proto-loader');
const assert=require('node:assert/strict');
const {Backend}=require('../src/main/backend');
const {defaultProject}=require('../src/shared/project');
const root=path.resolve(__dirname,'..'),clientRoot=path.resolve(root,'../Iec61850ClientStudio');
async function main(){
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',()=>reject(new Error('Port 48650 is occupied; close Client Studio before this isolated test')));probe.listen(48650,'127.0.0.1',resolve);});await new Promise(r=>probe.close(r));
  const server=new Backend(root,path.join(root,'backend/bin/iec61850-service-backend.exe'));server.on('failure',console.error);await server.start();
  let child,client;
  try{
    await server.call('Apply',{...defaultProject(),port:18104});await server.call('Start');
    child=spawn(path.join(clientRoot,'backend/bin/iec61850-client-backend.exe'),[],{windowsHide:true,stdio:'ignore'});
    const def=loader.loadSync(path.join(clientRoot,'proto/iec61850studio.proto'),{keepCase:true,longs:Number,defaults:true});
    client=new (grpc.loadPackageDefinition(def).iec61850studio.Iec61850Studio)('127.0.0.1:48650',grpc.credentials.createInsecure());
    await new Promise((r,j)=>client.waitForReady(Date.now()+10000,e=>e?j(e):r()));
    const call=(method,value)=>new Promise((r,j)=>client[method](value,{deadline:Date.now()+20000},(e,v)=>e?j(e):r(v)));
    const connected=await call('Connect',{host:'127.0.0.1',port:18104,mock:false,timeout_ms:5000});assert(connected.ok,connected.message);
    const tree=await call('RefreshModel',{force:true});assert(tree.logical_devices>0);assert(tree.data_attributes>0);
    const v=await call('ReadObject',{reference:'STUDIOLD0/GGIO1.AnIn1.mag.f',fc:'MX'});assert.equal(v.error,'');assert.equal(Number(v.value),220);
    const ds=await call('ReadDataSet',{reference:'STUDIOLD0/LLN0.Measurements'});assert.equal(ds.members.length,4);
    await call('Disconnect',{reason:'Compatibility test complete'});
    console.log(`PASS companion Client Studio real MMS connect / model (${tree.data_attributes} attributes) / read / dataset / disconnect`);
  }finally{client?.close();child?.kill();await server.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
