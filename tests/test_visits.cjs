const assert=require('node:assert/strict');
const {refreshVisits}=require('../learning_visits.cjs');
(async()=>{
 let refreshed=0;
 const base={wait:async ms=>assert.equal(ms,5000),stopped:()=>false,onCounts:()=>{},report:()=>{}};
 const refresh=async()=>{refreshed++;};
 let result=await refreshVisits({...base,read:async()=>({done:335,required:300}),refresh});
 assert.equal(refreshed,0);assert.match(result,/已达标/);
 result=await refreshVisits({...base,read:async()=>({done:0,required:null}),refresh});
 assert.equal(refreshed,0);assert.match(result,/未开始/);
 let count=0;
 result=await refreshVisits({...base,read:async()=>({done:count,required:3}),refresh:async()=>{count++;}});
 assert.equal(count,3);assert.match(result,/已达标/);
 count=0;
 result=await refreshVisits({...base,read:async()=>({done:0,required:100}),refresh:async()=>{count++;}});
 assert.equal(count,30);assert.match(result,/未见学习次数增加/);
 let stopped=false;
 result=await refreshVisits({...base,read:async()=>({done:0,required:3}),stopped:()=>stopped,
   wait:async()=>{stopped=true;},refresh:async()=>{throw Error('must not refresh after stop');}});
 assert.match(result,/已停止/);
})().catch(error=>{console.error(error);process.exitCode=1;});
