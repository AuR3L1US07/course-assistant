const assert=require('node:assert/strict');
const {classifyLoginError,loginAccount}=require('../browser_worker.cjs');
assert.equal(classifyLoginError('用户名或密码错误'),'invalid_credentials');
assert.equal(classifyLoginError('密码不正确'),'invalid_credentials');
assert.equal(classifyLoginError('请完成安全验证'),'captcha');
assert.equal(classifyLoginError('网络异常'),'error');

function scenario(status){
  let url='https://passport2.chaoxing.com/login', closed=false, cleared=false;
  const fields={};
  const page={
    on:()=>{}, url:()=>url,
    goto:async()=>{if(status==='network')throw Error('offline');},
    close:async()=>{closed=true;}, frames:()=>[],
    getByRole:()=>({first(){return this;},count:async()=>0}),
    getByText:()=>({first(){return this;},count:async()=>0}),
    locator:selector=>({first(){return this;},count:async()=>0,
      waitFor:async()=>{},fill:async text=>{fields[selector]=text;},
      click:async()=>{if(status==='success')url='https://i.chaoxing.com/';},
      innerText:async()=>status==='invalid_credentials'?'用户名或密码错误':'',
      isVisible:async()=>status==='captcha'&&selector==='#captcha',
    }),
  };
  const context={newPage:async()=>page,pages:()=>[],clearCookies:async options=>{
    assert.ok(options.domain.test('.chaoxing.com'));
    assert.ok(!options.domain.test('example.com'));
    cleared=true;
  }};
  return {context,fields,get closed(){return closed;},get cleared(){return cleared;}};
}
(async()=>{
  for(const [mode,expected] of [['success','success'],['invalid_credentials','invalid_credentials'],['captcha','captcha'],['network','error']]){
    const mock=scenario(mode);
    const result=await loginAccount(mock.context,{username:'test-user',password:'test-secret'});
    assert.equal(result.status,expected);
    assert.equal(JSON.stringify(result).includes('test-secret'),false);
    assert.equal(mock.cleared,true);
    if(mode!=='network')assert.equal(mock.fields['#pwd'],'test-secret');
  }
  const mock=scenario('captcha');
  assert.equal((await loginAccount(mock.context,{username:'u',password:'p'},{visible:true})).status,'captcha');
  assert.equal(mock.closed,false,'leave the challenge page open for the user');
  console.log('Login classification and manual challenge handoff passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
