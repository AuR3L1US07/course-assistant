const {trusted,outlineDOM}=require('./yuketang.cjs');
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

function muteYuketang(){
  if(location.hostname!=='changjiang.yuketang.cn')return;
  const mute=()=>document.querySelectorAll('video,audio').forEach(media=>{media.muted=true;media.defaultMuted=true;});
  mute();
  new MutationObserver(mute).observe(document,{childList:true,subtree:true});
  document.addEventListener('play',mute,true);
  document.addEventListener('volumechange',event=>{if(event.target.matches?.('video,audio')&&!event.target.muted)event.target.muted=true;},true);
}

async function challengePresent(frame){
  return frame.evaluate(()=>{
    const host=document.getElementById('homework-automation-risk-challenge');
    const overlay=host?.shadowRoot?.querySelector('.backdrop');
    return !!overlay&&overlay.getClientRects().length>0;
  });
}

async function waitForVerification(frame,{checkpoint,cancelled,emitMsg,wait=sleep}){
  let seen=false;
  while(!cancelled()&&await challengePresent(frame)){
    if(!seen)emitMsg('请在习题网页完成安全核验，完成后自动继续。');
    seen=true;
    await checkpoint();if(cancelled())break;
    await wait(250);
  }
  if(seen&&!cancelled())emitMsg('安全核验已完成，继续当前习题。');
  return seen;
}

function workspaceTasks(){
  return [...document.querySelectorAll('.leaf-item')].map((row,index)=>({
    index,title:row.querySelector('.leaf-item-title')?.textContent.trim()||'',
    kind:({'视频':'video','作业':'quiz','考试':'exam'})[row.querySelector('.leaf-item-tag')?.textContent.trim()],
    done:!!row.querySelector('.leaf-item-status .icon-yuanquangou-mianzhuang')
  }));
}

async function questionData(frame,capture=true){
  const subject=frame.locator('.container-problem .subject-item:visible').first();
  await subject.waitFor({state:'visible',timeout:15000});
  const question=await subject.evaluate(element=>{
    const heading=element.querySelector('.item-type')?.textContent||'';
    const labels=[...element.querySelectorAll('label.el-radio, label.el-checkbox')].filter(label=>label.getClientRects().length);
    return {i:0,type:/多选/.test(heading)?'multiple':/判断/.test(heading)?'judge':'single',
      stem:element.querySelector('.problem-body')?.innerText.trim()||'',
      options:labels.map(label=>label.innerText.trim()||(label.querySelector('input')?.value==='true'?'正确':label.querySelector('input')?.value==='false'?'错误':'')),
      encrypted:!!element.querySelector('.xuetangx-com-encrypted-font'),
      illustrated:!!element.querySelector('img'),
      number:heading.match(/^\s*(\d+)/)?.[1]||'',
      submitted:!!element.querySelector('.answer-analysis, .problem-analysis')||/正确答案|你的答案/.test(element.innerText)};
  });
  question.identity=JSON.stringify([question.number,question.stem,question.options]);
  if(!question.options.length)throw Error('暂不支持该题型，已保留页面');
  if(capture&&(question.encrypted||question.illustrated)){
    await frame.evaluate(()=>document.fonts.ready);
    const box=await subject.boundingBox();
    if(!box||box.width<=0||box.height<=0)throw Error('题目截图区域未加载');
    const screenshotPage=typeof frame.page==='function'?frame.page():frame;
    const bytes=await screenshotPage.screenshot({type:'png',clip:box,animations:'disabled',timeout:15000});
    if(bytes.length>2000000)throw Error('题目截图过大，已保留页面');
    question.images=['rendered-question'];
    question.image_data=['data:image/png;base64,'+bytes.toString('base64')];
    question.stem='请根据配图中的完整题干与选项作答，按图中选项字母返回答案。'+(question.type==='judge'?'判断题按 A=正确、B=错误返回。':'');
    question.options=question.options.map((option,index)=>String.fromCharCode(65+index)+(question.type==='judge'?' '+option:''));
  }
  return question;
}

