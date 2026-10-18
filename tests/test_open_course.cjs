const assert=require('node:assert/strict');
const {openCourse,enableRememberLogin}=require('../browser_worker.cjs');
const target='https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=1&clazzid=2';
async function scenario({logged=false,cred=true,success=true,existing=[]}={}){
  let current='',attempts=0;
  const visits=[];
  const page={goto:async url=>{visits.push(url);current=logged?url:'https://passport2.chaoxing.com/login';},
    bringToFront:async()=>{},url:()=>current,frames:()=>[]};
  let created=0;
  const pages=existing.map(url=>({...page,url:()=>url}));
  const message=await openCourse({pages:()=>pages,newPage:async()=>{created++;return page;}},target,cred?{username:'test',password:'test'}:null,
    async(context,credential,loginPage)=>{assert.ok(loginPage);attempts++;if(success)logged=true;return {ok:success,message:'需要验证码'};});
  return {message,visits,attempts,created};
}
(async()=>{
  for(const initiallyChecked of [false,true]){
    let checked=initiallyChecked;
    const checkbox={first(){return this;},count:async()=>1,check:async()=>{checked=true;}};
    await enableRememberLogin({getByRole:()=>checkbox,locator:()=>({first(){return this;},count:async()=>0})});
    assert.equal(checked,true);
    let clicks=0;
    checked=initiallyChecked;
    const custom={first(){return this;},count:async()=>1,
      getAttribute:async()=>checked?'check-input checked-input':'check-input',
      click:async()=>{clicks++;checked=!checked;}};
    await enableRememberLogin({locator:()=>custom});
    await enableRememberLogin({locator:()=>custom});
    assert.equal(checked,true);assert.equal(clicks,initiallyChecked?0:1);
  }
  let r=await scenario();
  assert.equal(r.attempts,1);assert.deepEqual(r.visits,[target,target]);assert.match(r.message,/已自动登录/);
  r=await scenario({logged:true});assert.equal(r.attempts,0);assert.equal(r.visits.length,1);
  r=await scenario({cred:false});assert.equal(r.attempts,0);assert.match(r.message,/需要登录/);
  r=await scenario({success:false});assert.equal(r.message,'需要验证码');assert.equal(r.visits.length,1);
  r=await scenario({existing:['about:blank']});assert.equal(r.created,0);
  r=await scenario({existing:[target]});assert.equal(r.created,0);
  r=await scenario({existing:['https://passport2.chaoxing.com/login']});assert.equal(r.created,0);
  r=await scenario({existing:['https://i.chaoxing.com/']});assert.equal(r.created,1);
})().catch(error=>{console.error(error);process.exitCode=1;});
