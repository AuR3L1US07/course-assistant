// Read the record counter and its grading rule; never generate chapter visits.
const {loadedRules,parseDiscussion}=require('./category_reader.cjs');
function parseCompleted(text){
  const match=text.match(/在线学习\s*(?:详情\s*)?([\d,]+)\s*次\s*章节学习次数/);
  return match?Number(match[1].replaceAll(',','')):null;
}

function parseRequired(text){
  const match=text.match(/章节学习次数\s*达(?:到)?\s*([\d,]+)\s*次\s*(?:为|得|获)?满分/);
  return match?Number(match[1].replaceAll(',','')):null;
}

async function readStudyRecords(page, trackPage, stopped){
  const result={done:null,required:null,error:'',discussion:{required:null,done:null,applies:null,error:'考核标准未读取。'}};
  let grades,recordText='';
  try{
    const menu=page.getByText('学习记录',{exact:true}).first();
    await menu.click({timeout:5000});
    let recordFrame, recordUrl='';
    for(let i=0;i<25&&!stopped();i++){
      for(const frame of page.frames()){
        if(!frame.url().startsWith('https://stat2-ans.chaoxing.com/study-data/'))continue;
        const text=await frame.locator('body').innerText({timeout:1500});
        recordText=text;
        result.done=parseCompleted(text);
        if(result.done!==null){recordFrame=frame;recordUrl=frame.url();break;}
      }
      if(recordFrame)break;
      await page.waitForTimeout(150);
    }
    if(!recordFrame)throw new Error('counter');
    // 考核标准页通过 scoreBtn 弹窗打开（URL 由页面脚本生成，无法可靠推导）。
    const popup=page.waitForEvent('popup',{timeout:8000});
    // Observe the popup immediately, even when clicking fails.
    const [popupResult]=await Promise.allSettled([
      popup,
      recordFrame.locator('.scoreBtn').click({timeout:4000}),
    ]);
    if(popupResult.status!=='fulfilled')throw new Error('grade');
    grades=popupResult.value;
    trackPage(grades);
    await grades.waitForLoadState('domcontentloaded',{timeout:15000});
    const parsed=new URL(grades.url());
    if(parsed.hostname!=='stat2-ans.chaoxing.com' || !parsed.pathname.startsWith('/stat2/overall-score/'))throw new Error('origin');
    await grades.getByText('查看考核标准',{exact:true}).click({timeout:6000});
    for(let i=0;i<10&&!stopped();i++){
      const text=await grades.locator('body').innerText({timeout:1500});
      result.required=parseRequired(text);
      result.discussion=parseDiscussion(text,recordText);
      if(result.required===null && loadedRules(text) && !text.includes('章节学习次数'))result.required=0;
      if(result.required!==null || loadedRules(text))break;
      await grades.waitForTimeout(100);
    }
    if(result.required===null)result.error='未识别到明确的次数要求，请查看考核标准。';
  }catch{
    result.error=stopped()?'检查已停止。':'学习记录或考核标准读取失败，请打开课程核对。';
  }finally{
    if(grades&&!grades.isClosed())await grades.close().catch(()=>{});
  }
  return result;
}

module.exports={parseCompleted,parseRequired,readStudyRecords};
