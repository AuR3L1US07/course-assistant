const assert = require('node:assert/strict');
const {manualLogin} = require('../browser_worker.cjs');

function scenario(platform, readyAfter=1) {
  let tick=0, closed=false;
  const page={
    on(){}, isClosed:()=>closed, bringToFront:async()=>{}, goto:async()=>{},
    url:()=>platform==='mooc'?'https://www.icourse163.org/':
      tick>=readyAfter?'https://i.chaoxing.com/':'https://passport2.chaoxing.com/login',
    frames:()=>[],
    locator:selector=>({first(){return this;},count:async()=>
      selector.startsWith('a[href') && tick>=readyAfter?1:0}),
    getByRole:()=>({first(){return this;},count:async()=>0}),
    getByText:()=>({first(){return this;},count:async()=>0}),
  };
  const context={newPage:async()=>page,pages:()=>[page],
    cookies:async()=>tick>=readyAfter?[{name:'_uid',value:'12345'}]:[],
    clearCookies:()=>{throw Error('manual login must never clear cookies');}};
  return {context,page,wait:async()=>{tick++;},close:()=>{closed=true;},tick:()=>tick};
}

(async()=>{
  for(const platform of ['chaoxing','mooc']){
    const s=scenario(platform);
    const result=await manualLogin(s.context,{platform,newPage:()=>s.context.newPage(),wait:s.wait});
    assert.equal(result.status,'success');
    assert.equal(s.tick(),1,'must wait for authenticated state');
    assert.equal(s.page.isClosed(),false,'keep the user browser open');
  }
  const cancelled=scenario('chaoxing');
  assert.equal((await manualLogin(cancelled.context,{newPage:()=>cancelled.context.newPage(),
    stopped:()=>true})).status,'cancelled');
  const timeout=scenario('chaoxing',999);
  assert.equal((await manualLogin(timeout.context,{newPage:()=>timeout.context.newPage(),timeout:0})).status,'not_logged_in');
  const noCookie=scenario('chaoxing',0);
  noCookie.context.cookies=async()=>[];
  const result=await manualLogin(noCookie.context,{newPage:()=>noCookie.context.newPage(),
    stopped:()=>noCookie.tick()>0,wait:noCookie.wait});
  assert.equal(result.status,'cancelled','landing URL alone is not authentication');
  const redirect=scenario('chaoxing');
  redirect.page.goto=async()=>{throw Error('page.goto: net::ERR_ABORTED');};
  const commands=[];
  redirect.context.newCDPSession=async()=>({send:async(method,params)=>{
    commands.push([method,params]);return {windowId:7};
  },detach:async()=>{}});
  const progress=[];
  assert.equal((await manualLogin(redirect.context,{newPage:()=>redirect.context.newPage(),
    wait:redirect.wait,progress:message=>progress.push(message)})).status,'success');
  assert.equal(progress.length,2,'window and page load are distinct stages');
  assert.deepEqual(commands[1],['Browser.setWindowBounds',{windowId:7,bounds:{windowState:'normal'}}]);
  console.log('Manual web login: both platforms, cancellation and authentication checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