async function answerExercise(frame,{requestAnswers,emitMsg,checkpoint,cancelled,wait=sleep}){
  const verification={checkpoint,cancelled,emitMsg,wait};
  await frame.locator('.J_order:visible').first().waitFor({state:'visible',timeout:20000});
  const orders=await frame.locator('.J_order:visible').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-order')));
  if(!orders.length||orders.some(order=>!/^\d+$/.test(order||'')))throw Error('习题题号未识别');
  for(const order of orders){
    await checkpoint();if(cancelled())return false;
    await waitForVerification(frame,verification);if(cancelled())return false;
    if(await frame.locator(`.J_order[data-order="${order}"] .icon-status`).count())continue;
    const navigation=frame.locator(`.J_order[data-order="${order}"]:visible`);
    if(!await navigation.evaluate(element=>element.classList.contains('active')))await navigation.click({timeout:5000});
    await frame.waitForFunction(order=>document.querySelector('.container-problem .item-type')?.textContent.trim().startsWith(order+'.'),order,{timeout:10000});
    const question=await questionData(frame);
    if(question.submitted)continue;
    const identity=question.identity;
    emitMsg(`习题 ${order}/${orders.length}：正在请求 AI 作答…`);
    const reply=await requestAnswers([question],emitMsg);
    await checkpoint();if(cancelled())return false;
    await waitForVerification(frame,verification);if(cancelled())return false;
    const current=await questionData(frame,false);
    if(current.identity!==identity)throw Error('答题期间页面已切换，请重新执行');
    const choice=reply?.answers?.find(answer=>answer.i===0)?.choice;
    if(!Array.isArray(choice)||!choice.length||new Set(choice).size!==choice.length||
      choice.some(letter=>typeof letter!=='string'||!/^[A-Z]$/.test(letter)||letter.charCodeAt(0)-65>=question.options.length)||
      (question.type!=='multiple'&&choice.length!==1))throw Error('AI 未返回有效答案，已保留页面');
    const subject=frame.locator('.container-problem .subject-item:visible').first();
    const labels=subject.locator('label.el-radio:visible, label.el-checkbox:visible');
    for(let index=0;index<await labels.count();index++){
      const label=labels.nth(index);
      const desired=choice.includes(String.fromCharCode(65+index));
      const checked=await label.locator('input').isChecked();
      if(checked!==desired){await checkpoint();if(cancelled())return false;await label.click();}
    }
    const selected=await subject.locator('input:checked').count();
    if(selected!==choice.length)throw Error('答案未确认选中，停止提交');
    await checkpoint();if(cancelled())return false;
    await frame.locator('.problem-fixedbar button:visible').filter({hasText:/^提交$/}).click();
    let verificationRetry=false;
    for(let attempt=0;attempt<20;attempt++){
      await checkpoint();if(cancelled())return false;
      const verified=await waitForVerification(frame,verification);if(cancelled())return false;
      if(verified&&!verificationRetry&&!await frame.locator(`.J_order[data-order="${order}"] .icon-status`).count()){
        const submit=frame.locator('.problem-fixedbar button:visible').filter({hasText:/^提交$/});
        const same=await subject.locator('.item-type').innerText();
        if(same.trim().startsWith(order+'.')&&await submit.isEnabled())await submit.click();
        verificationRetry=true;
      }
      const only=frame.locator('.homework-problem-batch-submit-dialog:visible .rain-btn').filter({hasText:'仅提交本题'});
      if(await only.count())await only.click();
      const blank=frame.locator('.homework-problem-blank-submit-dialog:visible');
      if(await blank.count())throw Error('平台提示空白答案，已停止提交');
      const submitted=await frame.locator(`.J_order[data-order="${order}"] .icon-status`).count()||await subject.evaluate(element=>/正确答案|你的答案|答案解析|回答正确|回答错误/.test(element.innerText));
      if(submitted)break;
      if(attempt===19)throw Error('习题提交结果未确认，已保留页面');
      await wait(300);
    }
    emitMsg(`习题 ${order}/${orders.length} 已确认提交。`);
  }
  return true;
}

async function playVideo(page,{speed,checkpoint,cancelled,isCompleted=async()=>false,wait=sleep}){
  const video=page.locator('video').first();
  await video.waitFor({state:'attached',timeout:20000});
  let last=-1,stalled=0;
  while(!cancelled()){
    await checkpoint();if(cancelled())return false;
    if(await isCompleted()){await video.evaluate(video=>video.pause());return true;}
    const state=await video.evaluate((video,speed)=>{
      video.muted=true;
      if(Number.isFinite(speed)&&speed>0)video.playbackRate=speed;
      if(video.paused&&!video.ended)video.play().catch(()=>{});
      return {time:video.currentTime,ended:video.ended,error:!!video.error};
    },speed==='auto'?1:speed);
    if(state.error)throw Error('视频播放失败，已保留页面');
    if(state.ended)return true;
    stalled=state.time>last?0:stalled+1;last=state.time;
    if(stalled>60)throw Error('视频长时间未推进，请检查播放或验证提示');
    await wait(1000);
  }
  return false;
}

