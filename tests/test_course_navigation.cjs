const assert=require('node:assert/strict');
const {links,openLearningCourses}=require('../browser_worker.cjs');

(async()=>{
  let opened=false;
  const courseUrl='https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=123&clazzid=456&cpi=789';
  const frame={
    url:()=> 'https://i.mooc.chaoxing.com/space/',
    evaluate:async()=>opened?[
      {name:'课程甲',url:courseUrl},
      {name:'课程甲',url:courseUrl},
      {name:'站外链接',url:'https://example.com/?courseid=123&clazzid=456'},
      {name:'不完整链接',url:'https://mooc1-2.chaoxing.com/?courseid=123'},
    ]:[],
    locator:selector=>{
      assert.ok(selector.includes('switchM'));
      assert.ok(selector.includes('/visit/interaction'));
      return {count:async()=>2,nth:index=>({
        isVisible:async()=>index===1,
        click:async()=>{opened=true;},
      })};
    },
  };
  const foreign={url:()=> 'https://example.com/',locator:()=>{throw Error('untrusted frame inspected');}};
  const page={frames:()=>[foreign,frame]};
  assert.equal((await links(page)).size,0,'the landing page has no course links');
  assert.equal(await openLearningCourses(page),true);
  const catalog=await links(page);
  assert.equal(catalog.size,1,'deduplicate and retain only complete trusted course URLs');
  assert.equal(catalog.values().next().value.name,'课程甲');
  frame.locator=()=>({count:async()=>0});
  assert.equal(await openLearningCourses(page),false,'missing navigation must remain retryable');
  console.log('Learning-space course navigation and catalogue discovery passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
