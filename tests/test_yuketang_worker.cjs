const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {answerExercise,workspaceTasks,playVideo,brushYuketang}=require('../yuketang_worker.cjs');
const {hudInitScript,hudUpdate}=require('../browser_worker.cjs');

const quiz=`<div class="J_order" data-order="1" onclick="render()">1</div><div class="container-problem"></div>
<div class="problem-fixedbar"><button onclick="submit()">提交</button></div>
<div style="position:fixed;left:-10000px"><label class="el-radio">E<input type="radio"></label><button>提交</button></div>
<script>
window.submitted=0;function render(){document.querySelector('.container-problem').innerHTML='<div class="subject-item"><div class="item-type">1.单选题</div><div class="problem-body">1+1=?</div>'+['A','B'].map(letter=>'<label class="el-radio">'+letter+'<input type="radio" name="answer" value="'+letter+'"></label>').join('')+'</div>';}
function submit(){window.submitted++;document.querySelector('.subject-item').insertAdjacentHTML('beforeend','<div class="problem-analysis">正确答案 A</div>');parent.postMessage('done','*');}render();
</script>`;

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();
    const page=await context.newPage();
    await page.setContent(quiz);
    const controls={checkpoint:async()=>{},cancelled:()=>false,emitMsg:()=>{},requestAnswers:async questions=>{
      assert.equal(questions[0].options.length,2);
      return {answers:[{i:0,choice:['A']}]};
    }};
    assert.equal(await answerExercise(page,controls),true);
    assert.equal(await page.evaluate(()=>window.submitted),1);
    assert.equal(await page.locator('input:checked').getAttribute('value'),'A');
    await page.setContent(quiz);
    let cancelled=false;
    assert.equal(await answerExercise(page,{...controls,cancelled:()=>cancelled,requestAnswers:async()=>{
      cancelled=true;return {answers:[{i:0,choice:['A']}]};
    }}),false);
    assert.equal(await page.evaluate(()=>window.submitted),0);
    await page.setContent(quiz);
    await assert.rejects(answerExercise(page,{...controls,requestAnswers:async()=>({answers:[{i:0,choice:['Z']}]})}),/有效答案/);
    assert.equal(await page.evaluate(()=>window.submitted),0);
    await page.setContent(quiz+'<div id="homework-automation-risk-challenge"></div>');
    await page.locator('#homework-automation-risk-challenge').evaluate(host=>{
      host.attachShadow({mode:'open'}).innerHTML='<div class="backdrop" style="position:fixed;inset:0">安全核验</div>';
    });
    let verificationWaits=0;
    assert.equal(await answerExercise(page,{...controls,wait:async()=>{
      verificationWaits++;
      await page.locator('#homework-automation-risk-challenge').evaluate(host=>host.remove());
    }}),true);
    assert.equal(verificationWaits,1);
    assert.equal(await page.evaluate(()=>window.submitted),1);
    await page.setContent('<video></video>');
    await page.locator('video').evaluate(video=>Object.defineProperty(video,'ended',{get:()=>true}));
    assert.equal(await playVideo(page,{speed:1,checkpoint:async()=>{},cancelled:()=>false}),true);
    await page.close();
    const workspace=`<div class="nav-progress"><div class="progress-num">完成度 33.33%</div></div>
    <div class="leaf-item" onclick="window.completedVideoClicked=true"><span class="leaf-item-tag">视频</span><span class="leaf-item-title">已完成视频</span><div class="leaf-item-status"></div></div>
    <div class="leaf-item" onclick="document.querySelector('iframe').src='/v2/web/iframe-exercise/1/2'"><span class="leaf-item-tag">作业</span><span class="leaf-item-title">待完成习题</span><div class="leaf-item-status"></div></div>
    <div class="leaf-item" onclick="window.examOpened=true"><span class="leaf-item-tag">考试</span><span class="leaf-item-title">考试</span><div class="leaf-item-status"></div></div><iframe></iframe>
    <script>setTimeout(()=>document.querySelector('.leaf-item-status').innerHTML='<i class="icon-yuanquangou-mianzhuang"></i>',1200);
    addEventListener('message',event=>{if(event.data==='done')document.querySelectorAll('.leaf-item-status')[1].innerHTML='<i class="icon-yuanquangou-mianzhuang"></i>';});</script>`;
    await context.route('https://changjiang.yuketang.cn/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().includes('iframe-exercise')?quiz:workspace}));
    let taskPage;
    const result=await brushYuketang(context,'https://changjiang.yuketang.cn/ai-workspace/lms-graph/1/video/1',{
      ...controls,hudInitScript,hudUpdate,newPage:async()=>taskPage=await context.newPage(),options:{materials:true,quiz:true,exam:true}
    });
    assert.ok(result.includes('确认 1 个任务'));
    assert.equal(await taskPage.evaluate(()=>!!window.examOpened),false);
    assert.equal(await taskPage.evaluate(()=>!!window.completedVideoClicked),false);
    assert.equal((await taskPage.evaluate(workspaceTasks)).filter(task=>task.done).length,2);
    assert.equal(await taskPage.locator('#cx-hud-command option[value="exam"]').isDisabled(),true);
    assert.equal(await taskPage.locator('#cx-hud-run').isDisabled(),true);
    await taskPage.evaluate(()=>{const media=document.createElement('video');media.id='mute-test';document.body.append(media);});
    await taskPage.waitForFunction(()=>document.getElementById('mute-test').muted);
    await taskPage.locator('#mute-test').evaluate(media=>{media.muted=false;});
    await taskPage.waitForFunction(()=>document.getElementById('mute-test').muted);
    const staleWorkspace=`
    <div class="leaf-item" onclick="openExercise(1)"><span class="leaf-item-tag">作业</span><span class="leaf-item-title">第一节习题</span><div class="leaf-item-status"></div></div>
    <div class="leaf-item" onclick="openExercise(2)"><span class="leaf-item-tag">作业</span><span class="leaf-item-title">第二节习题</span><div class="leaf-item-status"></div></div>
    <iframe></iframe><script>window.visited=[];function openExercise(number){window.visited.push(number);document.querySelector('iframe').src='/v2/web/iframe-exercise/1/'+number;}</script>`;
    await context.route('**/ai-workspace/lms-graph/1/exercise/1',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:staleWorkspace}));
    let stalePage,requests=0;
    const continued=await brushYuketang(context,'https://changjiang.yuketang.cn/ai-workspace/lms-graph/1/exercise/1',{
      ...controls,hudInitScript,hudUpdate,newPage:async()=>stalePage=await context.newPage(),options:{materials:false,quiz:true},
      requestAnswers:async questions=>{requests++;assert.ok(requests<=2,'must not repeat submitted exercise');return controls.requestAnswers(questions);},
      stopped:()=>requests>2
    });
    assert.ok(continued.includes('确认 2 个任务'),continued);
    assert.deepEqual(await stalePage.evaluate(()=>window.visited),[1,2]);
    assert.equal(requests,2);
    assert.equal((await stalePage.evaluate(workspaceTasks)).filter(task=>task.done).length,0);
    await context.route('**/v2/web/studentLog/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<button onclick="document.querySelector(\'iframe\').src=\'/pro/lms/test/1/studycontent\'">学习内容</button><iframe></iframe>'}));
    await context.route('**/pro/lms/test/1/studycontent',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<span class="fr num">1</span><div class="chapter-list"><div class="leaf-detail" onclick="window.completedClicked=true"><i class="icon--shipin"></i><span class="progress-wrap">已完成</span></div></div>'}));
    let entryPage;
    const skipped=await brushYuketang(context,'https://changjiang.yuketang.cn/v2/web/studentLog/1?university_id=1',{
      ...controls,hudInitScript,hudUpdate,newPage:async()=>entryPage=await context.newPage(),options:{materials:true,quiz:false}
    });
    assert.ok(skipped.includes('均已完成'));
    assert.equal(await entryPage.frames()[1].evaluate(()=>!!window.completedClicked),false);
    assert.ok(entryPage.url().includes('/studentLog/'));
    await context.close();
    console.log('Yuketang worker passed: scoped options, validated submission, cancellation, completed video, tick verification, HUD and exam exclusion');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