async function brushYuketang(context,url,{options={},speed='auto',stopped=()=>false,newPage=()=>context.newPage(),trackPage=()=>{},hudInitScript,hudUpdate,requestAnswers,emitMsg=()=>{},wait=sleep}={}){
  let page=await newPage(),polling=false,alive=true,paused=false,pending=null,generation=0,message='正在打开雨课堂学习空间…';
  const selected={video:options.materials!==false,quiz:options.quiz!==false,exam:false};
  const announce=text=>{message=text;emitMsg(text);hudUpdate(page,text);};
  const mount=async()=>{
    if(page.isClosed())return;
    await page.evaluate(hudInitScript,'yuketang').catch(()=>{});
    await hudUpdate(page,message);
  };
  const poll=async()=>{
    if(polling||!alive||page.isClosed())return;
    polling=true;
    try{
      await mount();
      const signal=await page.evaluate(()=>{const signal=window.__cxHud;window.__cxHud=null;return signal;});
      if(signal?.stop){alive=false;await page.evaluate(()=>document.querySelectorAll('video').forEach(video=>video.pause()));return;}
      if(['auto','video','quiz'].includes(signal?.command)){
        pending=signal.command;generation++;paused=false;
        await page.evaluate(()=>document.querySelectorAll('video').forEach(video=>video.pause()));
        announce('收到指令，正在切换任务…');
      }
      if(signal?.pause!==undefined){
        paused=signal.pause;
        if(paused)await page.evaluate(()=>document.querySelectorAll('video').forEach(video=>video.pause()));
        announce(paused?'已暂停，点击「继续」恢复。':'已继续。');
      }
      await page.evaluate(paused=>{const button=document.getElementById('cx-hud-pause');if(button)button.textContent=paused?'继续':'暂停';},paused);
    }catch{}finally{polling=false;}
  };
  const checkpoint=async()=>{while(paused&&alive&&!stopped()&&!page.isClosed())await wait(200);};
  const timer=setInterval(()=>{poll();},250);
  const handleDialog=dialog=>{
    if(/未作答|未答|空白|考试|诚信|协议/.test(dialog.message()))dialog.dismiss().catch(()=>{});
    else if(dialog.type()==='alert'||/提交|确定|确认/.test(dialog.message()))dialog.accept().catch(()=>{});
    else dialog.dismiss().catch(()=>{});
  };
  let completed=0;
  const confirmedTasks=new Set();
  const taskKey=task=>JSON.stringify([task.index,task.kind,task.title]);
  try{
    if(!trusted(url))throw Error('雨课堂课程链接无效');
    await context.addInitScript(muteYuketang);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    if(!page.url().includes('/ai-workspace/')){
      await page.getByText('学习内容',{exact:true}).click();
      let frame=null;
      for(let attempt=0;attempt<80&&!stopped();attempt++){
        for(const candidate of page.frames())if(trusted(candidate.url())&&await candidate.locator('.leaf-detail').count()){frame=candidate;break;}
        if(frame)break;await wait(250);
      }
      if(!frame)throw Error('学习内容目录未加载');
      for(let attempt=0;attempt<80;attempt++){
        if((await frame.evaluate(outlineDOM)).complete)break;
        if(attempt===79)throw Error('目录进度尚未完整加载');
        if(stopped())return '任务已停止。';await wait(250);
      }
      const entry=await frame.locator('.chapter-list .leaf-detail').evaluateAll((rows,selected)=>rows.findIndex(row=>{
        const kind=row.querySelector('.icon--shipin')?'video':row.querySelector('.icon--zuoye')?'quiz':'exam';
        const status=row.querySelector('.progress-wrap')?.textContent.trim()||'';
        return selected[kind]&&status!=='已完成'&&/未开始|进行中|未完成|\d+\s*%/.test(status);
      }),selected);
      if(entry<0){
        announce('所选视频和习题均已完成，已跳过；考试未执行。');
        return '所选视频和习题均已完成，已跳过；考试未执行。';
      }
      const previous=new Set(context.pages());
      await frame.locator('.chapter-list .leaf-detail').nth(entry).click();
      for(let attempt=0;attempt<80;attempt++){
        const opened=context.pages().find(candidate=>!previous.has(candidate)&&trusted(candidate.url())&&candidate.url().includes('/ai-workspace/'));
        if(opened){await page.close();page=opened;trackPage(page);break;}
        if(page.url().includes('/ai-workspace/'))break;
        if(stopped())return '任务已停止。';await wait(250);
      }
    }
    await page.locator('.leaf-item').first().waitFor({state:'attached',timeout:20000});
    await page.waitForFunction(()=>{
      const progress=document.querySelector('.nav-progress .progress-num');
      if(!progress)return true;
      const percent=Number(progress.textContent.match(/[\d.]+/)?.[0]);
      const rows=[...document.querySelectorAll('.leaf-item')];
      const done=rows.filter(row=>row.querySelector('.leaf-item-status .icon-yuanquangou-mianzhuang')).length;
      return rows.length>0&&Math.abs(done*100/rows.length-percent)<.02;
    },null,{timeout:20000});
    await wait(1000);
    page.on('dialog',handleDialog);
    await page.addInitScript(hudInitScript,'yuketang');
    await mount();
    announce('自动刷课已开始：'+[selected.video?'视频':'',selected.quiz?'习题':''].filter(Boolean).join('、')+'；跳过已打勾任务。');
    let mode='auto',idle=false;
    while(alive&&!stopped()&&!page.isClosed()){
      await checkpoint();
      if(pending){mode=pending;pending=null;idle=false;}
      if(idle){await wait(250);continue;}
      const tasks=await page.evaluate(workspaceTasks);
      const task=tasks.find(task=>!task.done&&!confirmedTasks.has(taskKey(task))&&task.kind!=='exam'&&(mode==='auto'?selected[task.kind]:task.kind===mode));
      if(!task){
        if(mode==='auto'){
          const result=`雨课堂所选任务已完成，本轮确认 ${completed} 个任务；考试未执行。`;
          announce(result);return result;
        }
        announce('当前指令没有未完成任务，可点击「恢复自动刷课」。');idle=true;continue;
      }
      const version=generation;
      const cancelled=()=>!alive||stopped()||page.isClosed()||generation!==version;
      const controls={speed,checkpoint,cancelled,requestAnswers,emitMsg:announce,wait,
        isCompleted:async()=>{
          const current=(await page.evaluate(workspaceTasks))[task.index];
          return current?.title===task.title&&current.done;
        }};
      try{
        announce(`正在处理${task.kind==='video'?'视频':'习题'}：${task.title}`);
        await page.locator('.leaf-item').nth(task.index).click();
        await wait(750);
        if(cancelled())continue;
        if(await controls.isCompleted()){announce('已打勾，跳过：'+task.title);continue;}
        let exerciseConfirmed=false;
        if(task.kind==='video')await playVideo(page,controls);
        else{
          let frame=null;
          for(let attempt=0;attempt<80&&!cancelled();attempt++){
            frame=page.frames().find(frame=>trusted(frame.url())&&new URL(frame.url()).pathname.includes('/iframe-exercise/'));
            if(frame)break;await wait(250);
          }
          if(!frame)throw Error('习题页面未加载');
          exerciseConfirmed=await answerExercise(frame,controls);
        }
        if(cancelled())continue;
        let confirmed=exerciseConfirmed;
        for(let attempt=0;!confirmed&&attempt<30&&!cancelled();attempt++){
          const current=(await page.evaluate(workspaceTasks))[task.index];
          if(current?.title===task.title&&current.done){confirmed=true;break;}
          await wait(500);
        }
        if(cancelled())continue;
        if(!confirmed)throw Error('平台尚未显示完成勾，已停止前进');
        confirmedTasks.add(taskKey(task));
        completed++;
        announce(`已确认完成 ${completed} 个任务：${task.title}`);
        if(mode!=='auto')idle=true;
      }catch(error){
        if(cancelled())continue;
        announce(error.message+'。可重新执行指令或恢复自动刷课。');idle=true;
      }
    }
    return '雨课堂任务已停止。';
  }catch(error){announce(error.message);return '雨课堂处理失败，课程页面已保留：'+error.message;}
  finally{
    alive=false;clearInterval(timer);
    page.off('dialog',handleDialog);
    await page.evaluate(()=>{
      document.querySelectorAll('video').forEach(video=>video.pause());
      const panel=document.getElementById('cx-hud');
      panel?.querySelectorAll('button,select').forEach(control=>{control.disabled=true;control.style.opacity='.55';});
      const text=document.getElementById('cx-hud-text');if(text)text.textContent+=' 本轮已结束，请在课程助手重新启动。';
    }).catch(()=>{});
  }
}

module.exports={workspaceTasks,questionData,answerExercise,playVideo,brushYuketang,muteYuketang};
