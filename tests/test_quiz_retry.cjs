const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');

// Isolate worker state and replace site/API operations; never touch personal data.
const filename=path.resolve(__dirname,'../browser_worker.cjs');
function worker(){
  const context=vm.createContext({
    require:createRequire(filename),module:{exports:{}},
    __filename:filename,__dirname:path.dirname(filename),Buffer,console,
    process:{env:{CX_NO_HUD_MOUNT:'1',CX_NO_HUD_POLL:'1'}},
    setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout,
    setInterval,clearInterval,
  });
  vm.runInContext(fs.readFileSync(filename,'utf8'),context);
  vm.runInContext('brushTrace=()=>{}; bankImport=()=>0;',context);
  return code=>vm.runInContext(code,context);
}

(async()=>{
  const font=worker();
  font(`
    buildCxDecoder=b64=>{cxDecoder=text=>b64+':'+text;return true;};
    let currentFont='first';
    const frame={evaluate:async()=>currentFont?[currentFont]:[]};
  `);
  assert.equal(await font('ensureCxDecoder(frame)'),true);
  assert.equal(font("cxDecode('题目')"),'first:题目');
  font("currentFont='redo'");
  assert.equal(await font('ensureCxDecoder(frame)'),true);
  assert.equal(font("cxDecode('题目')"),'redo:题目','same frame must use the new font');
  font("currentFont=''");
  assert.equal(await font('ensureCxDecoder(frame)'),false);
  assert.equal(font("cxDecode('题目')"),'题目','missing font must clear the stale decoder');

  const answer=worker();
  answer(`
    confirmLeaveDialog=async()=>null;
    findQuizFrame=async()=>({evaluate:async fn=>fn===quizClickScript});
    extractQuizQuestions=async()=>[{i:0,stem:'题目',options:['A','B']}];
    bankLookup=()=> 'A';
    attemptSubmit=async()=> 'success';
    redoForFullScore=async()=>false;
  `);
  assert.equal(await answer('tryAnswerQuiz({},()=>{})'),0,'failed redo invalidates first submission success');
  answer('redoForFullScore=async()=>{throw new Error("detached frame");}');
  assert.equal(await answer('tryAnswerQuiz({},()=>{})'),0,'redo exception must also block navigation');
  answer('redoForFullScore=async()=>true');
  assert.equal(await answer('tryAnswerQuiz({},()=>{})'),1);

  const redo=worker();
  redo(`
    let review={score:100,hasRedo:false,redoLeft:0,answers:[{stem:'题目',mine:'A',correct:'A'}]};
    collectReview=async()=>review;
  `);
  assert.equal(await redo('redoForFullScore({},()=>{})'),true,'full score on the last attempt is success');
  redo("review={score:75,hasRedo:true,redoLeft:2,answers:[{stem:'题目',mine:'',correct:'A'}]}");
  assert.equal(await redo('redoForFullScore({},()=>{})'),false,'missing answers cannot prove full score');
  redo(`
    let submits=0;
    review={score:75,hasRedo:true,redoLeft:2,
      answers:[{stem:'题目',mine:'B',correct:'A'}],frame:{evaluate:async()=>true}};
    findQuizFrame=async()=>({evaluate:async fn=>fn===quizClickScript});
    extractQuizQuestions=async()=>[{i:0,stem:'known',options:['A','B']},{i:2,stem:'unknown',options:['A','B']}];
    matchCorrect=stem=>stem==='known'?'A':null;
    requestAnswers=async()=>null;
    attemptSubmit=async()=>{submits++;return 'success';};
  `);
  assert.equal(await redo('redoForFullScore({frames:()=>[]},()=>{})'),false);
  assert.equal(redo('submits'),0,'partial redo must not submit');
  redo(`
    let requested=[],clicked=[];
    requestAnswers=async questions=>{requested=questions.map(q=>q.i);return {answers:[{i:0,choice:['D']},{i:2,choice:['B']},{i:2,choice:['B']}]};};
    findQuizFrame=async()=>({evaluate:async(fn,args)=>{if(fn===quizClickScript){clicked.push(args.qi);return true;}return false;}});
    unansweredIndexes=async()=>[];
    attemptSubmit=async()=>{submits++;review={score:100,hasRedo:false,redoLeft:0,answers:[{stem:'known',mine:'A',correct:'A'}]};return 'success';};
  `);
  assert.equal(await redo('redoForFullScore({frames:()=>[]},()=>{})'),true);
  assert.deepEqual(Array.from(redo('requested')),[2],'request the original DOM index for unmatched questions');
  assert.deepEqual(Array.from(redo('clicked')),[0,2],'ignore unsolicited and duplicate answers');
  assert.equal(redo('submits'),1);
  redo(`
    submits=0;
    const pendingReview={score:75,hasRedo:true,redoLeft:5,
      answers:[{stem:'known',mine:'B',correct:'A'}],frame:{evaluate:async()=>true}};
    review=pendingReview;
    extractQuizQuestions=async()=>[{i:0,stem:'known'}];
    attemptSubmit=async()=>{submits++;review=submits===3?
      {score:100,hasRedo:false,redoLeft:0,answers:[{stem:'known',mine:'A',correct:'A'}]}:pendingReview;
      return 'success';};
  `);
  assert.equal(await redo('redoForFullScore({frames:()=>[]},()=>{})'),true,'check the review after the third and final redo');
  assert.equal(redo('submits'),3);

  for(const reviewMode of [false,true]){
    const navigation=worker();
    navigation(`
      let jumps=0,closed=false;
      const page={on:()=>{},addInitScript:async()=>{},goto:async()=>{},
        url:()=> 'https://test.chaoxing.com/course',
        getByText:()=>({first:()=>({click:async()=>{}})}),
        close:async()=>{closed=true;}};
      taskPage=async()=>page;
      hudUpdate=async()=>{};
      needsLogin=async()=>false;
      enterChapter=async()=>true;
      waitForSection=async()=>({quiz:true});
      waitWhilePaused=async()=>{};
      sectionFingerprint=async()=> 'same-section';
      playVideos=async()=>0;
      scrollDocuments=async()=>0;
      quizReviewMode=async()=>${reviewMode};
      redoForFullScore=async()=>false;
      tryAnswerQuiz=async()=>0;
      gotoFirstPending=async()=>{jumps++;return false;};
      findNext=async()=>{jumps++;return null;};
      navChanged=async()=>false;
    `);
    await navigation("brushOne({},'https://test.chaoxing.com/course',()=>{})");
    assert.equal(navigation('jumps'),0,'unresolved quiz must not attempt either navigation path');
    assert.equal(navigation('closed'),false,'leave the unanswered page open');
  }
  console.log('Quiz retry: font refresh, submission propagation, partial answers and navigation guards passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
