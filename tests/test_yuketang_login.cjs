const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {loginYuketang,authenticated}=require('../yuketang.cjs');
const {platformSession}=require('../browser_worker.cjs');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();
    const fixture=`<div class="login-box"><div>手机登录</div><div>邮箱登录</div>
      <input placeholder="输入手机号"><input type="password" placeholder="输入密码">
      <i id="user-agreement-checkbox" class="icon-duoxuanxuanzhongnormal"></i>
      <button class="login-btn" onclick="document.body.innerHTML='<div>我听的课</div>';history.pushState({},'', '/v2/web/index')">登录</button></div>`;
    await context.route('https://changjiang.yuketang.cn/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));
    let page;
    const result=await loginYuketang(context,{username:'13800000000',password:'test-only'},{newPage:async()=>{
      page=await context.newPage();
      return page;
    }});
    assert.equal(result.status,'success');
    assert.equal(page.isClosed(),true);
    const status=await loginYuketang(context,null,{checkOnly:true});
    assert.equal(status.status,'not_logged_in');
    const check=await context.newPage();
    await check.goto('https://changjiang.yuketang.cn/v2/web/index');
    assert.equal(await authenticated(check),false);
    const session=platformSession({cookies:[{domain:'.yuketang.cn'},{domain:'.chaoxing.com'}],origins:[{origin:'https://changjiang.yuketang.cn',localStorage:[]},{origin:'https://www.icourse163.org',localStorage:[]}]},'yuketang');
    assert.equal(session.cookies.length,1);
    assert.equal(session.origins.length,1);
    await context.close();
    console.log('Yuketang password login, unauthenticated status and session isolation passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
