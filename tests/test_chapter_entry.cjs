const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {enterChapter,findNext,waitForVideo}=require('../browser_worker.cjs');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('https://test.chaoxing.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().endsWith('/catalog')?
      `<ul><li><span title="已完成"></span><a class="posCatalog_name" onclick="window.bad=true">完成章节</a></li><li><a class="posCatalog_name" onclick="document.body.replaceChildren(document.createElement('video'));const b=document.createElement('button');b.title='下一节';b.onclick=()=>window.nextClicked=true;document.body.append(b)">映射与函数</a></li></ul>`:
      '<iframe src="/catalog"></iframe>'}));
    await page.goto('https://test.chaoxing.com/course');
    const messages=[];
    assert.equal(await enterChapter(page,m=>messages.push(m)),true);
    assert.equal(await waitForVideo(page,1000),true,'enters video inside catalogue iframe');
    const frame=page.frames()[1];
    assert.equal(await frame.evaluate(()=>!!window.bad),false,'skip completed chapters');
    const next=await findNext(page);
    assert.ok(next,'find next in nested frame');
    await next.click();
    assert.equal(await frame.evaluate(()=>window.nextClicked),true);
    assert.equal(messages.length,1);
    assert.equal(await enterChapter(page,()=>{}),true,'already in player');
    await page.goto('https://test.chaoxing.com/catalog');
    await page.setContent('<p>无可进入章节</p>');
    assert.equal(await enterChapter(page,()=>{},250),false,'missing chapter returns explicit failure');
    console.log('Chapter entry and nested player navigation passed');
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});

