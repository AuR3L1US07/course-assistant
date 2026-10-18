const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {chromium}=require('../.runtime/playwright-core');

const filename=path.resolve(__dirname,'../browser_worker.cjs');
function worker(){
  const context=vm.createContext({require:createRequire(filename),module:{exports:{}},
    __filename:filename,__dirname:path.dirname(filename),Buffer,URL,console,process:{env:{}},
    setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout,setInterval,clearInterval});
  vm.runInContext(fs.readFileSync(filename,'utf8'),context);
  vm.runInContext(`
    brushTrace=()=>{}; bankImport=()=>0; bankLookup=()=>null;
    let requests=[];
    requestAnswers=async questions=>{
      requests.push(questions.map(q=>({i:q.i,stem:q.stem})));
      return {answers:questions.map(q=>({i:q.i,choice:[requests.length===1?'B':'A']}))};
    };
  `,context);
  return code=>vm.runInContext(code,context);
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const gradePage=await browser.newPage();
    await gradePage.route('https://fixture.chaoxing.com/**',route=>route.fulfill({contentType:'text/html',body:'<body></body>'}));
    await gradePage.goto('https://fixture.chaoxing.com/mooc-ans/work/doHomeWorkNew');
    const gradeRun=worker();
    gradeRun('ensureCxDecoder=async()=>false');
    for(const [label,expected] of [['成绩：100',100],['成绩 100 分',100],['',NaN]]){
      await gradePage.evaluate(label=>{
        document.body.innerHTML='<p>满分：100.0</p><div id="question0"><h3>测试题</h3>得分：25分 我的答案：B 正确答案：A</div><p>'+label+'</p><button onclick="window.redone=true">重做（剩余 5 次）</button>';
        window.redone=false;
      },label);
      const review=await gradeRun('collectReview')(gradePage);
      assert.ok(Object.is(review.score,expected),'read earned overall score only: '+label);
      await gradeRun('redoForFullScore')(gradePage,()=>{});
      assert.equal(await gradePage.evaluate(()=>window.redone),false,'full or unknown score must never trigger redo');
    }
    await gradePage.setContent('<div id="question0"><h3>图中是什么？<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=" width="40" height="40"></h3><ul class="Zy_ulTop"><li>A 圆</li><li>B 方</li></ul></div>');
    const illustrated=await gradeRun('extractQuizQuestions')(gradePage);
    assert.equal(illustrated.length,1);
    assert.equal(illustrated[0].image_data.length,1);
    assert.ok(illustrated[0].image_data[0].startsWith('data:image/png;base64,'));
    await gradePage.close();
    for(const allNew of [false,true]){
      const page=await browser.newPage();
      await page.route('https://fixture.chaoxing.com/**',route=>route.fulfill({contentType:'text/html',body:'<body></body>'}));
      await page.goto('https://fixture.chaoxing.com/mooc-ans/work/doHomeWorkNew');
      await page.evaluate(allNew=>{
        window.submissions=[];
        let round=0;
        const first=['【单选题】原题一：振动的频率是多少？','【单选题】原题二：振幅为 A 的含义是什么？'];
        const second=allNew?['【单选题】全新题一：记录纸的周期是多少？','【单选题】全新题二：质点的圆频率是多少？']:
          [first[1],'【单选题】全新题：记录纸的周期是多少？'];
        function quiz(){
          const stems=round?second:first;
          // Deliberately nest options in a title wrapper, matching the faulty extraction case.
          document.body.innerHTML=stems.map((stem,i)=>`<div id="question${i}"><div class="Zy_TItle">${stem}<ul class="Zy_ulTop">`+
            ['A','B'].map(letter=>`<li class="answerItem"><label><span class="num_option">${letter}</span><input type="radio" name="q${i}" value="${letter}">${letter==='A'?'一个很长很长的选项，不能被包含在题干中':'另一个选项，也不应影响批阅页的题干匹配'}</label></li>`).join('')+
            '</ul></div></div>').join('')+'<button id="submit">提交</button>';
          document.getElementById('submit').onclick=()=>{
            const selected=stems.map((_,i)=>document.querySelector(`input[name="q${i}"]:checked`)?.value||'');
            window.submissions.push(selected);
            if(selected.some(v=>!v))throw new Error('incomplete submission');
            document.body.innerHTML=`<p>已提交 成绩：${round?100:75}</p>`+stems.map((stem,i)=>
              `<div id="question${i}"><h3>${stem}</h3>我的答案：${selected[i]} 正确答案：${round?'A':i?'B':'A'}</div>`).join('')+
              (round?'':'<button id="redo">重做（剩余 5 次）</button>');
            if(!round)document.getElementById('redo').onclick=()=>{round++;quiz();};
          };
        }
        quiz();
      },allNew);
      const run=worker();
      const messages=[];
      assert.equal(await run('tryAnswerQuiz')(page,m=>messages.push(m)),2,'new questions must be answered and the redo completed: '+messages.join(' | '));
      const requests=JSON.parse(run('JSON.stringify(requests)'));
      assert.equal(requests.length,2);
      assert.ok(requests.every(batch=>batch.every(q=>!q.stem.includes('选项'))),'stems exclude nested options');
      assert.deepEqual(requests[1].map(q=>q.i),allNew?[0,1]:[1],'only unmatched questions go to the answer service');
      const submissions=await page.evaluate(()=>window.submissions);
      assert.deepEqual(submissions,allNew?[['B','B'],['A','A']]:[['B','B'],['B','A']]);
      await page.close();
    }
    console.log('Real DOM redo flow passed: extraction -> first submission -> changed questions -> mixed known/new answers -> second submission -> review');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
