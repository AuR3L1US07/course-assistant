const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {scanYuketang,outlineDOM}=require('../yuketang.cjs');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();
    const row=(icon,status)=>`<div class="leaf-detail"><i class="icon--${icon}"></i><div class="progress-wrap">${status}</div></div>`;
    const outline='<span class="fr num">4</span><div class="chapter-list">'+row('shipin','已完成')+row('shipin','50%')+row('zuoye','已完成')+row('kaoshi','未开始')+'</div>';
    await context.route('https://changjiang.yuketang.cn/**',route=>{
      const pathname=new URL(route.request().url()).pathname;
      const body=pathname.endsWith('/index')?'<button>我听的课</button><div class="lesson-cardS"><h1 onclick="location.href=\'/v2/web/studentLog/456?university_id=123\'">测试课程</h1><span class="className">测试班</span></div>':
        pathname.endsWith('/studycontent')?outline:'<button onclick="document.querySelector(\'iframe\').src=\'/pro/lms/course/456/studycontent\'">学习内容</button><iframe></iframe>';
      return route.fulfill({contentType:'text/html; charset=utf-8',body});
    });
    const events=[];
    const result=await scanYuketang(context,{emit:(type,event)=>events.push({type,...event})});
    assert.ok(result.includes('1/1'));
    const course=events.find(event=>event.type==='course');
    assert.deepEqual(course.counts,[2,4]);
    assert.equal(course.metrics.video.required,2);
    assert.equal(course.metrics.video.done,1);
    assert.equal(course.metrics.exercise.done,1);
    assert.equal(course.metrics.exam.done,0);
    const page=await context.newPage();
    await page.setContent(outline);
    await page.locator('.progress-wrap').first().evaluate(el=>el.textContent='未知状态');
    assert.equal((await page.evaluate(outlineDOM)).metrics.video.done,null);
    await page.locator('.fr.num').evaluate(el=>el.textContent='5');
    const partial=await page.evaluate(outlineDOM);
    assert.equal(partial.complete,false);
    assert.equal(partial.metrics.exercise.required,null);
    await context.close();
    console.log('Yuketang course discovery, three categories, unknown status and incomplete outline passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
