// Run only after the user has saved and authorized use of the real API Key.
const {app,safeStorage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {AiSettings}=require('../src/capture/ai/settings');
const {CaptureClient}=require('../src/capture/helper-client');
const {analyze}=require('../src/capture/ai/engine');
const root=path.resolve(__dirname,'..');
for(const s of [process.stdout,process.stderr])s.on('error',()=>{});
app.whenReady().then(async()=>{
 const client=new CaptureClient({root});client.on('failure',()=>{});
 try{
  if(!process.env.STUDIO_AI_PROFILE)throw Error('Set STUDIO_AI_PROFILE to the settings directory displayed in the application.');
  const store=new AiSettings(process.env.STUDIO_AI_PROFILE,safeStorage),credentials=await store.credentials();
  await client.request('open',{file:path.join(root,'docs/blog/examples/sample-mms.pcapng'),mms_ports:[18122]});
  const results=[];
  for(const task of [
   {mode:'learn',question:'解释第24帧与其请求的关系、返回值。没有品质字段时能否推断品质良好？'},
   {mode:'diagnose',question:'核查这个数据对象的跳变。没有足够观察点时不能判断异常。',jump:{reference:'STUDIOLD0/GGIO1.AnIn1.mag.f'}},
   {mode:'diagnose',question:'调查断连重连线索，区分正常关闭、重连候选和已证实故障。',connections:true}
  ]){
   const c=new AbortController(),timer=setTimeout(()=>c.abort(),180000);
   try{results.push({task,...await analyze({client,credentials,frame:24,...task,signal:c.signal})});}finally{clearTimeout(timer);}
  }
  await fs.writeFile(path.join(root,'capture-ai-live-result.json'),JSON.stringify({at:new Date().toISOString(),transport:'DeepSeek live API',results},null,2));
  console.log('Live API checks completed; inspect capture-ai-live-result.json for answer quality.');client.close();app.quit();
 }catch(e){console.error(e.message);client.close();app.exit(1);}
});
