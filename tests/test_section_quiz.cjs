const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {sectionState}=require('../browser_worker.cjs');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    const sidebar='<aside>2.2.3 作业与测试 章节测验</aside><form><input placeholder="搜索"></form>';
    await page.route('https://fixture.chaoxing.com/**',route=>route.fulfill({
      contentType:'text/html; charset=utf-8',body:route.request().url().includes('ballchart')?
        '期刊 图书 报纸':'<h1>章节详情</h1>'+sidebar+
        '<h2>知识扩展</h2><div id="question-dialog" hidden>问题反馈</div><iframe src="/ananas/dialog/ballchart"></iframe>',
    }));
    await page.goto('https://fixture.chaoxing.com/mycourse/studentstudy');
    assert.equal((await sectionState(page)).quiz,false,'catalogue labels, search form and hidden dialogs are not a quiz');
    await page.setContent(sidebar+'<div class="questionLi">[单选题] 实际题目 <input type="radio"></div>');
    assert.equal((await sectionState(page)).quiz,true,'visible question content is a quiz');
    await page.setContent(sidebar+'<iframe src="/mooc-ans/work/doHomeWorkNew"></iframe>');
    await page.frames()[1].waitForLoadState();
    assert.equal((await sectionState(page)).quiz,true,'real quiz iframe remains detected before questions finish loading');
    console.log('Section quiz detection: knowledge extension, catalogue labels, hidden dialogs and real quiz frames passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
