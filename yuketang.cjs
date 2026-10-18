const HOME='https://changjiang.yuketang.cn/v2/web/index';
const trusted=value=>{
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='changjiang.yuketang.cn';}catch{return false;}
};

async function authenticated(page){
  if(!trusted(page.url())||!new URL(page.url()).pathname.startsWith('/v2/web/'))return false;
  return page.evaluate(()=>!document.querySelector('.login-box')&&/我听的课|我的归档|课程学习|学习进度/.test(document.body.innerText));
}

async function loginYuketang(context,credentials,{checkOnly=false,manual=false,stopped=()=>false,progress=()=>{},newPage=()=>context.newPage()}={}){
  const page=await newPage();
  let keepOpen=false;
  try{
    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1500);
    if(await authenticated(page))return {status:'success'};
    if(checkOnly)return {status:'not_logged_in'};
    keepOpen=true;
    await page.bringToFront();
    if(!manual){
      if(!credentials?.username||!credentials?.password)return {status:'invalid_credentials'};
      const toggle=page.locator('img.changeImg[alt="账号密码登录"]:visible');
      if(await toggle.count())await toggle.click();
      await page.getByText(credentials.username.includes('@')?'邮箱登录':'手机登录',{exact:true}).click();
      await page.locator(credentials.username.includes('@')?'input[placeholder="输入邮箱"]:visible':'input[placeholder="输入手机号"]:visible').fill(credentials.username);
      await page.locator('input[type="password"]:visible').fill(credentials.password);
      const agreement=page.locator('#user-agreement-checkbox');
      if(await agreement.count()&&!await agreement.evaluate(el=>el.classList.contains('icon-duoxuanxuanzhongnormal')))await agreement.click();
      await page.locator('.login-btn:visible').click();
    }
    progress('请在雨课堂网页完成验证，登录成功后自动保存。');
    const deadline=Date.now()+300000;
    while(!stopped()&&!page.isClosed()&&Date.now()<deadline){
      if(await authenticated(page)){keepOpen=false;return {status:'success'};}
      const text=await page.locator('.error-box:visible').allTextContents();
      if(text.some(text=>/密码.*错误|账号.*不存在|账户.*不存在/.test(text)))return {status:'invalid_credentials'};
      await page.waitForTimeout(750);
    }
    return {status:stopped()||page.isClosed()?'cancelled':'captcha'};
  }catch{return {status:stopped()||page.isClosed()?'cancelled':'error',reason:'open_page'};}
  finally{if(!keepOpen)await page.close().catch(()=>{});}
}

function outlineDOM(){
  const rows=[...document.querySelectorAll('.chapter-list .leaf-detail')];
  const metrics=Object.fromEntries(['video','exercise','exam'].map(category=>[category,{required:0,done:0,error:''}]));
  for(const row of rows){
    const category=row.querySelector('.icon--shipin')?'video':row.querySelector('.icon--zuoye')?'exercise':row.querySelector('.icon--kaoshi')?'exam':null;
    if(!category)continue;
    const metric=metrics[category];
    metric.required++;
    const status=row.querySelector('.progress-wrap')?.textContent.trim()||'';
    if(status==='已完成'&&metric.done!==null)metric.done++;
    else if(!/未开始|进行中|未完成|\d+\s*%/.test(status)&&status!=='已完成'){
      metric.done=null;metric.error='部分项目完成状态未识别';
    }
  }
  const expected=Number(document.querySelector('.fr.num')?.textContent.trim());
  const complete=rows.length>0&&Number.isInteger(expected)&&expected===rows.length;
  if(!complete)for(const metric of Object.values(metrics)){
    metric.required=null;metric.done=null;metric.error='目录尚未完整加载';
  }
  return {metrics,complete,rows:rows.length};
}

async function scanYuketang(context,{stopped=()=>false,emit=()=>{},newPage=()=>context.newPage()}={}){
  const page=await newPage();
  try{
    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1500);
    if(!await authenticated(page))return '长江雨课堂未登录，请先在平台账号中保存并登录。';
    await page.getByText('我听的课',{exact:true}).click();
    await page.locator('.lesson-cardS h1').first().waitFor({state:'visible',timeout:15000});
    const cards=await page.locator('.lesson-cardS').evaluateAll(cards=>cards.map(card=>({
      name:card.querySelector('h1').textContent.trim(),className:card.querySelector('.className')?.textContent.trim()||''
    })));
    let read=0;
    for(let index=0;index<cards.length;index++){
      if(stopped())break;
      if(index){
        await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:45000});
        await page.getByText('我听的课',{exact:true}).click();
      }
      const card=page.locator('.lesson-cardS').filter({has:page.locator('h1',{hasText:cards[index].name})}).filter({hasText:cards[index].className}).first();
      await card.locator('h1').click();
      await page.waitForURL('**/v2/web/studentLog/**',{timeout:15000});
      const course={name:cards[index].name+(cards[index].className?' · '+cards[index].className:''),url:page.url()};
      emit('catalog',{courses:[course]});
      try{
        await page.getByText('学习内容',{exact:true}).click();
        let outline=null;
        const deadline=Date.now()+20000;
        while(!stopped()&&Date.now()<deadline){
          for(const frame of page.frames()){
            if(!trusted(frame.url())||!new URL(frame.url()).pathname.endsWith('/studycontent'))continue;
            outline=await frame.evaluate(outlineDOM);
            if(outline.complete)break;
          }
          if(outline?.complete)break;
          await page.waitForTimeout(300);
        }
        if(!outline?.complete)throw Error('目录尚未完整加载');
        const values=Object.values(outline.metrics);
        const counts=values.every(metric=>metric.done!==null)?[values.reduce((sum,metric)=>sum+metric.done,0),values.reduce((sum,metric)=>sum+metric.required,0)]:null;
        emit('course',{url:course.url,counts,metrics:outline.metrics,message:`已读取 ${course.name}：视频 ${outline.metrics.video.done}/${outline.metrics.video.required}，习题 ${outline.metrics.exercise.done}/${outline.metrics.exercise.required}，考试 ${outline.metrics.exam.done}/${outline.metrics.exam.required}。`});
        read++;
      }catch(error){
        emit('course',{url:course.url,error:'雨课堂目录读取失败，旧记录已保留。',metrics:Object.fromEntries(['video','exercise','exam'].map(category=>[category,{required:null,done:null,error:'目录读取失败'}])),message:'课程进度读取失败：'+course.name});
      }
    }
    return stopped()?'任务已停止。':`已检查 ${read}/${cards.length} 门长江雨课堂课程。`;
  }finally{await page.close().catch(()=>{});}
}

module.exports={HOME,trusted,authenticated,loginYuketang,scanYuketang,outlineDOM};
