'use strict';
const {spawn}=require('node:child_process');const path=require('node:path');const fs=require('node:fs/promises');const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(exe,port,label){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const started=performance.now();const child=spawn(exe,['--remote-debugging-port='+port,'--user-data-dir='+path.join(root,'.tmp/startup-'+label)],{env,stdio:'ignore',windowsHide:true});
 const exit=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve)});let ws;
 try{
  let page;for(let i=0;i<1800;i++){try{page=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.url.endsWith('/src/renderer/index.html'));if(page)break;}catch{}await sleep(100);}
  if(!page)throw new Error(label+' timed out');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
  const evaluate=expression=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});
  let ready;for(let i=0;i<300;i++){const m=await evaluate('window.studio.command("bootstrap")');if(m.result?.result?.value?.state?.configured){ready=true;break;}await sleep(100)}
  if(!ready)throw new Error('Backend not configured');
  const result={label,startup_ms:Math.round(performance.now()-started),exe};console.log(JSON.stringify(result));
  ws.send(JSON.stringify({id:++id,method:'Runtime.evaluate',params:{expression:'window.studio.command("quit")'}}));
  let timeout; await Promise.race([exit,new Promise(resolve=>{timeout=setTimeout(resolve,15000)})]);clearTimeout(timeout);return result;
 }finally{ws?.close();if(child.exitCode===null)child.kill();}
}
(async()=>{
 const results=[];
 if (process.argv.includes('--legacy')) {
  const {execFileSync}=require('node:child_process');
  const running=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process | Where-Object { $_.ProcessName -like '*Service*Studio*' }).Count"],{encoding:'utf8',windowsHide:true}).trim();
  if(Number(running)>0)throw new Error('Close all Service Studio instances before legacy measurement: the old wrapper shares and deletes its extraction directory.');
  results.push(await run(path.join(root,'release/IEC61850-Service-Studio-0.2.1-Portable.exe'),9261,'self-extract'));
 }
 results.push(await run(path.join(process.env.STUDIO_TEST_RELEASE || path.join(root,'release/win-unpacked'),'IEC61850 Service Studio.exe'),9262,'directory'));
 await fs.writeFile(path.join(root,'startup-latest.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
