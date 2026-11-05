const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
fs.writeFileSync(path.join(root,'ui-result.log'),'');
const child=spawn(require('electron'),[path.join(root,'tests/electron-smoke.js')],{cwd:root,env,stdio:'ignore',windowsHide:true});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{console.log(fs.readFileSync(path.join(root,'ui-result.log'),'utf8'));process.exitCode=code||0;});
