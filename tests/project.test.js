const {test}=require('node:test');
const assert=require('node:assert/strict');
const {defaultProject,validateProject}=require('../src/shared/project');
const {checkCfg,readModel}=require('../src/main/importer');
const fs=require('node:fs/promises');
const path=require('node:path');
test('default engineering project validates',()=>assert.deepEqual(validateProject(defaultProject()),[]));
test('rejects conflicting identifiers, invalid booleans and out of range values',()=>{
  const p=defaultProject();p.points.push({...p.points[0]});p.points[5].value=2;p.port=65536;
  const errors=validateProject(p);assert(errors.some(x=>x.includes('重复点位')));assert(errors.some(x=>x.includes('0 或 1')));assert(errors.some(x=>x.includes('端口')));
});
test('rejects dangling dataset and report references',()=>{const p=defaultProject();p.points=[];p.reports[0].dataset='missing';assert(validateProject(p).some(x=>x.includes('无效成员')));assert(validateProject(p).some(x=>x.includes('关联数据集不存在')));});
test('rejects NaN and invalid waveform timing',()=>{const p=defaultProject();p.points[0].period=0;p.points[1].value=NaN;assert(validateProject(p).length>=2);});
test('CFG preflight rejects malformed nesting and overlong input',()=>{assert.throws(()=>checkCfg('MODEL(x){'));assert.throws(()=>checkCfg('MODEL(x){\n'+ 'a'.repeat(1100)+'\n}'));assert.throws(()=>checkCfg('<SCL/>'));});
test('SCL rejects external entities before Java conversion',async()=>{const file=path.join(__dirname,'../.tmp/entity.icd');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'<!DOCTYPE SCL [<!ENTITY x SYSTEM "file:///x">]><SCL/>');await assert.rejects(readModel(file),/DOCTYPE/);});
test('SCL inventory includes server IED and access point',async()=>{const info=await readModel(path.join(__dirname,'../examples/genericIO.icd'));assert(info.choices.length>0);assert(info.choices[0].ied);assert(info.choices[0].ap);});
