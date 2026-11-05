const {app,BrowserWindow,dialog}=require('electron');
dialog.showMessageBox=async(_win,options)=>({response:options?.buttons?.includes('不保存') ? 1 : 0});
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'.tmp/datasets-ui-profile-'+Date.now()));
for(const stream of [process.stdout,process.stderr])stream.on('error',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async fn=>{for(let i=0;i<200;i++){try{const x=await fn();if(x)return x;}catch{}await delay(100);}throw Error('Dataset UI timeout');};
require('../src/main/main');
app.whenReady().then(async()=>{
try{
 const win=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
 const js=code=>win.webContents.executeJavaScript(code);
 const cmd=(name,arg)=>js(`window.studio.command(${JSON.stringify(name)},${JSON.stringify(arg)})`);
 await wait(()=>js('!!window.studio && document.querySelectorAll("[data-tab]").length'));
 let env=await cmd('bootstrap');
 const fileRoot=path.join(root,'.tmp/service-file-regression');
 await fs.mkdir(fileRoot,{recursive:true});await fs.writeFile(path.join(fileRoot,'long-filename-61850-configuration.xml'),'file test');
 const project={...env.project,port:18143,file_service:true,file_root:fileRoot};await cmd('replace',project);
 await js('document.querySelector("[data-tab=datasets]").click()');
 await wait(()=>js('document.querySelector(".dataset-pane")?.textContent.includes("A 相电压")'));
 await js('document.querySelector(".dataset-pane [data-row]").click()');
 await wait(()=>js('document.querySelector("#dialog").open'));
 await js('document.querySelector("#dialog-body [name=value]").value="241.25";document.querySelector("#dialog-ok").click()');
 await wait(()=>js('!document.querySelector("#dialog").open && document.querySelector(".dataset-pane").textContent.includes("241.25")'));
 for(const mode of ['light','dark']){
  await js(`window.appearance.set('${mode}')`);await delay(150);
  await fs.mkdir(path.join(root,'docs/screenshots'),{recursive:true});
  await fs.writeFile(path.join(root,`docs/screenshots/service-datasets-${mode}.png`),(await win.webContents.capturePage()).toPNG());
 }
 await js('document.querySelector("[data-tab=files]").click()');
 await wait(()=>js('document.querySelector("#file-items")?.textContent.includes("long-filename-61850-configuration.xml")'));
 assert(await js('document.querySelector("#file-items th").getBoundingClientRect().width > 250'));
 await fs.writeFile(path.join(root,'docs/screenshots/service-files-dark.png'),(await win.webContents.capturePage()).toPNG());
 const cfg=await fs.readFile(path.join(root,'examples/model.cfg'),'utf8');
 await cmd('replace',{...project,ied_name:'simpleIO',source:{format:'CFG',filename:'model.cfg',cfg},simulation_overrides:{}});
 await cmd('start');
 await assert.rejects(cmd('simulation'),/没有有效波形/);
 env=await cmd('bootstrap');
 const point=env.state.points.find(p=>p.reference.includes('AnIn')) || env.state.points[0];
 await cmd('simulation-config',{reference:point.reference,waveform:'sine',base:20,amplitude:3,period:2});
 await cmd('simulation');await delay(400);
 env=await cmd('refresh');assert(env.state.simulation);assert.notEqual(env.state.points.find(p=>p.reference===point.reference).value,20);
 await cmd('stop');
 await cmd('replace',env.project);env=await cmd('bootstrap');
 assert.equal(env.state.points.find(p=>p.reference===point.reference).waveform,'sine');
 await fs.writeFile(path.join(root,'datasets-ui-result.json'),JSON.stringify({passed:true,editRefresh:true,importedSimulation:true,restoredWaveform:true}));
 app.quit();
}catch(e){await fs.writeFile(path.join(root,'datasets-ui-result.json'),JSON.stringify({passed:false,error:e.stack}));app.quit();}
});
