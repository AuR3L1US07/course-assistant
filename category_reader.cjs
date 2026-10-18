// Read-only category counts. Missing or unquantified rules remain unknown.
function loadedRules(text){
  return /(?:章节任务点|章节测验|作业|考试|章节学习次数|讨论)\s*[:：]\s*\d+(?:\.\d+)?\s*%/.test(text);
}

function parseDiscussion(text, recordText){
  const progress=recordText.match(/讨论\s*([\d,]+)\s*帖\s*发帖\s*([\d,]+)\s*帖\s*回帖/);
  const rule=text.match(/讨论\s*[:：]\s*(\d+(?:\.\d+)?)\s*%([\s\S]*?)(?=(?:章节任务点|章节测验|作业|考试|章节学习次数|课程积分|签到)\s*[:：]|考核内容|$)/);
  const result={required:null,done:null,applies:null,error:'讨论要求尚未识别。'};
  if(!rule){
    if(loadedRules(text)&&!text.includes('讨论'))return {required:0,done:0,applies:false,error:''};
    return result;
  }
  result.applies=Number(rule[1])>0;
  if(!result.applies)return {required:0,done:0,applies:false,error:''};
  const posts=rule[2].match(/发帖(?:数)?\s*(?:需|至少|达到|达|不少于|为)?\s*(\d+)\s*(?:次|帖|条|个)/);
  const replies=rule[2].match(/(?:回帖|回复)(?:数)?\s*(?:需|至少|达到|达|不少于|为)?\s*(\d+)\s*(?:次|帖|条|个)/);
  if(posts||replies){
    const p=posts?Number(posts[1]):0, r=replies?Number(replies[1]):0;
    result.required=p+r;
    if(progress)result.done=Math.min(p,Number(progress[1].replaceAll(',','')))+Math.min(r,Number(progress[2].replaceAll(',','')));
    result.error=progress?'':'讨论已完成数未读取到。';
  }else{
    result.applies=null;
    result.error='考核标准包含讨论计分项，但未识别到必须完成的讨论任务或数量。';
  }
  return result;
}

function parseActivities(statuses){
  const match=statuses.join('\n').match(/进行中\s*[（(]\s*([\d,]+)\s*[）)]/);
  if(!match)return {required:null,done:null,applies:null,error:'未读到进行中任务数量。'};
  const active=Number(match[1].replaceAll(',',''));
  // An active activity may already have been answered, signed or voted in.
  // Without individual participation evidence do not call all of them undone.
  return {required:active,done:active===0?0:null,applies:active>0,
    error:active?'进行中活动数量已读取，参与完成状态需核对；未将进行中数量当作剩余数量。':''};
}

function mergeDiscussionTopics(discussion, count){
  if(count===0)return {required:0,done:0,applies:false,topics:0,error:''};
  if(!Number.isInteger(count)||count<0)return {...discussion,error:'讨论列表未读取到，不能确认是否有话题。'};
  return {...discussion,topics:count,
    error:discussion.applies===null?`发现 ${count} 条话题，但尚未识别必须参与的数量。`:discussion.error};
}

function parseHomework(text, statuses){
  const unknown={required:null,done:null,applies:null,error:'作业列表未完整读取。'};
  if(/暂无作业|没有作业|暂无相关作业/.test(text)&&statuses.length===0)
    return {required:0,done:0,applies:false,error:''};
  // The list's x/y counter describes loaded rows, not completed homework.
  const count=text.match(/未完成\s*(\d+)\s*\/\s*(\d+)/);
  if(!count || Number(count[1])!==Number(count[2]) || statuses.length!==Number(count[2]))return unknown;
  if(statuses.some(s=>! /^(已完成|未完成|待批阅|已批阅|未提交|已提交|已截止|未开始)$/.test(s.trim())))return unknown;
  return {required:statuses.length,done:statuses.filter(s=>/^(已完成|待批阅|已批阅|已提交)$/.test(s.trim())).length,
    applies:statuses.length>0,error:''};
}

async function readOtherCategories(page, discussion, stopped){
  const result={task:{required:null,done:null,applies:null,error:'任务未读取。'},homework:{required:null,done:null,applies:null,error:'作业未读取。'},discussion};
  for(const [label,key,host,prefix] of [
    ['任务','task','mobilelearn.chaoxing.com','/page/active/'],
    ['作业','homework','mooc1.chaoxing.com','/mooc2/work/list'],
    ['讨论','discussion','groupweb.chaoxing.com','/course/topic/'],
  ]){
    if(stopped())break;
    try{
      // 菜单异步渲染，轮询等待出现；超时才判定为无此类别。
      let menu=null;
      for(let i=0;i<20&&!stopped();i++){
        const candidate=page.getByText(label,{exact:true}).first();
        if(await candidate.count()&&await candidate.isVisible().catch(()=>false)){menu=candidate;break;}
        await page.waitForTimeout(150);
      }
      if(!menu){
        // A missing menu can mean navigation/loading failed, not zero tasks.
        result[key]={...result[key],error:`${label}菜单未读取到，需重新检查。`};
        continue;
      }
      await menu.click({timeout:4000});
      // 计数器初始为 0，随列表异步加载；短间隔轮询直至读到有效值。
      let observed=false;
      for(let i=0;i<40&&!stopped();i++){
        for(const frame of page.frames()){
          let url;try{url=new URL(frame.url());}catch{continue;}
          if((key==='homework'?!/^(mooc1|mooc2-ans)\.chaoxing\.com$/.test(url.hostname):url.hostname!==host) || !url.pathname.startsWith(prefix))continue;
          if(key==='task'){
            const statuses=await frame.locator('.status').allTextContents();
            // Some versions render the tabs without a .status class.
            const metric=parseActivities(statuses.length?statuses:
              [await frame.locator('body').innerText({timeout:2000})]);
            // The initial tab counter is often zero until the AJAX response.
            // Keep polling zeroes through the entire loading window; only
            // accept a zero on the final observation, never reuse an old zero.
            if(metric.required>0 || (metric.required===0&&i===39)){
              result.task=metric;observed=true;break;
            }
          }else if(key==='homework'){
            const text=await frame.locator('body').innerText({timeout:2000});
            const metric=parseHomework(text,await frame.locator('.status').allTextContents());
            if(metric.required!==null){result.homework=metric;observed=true;break;}
          }else{
            const text=await frame.locator('body').innerText({timeout:2000});
            const count=text.match(/共\s*(\d+)\s*条话题/);
            if(count){
              result.discussion=mergeDiscussionTopics(discussion,Number(count[1]));
              observed=true;break;
            }
          }
        }
        if(observed)break;
        await page.waitForTimeout(150);
      }
    }catch{
      if(key!=='discussion')result[key].error=`${label}页面读取失败。`;
      else result.discussion={...discussion,error:discussion.error||'讨论列表读取失败。'};
    }
  }
  return result;
}

module.exports={loadedRules,parseDiscussion,parseActivities,parseHomework,mergeDiscussionTopics,readOtherCategories};
