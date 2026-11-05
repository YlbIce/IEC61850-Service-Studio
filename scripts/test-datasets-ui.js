const {spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
fs.writeFileSync(path.join(root,'datasets-ui-result.json'),JSON.stringify({passed:false,error:'Test did not finish'}));
const child=spawn(require('electron'),[path.join(root,'tests/datasets-ui.js')],{cwd:root,env,stdio:'pipe',windowsHide:true});
child.on('exit',code=>{const r=JSON.parse(fs.readFileSync(path.join(root,'datasets-ui-result.json'),'utf8'));console.log(r);process.exitCode=code||(!r.passed?1:0);});

child.stderr.on('data',b=>process.stderr.write(b));
