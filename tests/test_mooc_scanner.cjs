const assert=require('node:assert/strict');
const {scanMooc,scanConcurrently,learningURL,outlineMetrics,outlineDOM,submitted,assessmentMetric,homeworkStatusDOM,homeworkReviews}=require('../mooc_scanner.cjs');
const {authenticated}=require('../mooc_login.cjs');

assert.equal(learningURL('/spoc/learn/HDU-123#/learn/score'),'https://www.icourse163.org/spoc/learn/HDU-123#/learn/content');
assert.throws(()=>learningURL('https://icourse163.org.attacker.test/learn/HDU-123'));
assert.throws(()=>learningURL('/course/HDU-123'));
assert.equal(submitted('1/2'),true);
assert.equal(submitted('0/2'),false);
assert.equal(submitted('未出分'),null);
assert.deepEqual(assessmentMetric([{done:true},{done:null}]),{required:2,done:null,error:'部分提交状态未识别，请打开课程核对。'});
const leaves=[{id:'1',kind:'视频',done:true},{id:'2',kind:'视频',done:false},{id:'3',kind:'文档',done:true},{id:'4',kind:'讨论',done:false}];
assert.deepEqual(outlineMetrics([...leaves,leaves[0]]),{
  courseware:{required:3,done:2,videos:{required:2,done:1},documents:{required:1,done:1}},discussion:{required:1,done:0}});
assert.throws(()=>outlineMetrics([{id:'1',kind:'视频',done:true},{id:'1',kind:'视频',done:false}]));
assert.throws(()=>outlineMetrics([{kind:'文档',done:false}]));
// Exercise the actual DOM reader with learned vs gray classes, not title text.
const leaf=(id,kind,done)=>({getAttribute:()=>id,classList:{contains:cls=>cls==='learned'&&done},
  querySelector:selector=>selector==='.tag'?{textContent:kind}:null});
global.document={querySelector:()=>({querySelectorAll:selector=>selector==='.sourceList .lsicon'?
  [leaf('1','视频',true),leaf('2','文档',false)]:[]})};
assert.deepEqual(outlineDOM().items,[{id:'1',kind:'视频',done:true},{id:'2',kind:'文档',done:false}]);
delete global.document;
const banner=(text,visible=true)=>({textContent:text,getClientRects:()=>visible?[{}]:[]});
const phase=(label,classes,visible=true)=>({getClientRects:()=>visible?[{}]:[],
  querySelector:selector=>selector==='span'?{textContent:label}:{classList:{contains:c=>classes.includes(c)}}});
let banners=[banner('作业未提交',false),banner(' 作业已完成并提交\n'),banner('作业已完成并提交')];
let phases=[phase('完成并提交 作业',['undone','done']),phase('互评 作业',['undone']),phase('自评 作业',['undone','done']),phase('互评训练',['undone'],false)];
global.document={querySelector:()=>({querySelectorAll:selector=>selector==='.jdtab'?phases:banners})};
assert.deepEqual(homeworkStatusDOM(),{done:true,reviews:{peer:false,self:true}});
banners=[];
phases=[phase('完成并提交 作业',['undone','done'])];
assert.deepEqual(homeworkStatusDOM(),{done:true,reviews:{}},'submission checkmark is independent proof');
phases=[phase('完成并提交 作业',['undone'])];
assert.deepEqual(homeworkStatusDOM(),{done:false,reviews:{}});
delete global.document;
assert.deepEqual(homeworkReviews([{reviews:{peer:false,self:true}},{reviews:{peer:true}}]),{
  peer:{required:2,done:1},self:{required:1,done:1}});
assert.deepEqual(homeworkReviews([{reviews:{}}]),{},'hide phases not offered');
assert.deepEqual(homeworkReviews([{reviews:{peer:true}},{}]),{peer:{required:null,done:null}},'failed pages do not imply absent phases');

