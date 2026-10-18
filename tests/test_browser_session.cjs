const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('../.runtime/playwright-core');
const {backgroundContext,platformSession}=require('../browser_worker.cjs');

(async()=>{
  let launchedDirectory;
  const original=chromium.launchPersistentContext;
  chromium.launchPersistentContext=async(directory,options)=>{
    launchedDirectory=directory;
    assert.equal(options.headless,true);
    return {close:async()=>{}};
  };
  try{
    await backgroundContext('background');
    assert.equal(launchedDirectory,path.join(__dirname,'..','data','browser-background'));
    assert.notEqual(launchedDirectory,path.join(__dirname,'..','data','browser'));
  }finally{chromium.launchPersistentContext=original;}
  const state={cookies:[{domain:'.chaoxing.com',name:'test',value:'fake'},
    {domain:'.icourse163.org',name:'test',value:'fake'},
    {domain:'evilchaoxing.com',name:'test',value:'fake'}],
    origins:[{origin:'https://i.chaoxing.com',localStorage:[]},
      {origin:'https://www.icourse163.org',localStorage:[]}]};
  for(const [platform,domain] of [['chaoxing','.chaoxing.com'],['mooc','.icourse163.org']]){
    const filtered=platformSession(state,platform);
    assert.equal(filtered.cookies.length,1);
    assert.equal(filtered.cookies[0].domain,domain);
    assert.equal(filtered.origins.length,1);
  }
  console.log('Background profile isolation and platform session filtering passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
