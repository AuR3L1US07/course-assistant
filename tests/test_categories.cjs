const assert=require('node:assert/strict');
const {readOtherCategories}=require('../category_reader.cjs');

async function readTask(values,{missing=false,bodyOnly=false}={}){
  let tick=0,selected='';
  const frame={
    url:()=> 'https://mobilelearn.chaoxing.com/page/active/taskactivelist',
    locator:selector=>({
      allTextContents:async()=>bodyOnly?[]:[values[Math.min(tick,values.length-1)]],
      innerText:async()=>values[Math.min(tick,values.length-1)],
    }),
  };
  const page={
    getByText:label=>({first(){return this;},count:async()=>label==='任务'&&!missing?1:0,
      isVisible:async()=>true,click:async()=>{selected=label;}}),
    frames:()=>selected==='任务'?[frame]:[],
    waitForTimeout:async()=>{tick++;},
  };
  return (await readOtherCategories(page,{applies:null},()=>false)).task;
}

(async()=>{
  const delayed=await readTask([...Array(12).fill('进行中（0）'),'进行中（4）']);
  assert.equal(delayed.required,4);
  assert.equal(delayed.applies,true);
  assert.equal(delayed.done,null);
  assert.equal((await readTask(['进行中（0）'])).applies,false);
  // A disappearing/loading counter cannot confirm absence from an earlier zero.
  assert.equal((await readTask(['进行中（0）','加载中'])).applies,null);
  assert.equal((await readTask(['进行中（2）'],{bodyOnly:true})).required,2);
  assert.equal((await readTask([],{missing:true})).applies,null);
})().catch(error=>{console.error(error);process.exitCode=1;});
