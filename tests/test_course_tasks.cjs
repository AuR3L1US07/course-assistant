const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {defaultMuteMedia,chapterCandidates,enterChapter,sectionState,scrollDocuments,brushOne,sectionFingerprint,waitForSectionChange}=require('../browser_worker.cjs');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();
    const badge=(color,text)=>`<span style="display:inline-block;background:${color};border-radius:50%;padding:6px;color:white">${text}</span>`;
    const catalogue=`<div>${badge('#ffaa44','1')}<span onclick="location.href='/live'">1.1 第一次直播课</span></div>
      <div><span onclick="location.href='/video'">1.2 映射与函数视频</span></div>
      <div><span onclick="location.href='/pdf/view'">1.3 课程讲义</span></div>
      <div>${badge('#44cc66','✓')}<span onclick="window.wrong=true">2.2 已完成目录</span></div>
      <div>${badge('#ffaa44','0')}<span onclick="window.wrong=true">2.3 空目录</span></div>`;
    const fixtures={
      '/course':'<iframe src="/catalog"></iframe>',
      '/catalog':catalogue,
      '/live':'<h1>章节详情</h1><h2>第一次直播课</h2><p>直播 主播：老师 未开始</p><button onclick="location.href=\'/video\'">下 一 节</button>',
      '/video':`<h1>映射与函数</h1><video></video><script>Object.defineProperty(document.querySelector('video'),'ended',{get:()=>true});</script><button onclick="location.href='/pdf/view'">下一节</button>`,
      '/pdf/view':'<h1>课程讲义</h1><div data-document-viewer style="height:150px;overflow:auto"><div style="height:1300px">PPT第一页</div><p>最后一页</p></div>',
      '/pdf/inner':'<h1>课件</h1><div class="unknown-viewer-pane" style="height:180px;width:600px;overflow-y:auto"><div style="height:1800px">课件第一页</div><p>课件最后一页</p></div><div style="height:2000px">外层网页</div><script>document.querySelector(".unknown-viewer-pane").addEventListener("scroll",e=>window.viewerScroll=e.isTrusted);</script>',
      '/root-course':'<h1>课程目录</h1><iframe src="/pdf/root" style="width:700px;height:350px"></iframe><div style="height:1800px">外层内容</div>',
      '/pdf/root':'<div style="height:2400px">课件第一页</div><p>课件最后一页</p><script>addEventListener("scroll",()=>{if(!window.appended){window.appended=true;const p=document.createElement("p");p.style.height="600px";p.textContent="延迟加载页";document.body.append(p);}});</script>',
      '/ananas/modules/pdf/index.html':'<h2>文档工具栏</h2><iframe id="panView" src="https://document-fixture.example.test/preview" style="width:650px;height:300px"></iframe>',
      '/noop':'<h1>章节详情</h1><button>下一节</button>',
      '/dead':'<span onclick="window.clicked=true">2.1 无效链接</span>',
    };
    // Whitespace in the next button should match the actual compact label.
    fixtures['/live']=fixtures['/live'].replace('下 一 节','下一节');
    await context.route('https://fixture.chaoxing.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fixtures[new URL(route.request().url()).pathname]||''}));
    await context.route('https://document-fixture.example.test/preview',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div style="height:2200px">文档内容</div><p>文档末页</p>'}));
    const page=await context.newPage();
    await page.addInitScript(defaultMuteMedia);
    await page.goto('https://fixture.chaoxing.com/course');
    const frame=page.frames()[1];
    const candidates=await chapterCandidates(frame);
    assert.deepEqual(candidates.map(item=>item.title),['1.1 第一次直播课','1.2 映射与函数视频','1.3 课程讲义','2.3 空目录'],'green completed rows excluded; orange zero rows kept in DOM order');
    assert.equal(candidates[0].pending,true,'orange row is pending');
    assert.equal(await enterChapter(page,()=>{}),true,'numbered span enters chapter without legacy CSS');
    assert.equal((await sectionState(page)).livePending,true,'unstarted live recognized');
    await page.goto('https://fixture.chaoxing.com/video');
    assert.equal(await page.locator('video').evaluate(el=>el.muted&&el.defaultMuted),true,'initial video defaults to mute');
    assert.equal(await page.evaluate(()=>{
      const audio=document.createElement('audio');document.body.append(audio);
      return new Promise(resolve=>queueMicrotask(()=>resolve(audio.muted&&audio.defaultMuted)));
    }),true,'late live audio also defaults to mute');
    assert.equal(await page.locator('video').evaluate(el=>{el.muted=false;el.dispatchEvent(new Event('playing'));return el.muted;}),true,'player startup cannot turn sound on');
    await page.setContent(`<div class="chapter_item" onclick="window.bad=true"><div class="catalog_title" role="link"><div class="catalog_name"><a class="clicktitle"><span class="catalog_sbar">1.1.2</span> 视频</a></div><div class="catalog_task"><div class="catalog_state icon_yiwanc"><span>已完成</span></div></div></div></div>
      <div class="chapter_item" onclick="window.bad=true"><div class="catalog_title" role="link"><div class="catalog_name"><a class="clicktitle"><span class="catalog_sbar">1.2.4</span> 空目录</a></div><div class="catalog_task"><span class="catalog_points_yi">0</span></div></div></div>
      <div class="chapter_item" onclick="location.href='/live'"><div class="catalog_title" role="link"><div class="catalog_name"><a class="clicktitle"><span class="catalog_sbar">1.2.2</span> 视频</a></div><div class="catalog_task"><span class="catalog_points_yi">1</span></div></div></div>`);
    assert.deepEqual((await chapterCandidates(page)).map(c=>c.title),['1.2.4 空目录','1.2.2 视频'],'real modern DOM: icon_yiwanc completed excluded, pending video and zero row kept in DOM order');
    assert.equal(await enterChapter(page,()=>{}),true,'real modern catalogue structure enters live content');
    await page.goto('https://fixture.chaoxing.com/pdf/view');
    assert.equal(await scrollDocuments(page,()=>{},{wait:async()=>{}}),1);
    assert.equal(await page.locator('[data-document-viewer]').evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-3),true,'scroll actual nested document pane to bottom');
    assert.equal(await scrollDocuments(page,()=>{},{cancelled:()=>true}),0,'cancel skips documents');
    await page.goto('https://fixture.chaoxing.com/pdf/inner');
    assert.equal(await scrollDocuments(page,()=>{},{wait:async()=>{}}),1,'viewer with unknown class is supported');
    assert.equal(await page.locator('.unknown-viewer-pane').evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-3),true,'scrollbar reaches bottom inside the courseware pane');
    assert.equal(await page.evaluate(()=>window.viewerScroll),true,'browser dispatches the viewer scroll event');
    assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0,'outer webpage is not scrolled instead of document');
    await page.goto('https://fixture.chaoxing.com/root-course');
    assert.equal(await scrollDocuments(page,()=>{},{wait:async()=>{}}),1,'scrollbar inside nested document iframe');
    assert.equal(await page.frames()[1].evaluate(()=>window.appended&&document.scrollingElement.scrollTop+document.scrollingElement.clientHeight>=document.scrollingElement.scrollHeight-3),true,'continue down after lazy pages extend the document');
    assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0,'dragging iframe scrollbar keeps outer page still');
    await page.goto('https://fixture.chaoxing.com/ananas/modules/pdf/index.html');
    assert.equal(await scrollDocuments(page,()=>{},{wait:async()=>{}}),1,'operate actual cross-origin panView, not the wrapper toolbar');
    assert.equal(await page.frames()[1].evaluate(()=>document.scrollingElement.scrollTop+document.scrollingElement.clientHeight>=document.scrollingElement.scrollHeight-3),true,'inner panView reaches its own bottom');
    await page.goto('https://fixture.chaoxing.com/noop');
    assert.equal(await waitForSectionChange(page,await sectionFingerprint(page),300),false,'nonfunctional next does not count as navigation');
    await page.goto('https://fixture.chaoxing.com/dead');
    assert.equal(await enterChapter(page,()=>{},500),false,'no-op chapter click is not entry');
    const messages=[];
    const result=await brushOne(context,'https://fixture.chaoxing.com/course',m=>messages.push(m));
    assert.match(result,/播放 1 个视频，浏览到底 1 份文档/,'live to video to document end-to-end');
    assert.match(result,/跳过 1 个/);
    assert.ok(messages.some(m=>m.includes('直播')&&m.includes('保留未完成状态')),'unplayed live is reported and kept pending');
    assert.ok(context.pages().some(p=>p.frames().some(f=>f.url().endsWith('/pdf/view'))),'uncompleted live leaves course available');
    await context.close();
    console.log('Course tasks: colored catalogue, confirmed entry, live -> video -> PPT, cancel and no-op navigation passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
