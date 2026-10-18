const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {chromium}=require('../.runtime/playwright-core');

const filename=path.resolve(__dirname,'../browser_worker.cjs');
const sandbox=vm.createContext({require:createRequire(filename),module:{exports:{}},
  __filename:filename,__dirname:path.dirname(filename),Buffer,URL,console,
  process:{env:{CX_NO_HUD_POLL:'1'}},setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(fs.readFileSync(filename,'utf8'),sandbox);
vm.runInContext('brushTrace=()=>{};',sandbox);
const run=code=>vm.runInContext(code,sandbox);

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:650}});
    const fixtures={
      '/mycourse/studentstudy':'<input id="chapterIdid" value="10"><h1>章节详情</h1><p id="timer">0:00</p><iframe src="/ananas/dialog/ballchart"></iframe>',
      '/ananas/dialog/ballchart':'<h2>知识扩展</h2><a href="https://fixture.invalid">扩展阅读</a>',
      '/video':'<video></video>',
      '/unknown':'<h1>页面加载中</h1>',
      '/ananas/modules/pdf/index.html':'<iframe id="panView" src="about:blank"></iframe>',
      '/catalog':'<div><span style="background:orange">0</span><a class="posCatalog_name" href="/empty">3.1 空章节</a></div>'+
        '<div><span style="background:orange">1</span><a class="posCatalog_name" href="/video">3.1.1 视频</a></div>',
    };
    await page.route('https://fixture.chaoxing.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',
      body:fixtures[new URL(route.request().url()).pathname]||'<h1>章节详情</h1>'}));
    const base='https://fixture.chaoxing.com';
    await page.goto(base+'/mycourse/studentstudy?chapterId=10');
    const fingerprint=await run('sectionFingerprint')(page);
    await page.locator('#timer').evaluate(el=>el.textContent='0:15，缓冲中，视频使用 1 倍速播放');
    await page.frames()[1].evaluate(()=>document.body.append('新增目录提示'));
    assert.equal(await run('sectionFingerprint')(page),fingerprint,'playback text must not look like a chapter change');
    await page.locator('#chapterIdid').evaluate(el=>el.value='11');
    assert.notEqual(await run('sectionFingerprint')(page),fingerprint,'real chapter changes remain detectable');
    const started=Date.now();
    assert.equal((await run('waitForSection')(page,10000)).knowledge,true);
    assert.ok(Date.now()-started<1500,'known knowledge content must not consume the 10-second timeout');
    let waited=0;
    const wait=async ms=>{waited+=ms;};
    assert.equal(await run('scrollDocuments')(page,()=>{},{wait}),0);
    assert.equal(waited,0,'knowledge content must not poll for absent document frames');
    await page.goto(base+'/video');
    await run('scrollDocuments')(page,()=>{},{wait});
    assert.equal(waited,0,'video content must not poll for absent document frames');
    await page.goto(base+'/unknown');
    await run('scrollDocuments')(page,()=>{},{wait});
    assert.equal(waited,10000,'unknown/lazy content retains its loading allowance');

    await page.goto(base+'/catalog');
    const candidates=await run('chapterCandidates')(page);
    assert.equal(candidates[0].zero,true);
    assert.equal(candidates[0].pending,true);
    const originalReload=page.reload.bind(page);
    let reloads=0;
    page.reload=async(...args)=>{reloads++;return originalReload(...args);};
    assert.equal(await run('gotoFirstPending')(page,()=>{},new Set()),true);
    assert.ok(page.url().endsWith('/empty'),'visit orange zero-task chapters in catalogue order');
    assert.equal(reloads,0,'normal transition reuses the existing catalogue');
    await page.goto(base+'/catalog');
    assert.equal(await run('gotoFirstPending')(page,()=>{},new Set([base+'/catalog|3.1 空章节'])),true);
    assert.ok(page.url().endsWith('/video'),'already visited zero-task chapters do not block later tasks');

    // Mount real HUDs across actual navigations, keeping task operations mocked.
    sandbox.testPage=page;
    run(`
      taskPage=async()=>testPage;
      needsLogin=async()=>false;
      enterChapter=async()=>{await testPage.goto('https://fixture.chaoxing.com/next-chapter');return true;};
      waitForSection=async()=>({quiz:true});
      playVideos=async()=>0;
      scrollDocuments=async()=>0;
      tryAnswerQuiz=async()=>0;
    `);
    const task=run('brushOne')({},base+'/first-chapter',()=>{});
    await page.waitForFunction(()=>document.getElementById('cx-hud-text')?.textContent.includes('本节测验未完成'));
    assert.ok(!(await page.locator('#cx-hud-text').innerText()).includes('初始化'));
    run('stopped=true');
    await task;
    // Render a recreated overlay with the same status-update helper for visual QA.
    await page.locator('#cx-hud').evaluate(el=>el.remove());
    await page.evaluate(run('hudInitScript'));
    await run('hudUpdate')(page,'视频使用 1 倍速播放。');
    await page.screenshot({path:path.resolve(__dirname,'../.test-artifacts/hud-status.png')});
    await page.close();
    console.log('Navigation performance passed: stable playback identity, instant known content, lazy fallback, zero-task visits, no normal reload, persistent HUD status');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