function scenario({stop=false,fail=false}={}) {
  const events=[],actions=[],navigations=[]; let created=0;
  const courses=[{name:'数学实验',url:'/learn/HDU-1',availability:'学期结束'},
    {name:'未开课',url:'/learn/HDU-2',availability:'距离开课还有 2 天'},
    {name:'学校课程',url:'/spoc/learn/HDU-3',availability:''}];
  const newPage=async()=>{
    const role=created++===0?'catalog':'detail';
    let current='',section=0,expanded=false,quizExpanded=false,closed=false;
    const locator=selector=>({
      first(){return this;}, nth(){return this;},filter(){return this;},
      locator:child=>locator(child),
      count:async()=>selector==='.navLoginBtn:visible'?0:1,
      isVisible:async()=>selector!=='暂不评价',
      waitFor:async()=>{},
      getAttribute:async key=>key==='href'?'/home.htm?userId=123':null,
      innerText:async()=> selector==='a'?(current.includes('spocCourse')?'SPOC课程(1)':'MOOC课程(2)'):'已加载',
      click:async()=>{
        actions.push(selector);
        assert.ok(!/提交|开始|sourceList|lsicon|视频|文档/.test(selector));
        if(selector.includes('next'))section++;
        if(selector==='.j-titleBox'){expanded=true;quizExpanded=true;}
        if(selector==='.j-quizBtn')current=current.replace(/#.*$/,'#/learn/hw?id=1');
      },
    });
    return {
      url:()=>current,
      goto:async url=>{navigations.push(url);current=url;if(url.includes('/learn/HDU-2'))current='https://www.icourse163.org/course/HDU-2';},
      reload:async()=>{},locator,
      getByText:text=>({...locator(text),isVisible:async()=>text==='作业已完成并提交'}),
      waitForURL:async()=>{},waitForTimeout:async()=>{},
      close:async()=>{closed=true;},
      evaluate:async fn=>{
        if(fn.name==='homeworkStatusDOM')return {done:true,reviews:{peer:false,self:false}};
        if(fn.name==='catalogDOM')return [courses[current.includes('spocCourse')?2:section]];
        if(fn.name==='outlineDOM') {
          if(fail)throw Error('课件加载失败');
          return {chapters:1,collapsed:expanded?[]:[0],items:leaves,empty:false};
        }
        if(fn.name==='assessmentsDOM')return {empty:false,items:[
          {index:0,name:'测验',kind:'quiz',submissions:quizExpanded?'1/2':''},
          {index:1,name:'未提交测验',kind:'quiz',submissions:'0/2'},
          {index:2,name:'未出分作业',kind:'homework',submissions:''}]};
        throw Error('unexpected DOM read');
      },
      get closed(){return closed;},
    };
  };
  return {events,actions,navigations,newPage,stopped:()=>stop,emit:(type,data)=>events.push({type,...data})};
}
(async()=>{
  const s=scenario();
  const result=await scanMooc({},s);
  assert.match(result,/发现 3 门.*完整读取 2 门，1 门待确认/);
  assert.deepEqual(s.events.find(e=>e.type==='catalog').courses.map(c=>c.course_type),['MOOC','MOOC','SPOC']);
  const records=s.events.filter(e=>e.type==='course');
  const completed=records.find(e=>e.url.includes('/HDU-1#'));
  const upcoming=records.find(e=>e.url.includes('/HDU-2#'));
  assert.equal(completed.metrics.courseware.done,2);
  assert.deepEqual(completed.metrics.quiz,{required:2,done:1,error:''});
  assert.deepEqual(completed.metrics.homework,{required:1,done:1,error:'',reviews:{peer:{required:1,done:0},self:{required:1,done:0}}});
  assert.equal(upcoming.counts,null);
  assert.equal(upcoming.metrics.courseware.required,null,'upcoming must not become zero');
  assert.ok(s.actions.includes('#j-coursewrap .ux-pager_btn__next a'),'read all pages');
  assert.equal(s.navigations.filter(url=>url.endsWith('#/learn/testlist')).length,2,
    'no return to assessment list after the final homework');
  const failed=scenario({fail:true});
  await scanMooc({},failed);
  const failedCourse=failed.events.find(e=>e.type==='course' && e.url.includes('/HDU-1#'));
  assert.equal(failedCourse.counts,null);
  assert.match(failedCourse.metrics.courseware.error,/加载失败/);
  await assert.rejects(()=>scanMooc({},scenario({stop:true})),/stopped/);
  const anonymous={url:()=> 'https://www.icourse163.org/',locator:()=>({count:async()=>0}),getByText:()=>({count:async()=>0})};
  assert.equal(await authenticated(anonymous),false,'teacher /u/ links do not prove login');
  // Slow readers overlap, but no more than three courses run at once.
  let active=0, peak=0;
  const visited=[];
  await scanConcurrently([0,1,2,3,4,5,6],async item=>{
    active++; peak=Math.max(peak,active);
    await new Promise(resolve=>setImmediate(resolve));
    visited.push(item);active--;
  });
  assert.equal(peak,3);
  assert.deepEqual(visited.sort(),[0,1,2,3,4,5,6]);
  // Cancellation does not schedule the rest of the queue, and drains readers.
  let cancelled=false, started=0, finished=0;
  await assert.rejects(()=>scanConcurrently([0,1,2,3,4,5],async()=>{
    started++;
    await new Promise(resolve=>setImmediate(resolve));
    cancelled=true;finished++;
  },()=>cancelled),/stopped/);
  assert.equal(started,3);assert.equal(finished,3);
  let drained=false;
  await assert.rejects(()=>scanConcurrently([0,1,2],async item=>{
    if(item===0)throw Error('read failed');
    await new Promise(resolve=>setImmediate(resolve));
    drained=true;
  }),/read failed/);
  assert.equal(drained,true,'wait for active readers even after failure');
  console.log('MOOC/SPOC scanning, completion, pagination and cancellation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
