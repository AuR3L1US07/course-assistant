// Refresh at the requested interval, but completion is always read from the site.
async function refreshVisits({read,refresh,wait,stopped,onCounts,report}){
  let observed=await read(), unchanged=0, refreshes=0;
  onCounts(observed);
  const valid=value=>Number.isInteger(value?.done)&&value.done>=0&&Number.isInteger(value?.required)&&value.required>0;
  if(!valid(observed))return '未识别到明确的学习次数要求或当前次数，未开始刷新。';
  while(!stopped()&&refreshes<10000){
    if(observed.done>=observed.required)return `学习次数已达标：${observed.done}/${observed.required}。`;
    const batch=Math.min(10,observed.required-observed.done);
    report(`已学 ${observed.done}/${observed.required}，每隔 5 秒刷新章节页，随后核对平台记录。`);
    for(let i=0;i<batch&&!stopped();i++){
      await wait(5000);
      if(stopped())break;
      await refresh();
      refreshes++;
    }
    if(stopped())break;
    const next=await read();
    onCounts(next);
    if(!valid(next))return '学习次数核对失败，已暂停刷新，请重新检查。';
    unchanged=next.done<=observed.done?unchanged+1:0;
    observed=next;
    if(unchanged>=3)return '连续三次核对未见学习次数增加，已暂停，请确认平台是否计数。';
  }
  return stopped()?'学习次数刷新已停止。':'本轮达到刷新上限，已暂停，请重新检查。';
}

module.exports={refreshVisits};
