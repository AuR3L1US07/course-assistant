const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../browser_worker.cjs');
const context=vm.createContext({require:createRequire(filename),module:{exports:{}},
  __filename:filename,__dirname:path.dirname(filename),Buffer,console,process:{env:{}},
  setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(fs.readFileSync(filename,'utf8'),context);
const run=code=>vm.runInContext(code,context);
const plain=value=>JSON.parse(JSON.stringify(value));

(async()=>{
  run(`
    brushTrace=()=>{};
    let calls=[];
    const q={i:0,type:'single',stem:'振幅为 A，周期为 T',options:['A T/4','B T/2']};
    requestAnswers=async questions=>{calls.push(questions.map(q=>q.i));return {answers:questions.map(q=>({i:q.i,choice:['A']}))};};
    const session=createQuizAnswerSession();
  `);
  assert.deepEqual(plain(await run('session([q,{...q,i:4}],()=>{})')),
    {answers:[{i:0,choice:['A']},{i:4,choice:['A']}]});
  assert.deepEqual(plain(run('calls')),[[0]],'identical questions within a request are asked once');
  assert.deepEqual(plain(await run('session([{...q,i:9}],()=>{})')).answers,[{i:9,choice:['A']}]);
  assert.equal(run('calls.length'),1,'click retry reuses the answer at the new DOM index');
  await run('session([{...q,options:[...q.options].reverse()}],()=>{})');
  await run("session([{...q,stem:'振幅为 B，周期为 T'}],()=>{})");
  await run("session([{...q,type:'multiple'}],()=>{})");
  assert.equal(run('calls.length'),4,'options, numbers/text, and type changes invalidate reuse');
  await run("session([{...q,images:['https://fixture.invalid/diagram1.png']}],()=>{})");
  await run("session([{...q,images:['https://fixture.invalid/diagram2.png']}],()=>{})");
  assert.equal(run('calls.length'),6,'different diagrams must not share an answer cache entry');
  await run('createQuizAnswerSession()([q],()=>{})');
  assert.equal(run('calls.length'),7,'new redo attempt cannot inherit ungraded answers');

  run(`
    let incompleteCalls=0;
    const incomplete=createQuizAnswerSession(async()=>{incompleteCalls++;return {answers:[{i:0,choice:['Z']}]};});
  `);
  assert.deepEqual(plain(await run('incomplete([q],()=>{})')).answers,[]);
  await run('incomplete([q],()=>{})');
  assert.equal(run('incompleteCalls'),2,'invalid/missing answers are not cached');

  run(`
    let requests=0,submits=0;
    confirmLeaveDialog=async()=>null;
    findQuizFrame=async()=>({evaluate:async fn=>fn===quizClickScript});
    extractQuizQuestions=async()=>[q];
    bankLookup=()=>null;
    requestAnswers=async()=>{requests++;return {answers:[{i:0,choice:['A']}]};};
    attemptSubmit=async()=>++submits===1?'incomplete':'success';
    unansweredIndexes=async()=>[0];
    redoForFullScore=async()=>true;
  `);
  assert.equal(await run('tryAnswerQuiz({},()=>{})'),1);
  assert.equal(run('requests'),1,'submission retry fills the existing answer without calling AI again');
  assert.equal(run('submits'),2);
  console.log('Quiz answer cache passed: deduplication, retry reuse, strict keys, invalidation and submit retry');
})().catch(error=>{console.error(error);process.exitCode=1;});
