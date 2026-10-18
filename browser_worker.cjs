// Browser actions: catalogue scan, login, best-effort video playback, open/close.
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const DATA_ROOT=path.resolve(process.env.COURSE_ASSISTANT_DATA_ROOT||path.join(__dirname,'data'));
const {chromium} = require('./.runtime/playwright-core');
const {loginYuketang,scanYuketang}=require('./yuketang.cjs');
const {brushYuketang}=require('./yuketang_worker.cjs');
const platformRoot=platform=>platform==='yuketang'?'yuketang.cn':platform==='mooc'?'icourse163.org':'chaoxing.com';
const PLAYBACK_SPEEDS=[.75,1,1.25,1.5,2,4,8,10,16];

function browserExecutable(){
  for(const relative of ['Google/Chrome/Application/chrome.exe','Microsoft/Edge/Application/msedge.exe']){
    for(const key of ['PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA']){
      const base=process.env[key];
      if(!base)continue;
      const candidate=path.join(base,...relative.split('/'));
      try{if(fs.statSync(candidate).isFile())return candidate;}catch{}
    }
  }
  throw new Error('未找到 Chrome 或 Microsoft Edge，请先安装其中一种浏览器。');
}

// --- 超星加密字体解密(纯 Node,无第三方依赖) ---
// 原理:加密字体内嵌 base64 于页面;每个字形坐标串的 md5 与社区映射表
// (cx_font_map.json,hash→"uniXXXX")对查得到真实汉字;康熙部首单独替换。
const KX_RADICALS=(()=>{const a='⼀⼁⼂⼃⼄⼅⼆⼇⼈⼉⼊⼋⼌⼍⼎⼏⼐⼑⼒⼓⼔⼕⼖⼗⼘⼙⼚⼛⼜⼝⼞⼟⼠⼡⼢⼣⼤⼥⼦⼧⼨⼩⼪⼫⼬⼭⼮⼯⼰⼱⼲⼳⼴⼵⼶⼷⼸⼹⼺⼻⼼⼽⼾⼿⽀⽁⽂⽃⽄⽅⽆⽇⽈⽉⽊⽋⽌⽍⽎⽏⽐⽑⽒⽓⽔⽕⽖⽗⽘⽙⽚⽛⽜⽝⽞⽟⽠⽡⽢⽣⽤⽥⽦⽧⽨⽩⽪⽫⽬⽭⽮⽯⽰⽱⽲⽳⽴⽵⽶⽷⽸⽹⽺⽻⽼⽽⽾⽿⾀⾁⾂⾃⾄⾅⾆⾇⾈⾉⾊⾋⾌⾍⾎⾏⾐⾑⾒⾓⾔⾕⾖⾗⾘⾙⾚⾛⾜⾝⾞⾟⾠⾡⾢⾣⾤⾥⾦⾧⾨⾩⾪⾫⾬⾭⾮⾯⾰⾱⾲⾳⾴⾵⾶⾷⾸⾹⾺⾻⾼髙⾽⾾⾿⿀⿁⿂⿃⿄⿅⿆⿇⿈⿉⿊⿋⿌⿍⿎⿏⿐⿑⿒⿓⿔⿕⺠⻬⻩⻢⻜⻅⺟⻓';
  const b='一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉采里金長門阜隶隹雨青非面革韋韭音頁風飛食首香馬骨高高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠民齐黄马飞见母长';
  const map=new Map();for(let i=0;i<a.length;i++)map.set(a[i],b[i]);return map;})();
const CX_FONT_REV=(()=>{try{
  const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'cx_font_map.json'),'utf8'));
  const rev={};for(const [name,hash] of Object.entries(raw))rev[hash]=name;
  return Object.keys(rev).length?rev:null;
}catch{return null;}})();
function parseTtfGlyphHashes(buf){
  const u16=o=>buf.readUInt16BE(o),i16=o=>buf.readInt16BE(o),u32=o=>buf.readUInt32BE(o);
  const numTables=u16(4);
  let glyfOff,locaOff,headOff,maxpOff;
  for(let i=0;i<numTables;i++){
    const rec=12+16*i,tag=buf.toString('latin1',rec,rec+4),off=u32(rec+8);
    if(tag==='glyf')glyfOff=off;else if(tag==='loca')locaOff=off;
    else if(tag==='head')headOff=off;else if(tag==='maxp')maxpOff=off;
  }
  if(glyfOff==null||locaOff==null||headOff==null||maxpOff==null)return null;
  const numGlyphs=u16(maxpOff+4);
  // 以 loca 表长度推断格式(比 head.indexToLocFormat 字段更可靠)
  let locaLen=null;
  for(let i=0;i<numTables;i++){
    const rec=12+16*i;
    if(buf.toString('latin1',rec,rec+4)==='loca'){locaLen=u32(rec+12);break;}
  }
  const indexToLocFormat=locaLen===(numGlyphs+1)*4?1:0;
  const loca=i=>indexToLocFormat===0?u16(locaOff+i*2)*2:u32(locaOff+i*4);
  const result={};
  for(let g=0;g<numGlyphs;g++){
    try{
      const start=loca(g),end=loca(g+1);
      if(end<=start)continue;
    let p=glyfOff+start;
    const nc=i16(p);p+=10; // numberOfContours plus the four mandatory bbox fields.
    if(nc<=0)continue;
    // TrueType simple glyph endpoints follow the complete 10-byte header.
    // https://learn.microsoft.com/en-us/typography/opentype/spec/glyf
    const readEndPts=base=>{
      const pts=[];
      for(let k=0;k<nc;k++)pts.push(u16(base+2*k));
      for(let k=1;k<nc;k++)if(pts[k]<pts[k-1])return null;
      return pts;
    };
    const endPts=readEndPts(p);
    if(!endPts)continue;
    p+=2*nc;
    const numPts=endPts[nc-1]+1;
      const instrLen=u16(p);p+=2+instrLen;
      const flags=[];
      while(flags.length<numPts&&p+2<=glyfOff+end){
        const f=buf[p];p+=1;flags.push(f);
        if(f&8){const rep=buf[p];p+=1;for(let r=0;r<rep&&flags.length<numPts;r++)flags.push(f);}
      }
      if(flags.length<numPts)continue;
      const xs=[],ys=[];let x=0,y=0;
      // TrueType 布局:先全部 x 坐标,再全部 y 坐标。
      for(const f of flags){
        if(f&2){let dx=buf[p];p+=1;if(!(f&16))dx=-dx;x+=dx;}
        else if(!(f&16)){x+=i16(p);p+=2;}
        xs.push(x);
      }
      for(const f of flags){
        if(f&4){let dy=buf[p];p+=1;if(!(f&32))dy=-dy;y+=dy;}
        else if(!(f&32)){y+=i16(p);p+=2;}
        ys.push(y);
      }
      let posBin='',last=0;
      for(let c=0;c<nc;c++){
        for(let j=last;j<=endPts[c];j++)posBin+=`${xs[j]}${ys[j]}${flags[j]&1}`;
        last=endPts[c]+1;
      }
      result[g]=crypto.createHash('md5').update(posBin,'utf8').digest('hex');
    }catch{continue;}
  }
  return result;
}
function parseTtfCmap(buf){
  const u16=o=>buf.readUInt16BE(o),u32=o=>buf.readUInt32BE(o),i16=o=>buf.readInt16BE(o);
  const cmapOff=(()=>{const numTables=u16(4);
    for(let i=0;i<numTables;i++){const rec=12+16*i;
      if(buf.toString('latin1',rec,rec+4)==='cmap')return u32(rec+8);}return null;})();
  if(cmapOff==null)return null;
  const numTables=u16(cmapOff+2);
  let sub=null;
  for(let i=0;i<numTables;i++){
    const rec=cmapOff+4+8*i,off=cmapOff+u32(rec+4);
    if(u16(off)===4){sub=off;break;}
  }
  if(sub==null)return null;
  const segCountX2=u16(sub+6),segCount=segCountX2/2;
  const endBase=sub+14,startBase=endBase+segCountX2+2,deltaBase=startBase+segCountX2,rangeBase=deltaBase+segCountX2;
  const map={};
  for(let s=0;s<segCount;s++){
    const end=u16(endBase+s*2),start=u16(startBase+s*2);
    const delta=i16(deltaBase+s*2),rangeOff=u16(rangeBase+s*2);
    for(let cp=start;cp<=end&&cp!==0xFFFF;cp++){
      let gid;
      if(rangeOff===0)gid=(cp+delta)&0xFFFF;
      else{
        const idx=rangeBase+s*2+rangeOff+(cp-start)*2;
        gid=u16(idx);if(gid)gid=(gid+delta)&0xFFFF;
      }
      if(gid)map[cp]=gid;
    }
  }
  return map;
}
let cxDecoder=null;
function buildCxDecoder(base64Font){
  try{
    const buf=Buffer.from(base64Font,'base64');
    const hashes=parseTtfGlyphHashes(buf);
    const cmap=parseTtfCmap(buf);
    if(!hashes||!cmap||!CX_FONT_REV)return false;
    const charMap={};
    for(const [cpStr,gid] of Object.entries(cmap)){
      const hash=hashes[gid];
      const name=hash&&CX_FONT_REV[hash];
      if(name&&/^uni[0-9A-Fa-f]{4,}$/.test(name)){
        const real=parseInt(name.slice(3),16);
        if(real&&!(real>=0xE000&&real<=0xF8FF))charMap[Number(cpStr)]=String.fromCharCode(real);
      }
    }
    if(!Object.keys(charMap).length)return false;
    cxDecoder=text=>text.split('').map(ch=>{
      const cp=ch.codePointAt(0);
      const mapped=charMap[cp]||KX_RADICALS.get(ch);
      return mapped||ch;
    }).join('');
    return true;
  }catch{return false;}
}
async function ensureCxDecoder(frame){
  // Redo can replace the font while retaining the same frame and URL.
  // Always rebuild from the current document; never decode with an older font.
  cxDecoder=null;
  const candidates=await frame.evaluate(()=>{
    const out=[];
    const html=document.documentElement?.innerHTML||'';
    for(const m of html.matchAll(/base64,([A-Za-z0-9+/=]{2000,})/g))out.push(m[1]);
    for(const sheet of document.styleSheets){
      try{
        for(const rule of sheet.cssRules||[]){
          const t=rule.cssText||'';
          for(const m of t.matchAll(/base64,([A-Za-z0-9+/=]{2000,})/g))out.push(m[1]);
        }
      }catch{}
    }
    return out.slice(0,5);
  }).catch(()=>[]);
  for(const b64 of candidates){
    if(buildCxDecoder(b64))return true;
  }
  return false;
}
function cxDecode(text){return cxDecoder?cxDecoder(text):text;}
// --- 加密字体解密结束 ---

const {readStudyRecords}=require('./study_records.cjs');
const {readOtherCategories}=require('./category_reader.cjs');
const {refreshVisits}=require('./learning_visits.cjs');
const {loginMooc,authenticated:moocAuthenticated}=require('./mooc_login.cjs');
const {scanMooc}=require('./mooc_scanner.cjs');
const emit = (type, fields) => process.stdout.write(JSON.stringify({type,...fields})+'\n');
let stopped=false, credentials=null;
let paused=false; // 刷课暂停标志：HUD 的「暂停/继续」按钮切换，主循环每步等待它解除。
const quizWaiters=new Map();
let savedSession=null, bootstrapReady=false;
function brushTrace(stage,fields={}){
  if(require.main!==module)return;
  try{
    fs.mkdirSync(DATA_ROOT,{recursive:true});
    const target=path.join(DATA_ROOT,'brush-debug.jsonl');
    if(fs.existsSync(target)&&fs.statSync(target).size>1024*1024)fs.writeFileSync(target,'');
    fs.appendFileSync(target,JSON.stringify({time:new Date().toISOString(),stage,...fields})+'\n');
  }catch{}
}
const taskPages=new Set();
async function taskPage(context){
  const page=await context.newPage();
  trackPage(page);
  return page;
}
function trackPage(page){
  taskPages.add(page);
  page.on('close',()=>taskPages.delete(page));
}
function stopTask(){
  stopped=true;
  for(const page of taskPages)page.close().catch(()=>{});
}

async function backgroundContext(address, platform='chaoxing'){
  // If the visible app browser is open, leave its windows and tabs untouched.
  // Use an isolated headless profile and bootstrap the session over stdin.
  // Python persists session updates with Windows user-scoped encryption.
  for(let i=0;i<100&&!bootstrapReady&&!stopped;i++)await delay(20);
  let state=savedSession, visible;
  if(address!=='background'){
    try{
      visible=await chromium.connectOverCDP(address);
      state=await visible.contexts()[0].storageState();
    }finally{
      if(visible)await visible.close().catch(()=>{});
    }
  }
  // A headless worker must never lock the visible login browser's profile.
  const directory=path.join(DATA_ROOT,'browser-background');
  const context=await chromium.launchPersistentContext(directory,{
    executablePath:browserExecutable(),headless:true,viewport:{width:1440,height:1000},
    args:['--no-first-run','--hide-crash-restore-bubble'],
  });
  try{
    if(state){
      await context.clearCookies();
      const cookies=state.cookies.filter(c=>{
        const host=c.domain.replace(/^\./,'');
        const root=platformRoot(platform);
        return host===root||host.endsWith('.'+root);
      });
      if(cookies.length)await context.addCookies(cookies);
      const root=platformRoot(platform);
      const origins=state.origins.filter(o=>{const host=new URL(o.origin).hostname;return host===root||host.endsWith('.'+root);});
      await context.addInitScript(({origins})=>{
        const current=origins.find(o=>o.origin===location.origin);
        if(current){
          localStorage.clear();
          for(const item of current.localStorage)localStorage.setItem(item.name,item.value);
        }
      },{origins});
    }
    context.syncVisibleSession=async()=>{
      emit('session_state',{state:platformSession(await context.storageState(),platform)});
      if(address==='background')return;
      let connected;
      try{
        const cookies=(await context.cookies()).filter(c=>{
          const host=c.domain.replace(/^\./,'');
          const root=platformRoot(platform);
          return host===root||host.endsWith('.'+root);
        });
        connected=await chromium.connectOverCDP(address);
        if(cookies.length)await connected.contexts()[0].addCookies(cookies);
      }finally{
        if(connected)await connected.close().catch(()=>{});
      }
    };
    return context;
  }catch(error){
    await context.close().catch(()=>{});
    throw error;
  }
}
const allowed = frame => {try{return new URL(frame.url()).hostname.endsWith('.chaoxing.com');}catch{return false;}};
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));

function platformSession(state, platform){
  const root=platformRoot(platform);
  const matches=host=>host===root||host.endsWith('.'+root);
  return {cookies:state.cookies.filter(c=>matches(c.domain.replace(/^\./,''))),
    origins:state.origins.filter(o=>{try{return matches(new URL(o.origin).hostname);}catch{return false;}})};
}

function parseProgress(text){
  const match=text.match(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/);
  return match && +match[1]<=+match[2] ? [+match[1],+match[2]] : null;
}

async function links(page) {
  const found=new Map();
  for(const frame of page.frames().filter(allowed)) {
    try {
      const entries=await frame.evaluate(()=>[...document.querySelectorAll('li.course h3 a[href], a[href*="stucoursemiddle"]')].map(el=>{
        const card=el.closest('li.course');
        const name=(card?.querySelector('.course-name')?.getAttribute('title') || el.innerText || '').trim();
        return {name,url:el.href};
      }));
      for(const entry of entries){
        const u=new URL(entry.url), q=u.searchParams;
        if(entry.name && u.protocol==='https:' && u.hostname.endsWith('.chaoxing.com') && /^\d+$/.test(q.get('courseid')) && /^\d+$/.test(q.get('clazzid')))
          found.set(`${q.get('courseid')}:${q.get('clazzid')}:${q.get('cpi')||''}`,entry);
      }
    }catch{}
  }
  return found;
}

async function openLearningCourses(page){
  // The learning-space landing page only loads its course iframe after selecting
  // the sidebar link. Follow the site's navigation so its SSO URL is preserved.
  for(const frame of page.frames().filter(allowed)){
    try{
      const navigation=frame.locator('a[href*="switchM"][href*="/visit/interaction"]');
      for(let i=0;i<await navigation.count();i++){
        const link=navigation.nth(i);
        if(await link.isVisible()){
          await link.click({timeout:3000});
          return true;
        }
      }
    }catch{}
  }
  return false;
}

async function needsLogin(page){
  if(new URL(page.url()).hostname.includes('passport')) return true;
  for(const frame of page.frames()){
    try{if(await frame.locator('input[type="password"]:visible').count())return true;}catch{}
  }
  return false;
}

async function autoLogin(context, cred, existingPage=null){
  const page=existingPage||await taskPage(context);
  let keepPage=false;
  try{
    await page.goto('https://passport2.chaoxing.com/login',{waitUntil:'domcontentloaded',timeout:45000});
    if(allowed(page)&&!await needsLogin(page))return {ok:true,status:'success'};
    if(new URL(page.url()).hostname!=='passport2.chaoxing.com')return {ok:false,status:'error',message:'登录地址发生变化，请手动登录。'};
    keepPage=true;
    const phone=page.locator('#phone');
    await phone.waitFor({state:'visible',timeout:10000});
    await phone.fill(cred.username);
    await page.locator('#pwd').fill(cred.password);
    await enableRememberLogin(page);
    await page.locator('#loginBtn').click();
    for(let i=0;i<40&&!stopped;i++){
      await delay(500);
      if(allowed(page) && !await needsLogin(page)) {keepPage=false;return {ok:true,status:'success'};}
      try{
        const err=await page.locator('#err_txt:visible, .err-txt:visible, .wrong-text:visible, .zc-alert:visible').first().innerText({timeout:300});
        if(err&&err.trim()){
          const status=classifyLoginError(err);
          return {ok:false,status,message:status==='invalid_credentials'?'账号或密码错误，请重新登录。':status==='captcha'?'需要验证码，请在网页完成验证。':'登录失败，请稍后重试。'};
        }
      }catch{}
      if(await hasCaptcha(page))return {ok:false,status:'captcha',message:'需要验证码，请在网页完成验证。'};
    }
    return {ok:false,status:stopped?'cancelled':'error',message:'登录未完成，请重试或打开网页登录。'};
  }catch{
    return {ok:false,status:stopped?'cancelled':'error',message:'登录页面打开失败，请重试。'};
  }finally{
    if(!existingPage&&(!keepPage||stopped))await page.close().catch(()=>{});
  }
}

function classifyLoginError(text){
  if(/验证码|验证失败|滑块|安全验证|短信验证/.test(text))return 'captcha';
  if(/密码.{0,8}(错误|不正确)|账号.{0,8}(错误|不存在)|用户名.{0,8}(错误|不存在)|帐号.{0,8}(错误|不存在)/.test(text))return 'invalid_credentials';
  return 'error';
}

async function hasCaptcha(page){
  for(const selector of ['#captcha', '#verifyCode', '.yidun_panel', '.geetest_panel', '.nc-container', '#captchaIframe', 'iframe[src*="captcha"]', 'iframe[src*="verify"]']){
    try{if(await page.locator(selector).first().isVisible())return true;}catch{}
  }
  return false;
}

async function loginAccount(context, cred, {checkOnly=false, visible=false}={}){
  if(checkOnly){
    const page=await taskPage(context);
    try{
      await page.goto('https://i.chaoxing.com/',{waitUntil:'domcontentloaded',timeout:45000});
      return {status:allowed(page)&&!await needsLogin(page)?'success':'not_logged_in'};
    }finally{await page.close().catch(()=>{});}
  }
  if(!cred)return {status:'error'};
  // Explicit account verification must not pass using a previous account's cookies.
  await context.clearCookies({domain:/(^|\.)chaoxing\.com$/});
  const existing=visible?context.pages().find(p=>p.url().startsWith('https://passport2.chaoxing.com/')):null;
  const result=await autoLogin(context,cred,existing||null);
  return {status:result.status||(result.ok?'success':'error')};
}

async function enableRememberLogin(page){
  const custom=page.locator('.auto-lg-next .check-input').first();
  if(await custom.count()){
    const isChecked=async()=>/(?:^|\s)checked-input(?:\s|$)/.test(await custom.getAttribute('class')||'');
    if(!await isChecked())await custom.click({timeout:3000});
    if(!await isChecked())throw new Error('自动登录选项未勾选成功');
    return;
  }
  // Prefer setting the checkbox state so an already checked option stays on.
  const checkbox=page.getByRole('checkbox',{name:/下次自动登录/}).first();
  if(await checkbox.count()){
    await checkbox.check({force:true,timeout:3000});
    return;
  }
  const label=page.getByText('下次自动登录').first();
  if(!await label.count())return;
  const nearby=label.locator('xpath=..').locator('input[type="checkbox"]').first();
  if(await nearby.count())await nearby.check({force:true,timeout:3000});
  else{
    // Custom controls may expose their state on the label or its parent.
    const checked=await label.evaluate(el=>{
      const nodes=[el,el.parentElement].filter(Boolean);
      return nodes.some(n=>n.getAttribute('aria-checked')==='true'||
        /(?:^|\s)(?:checked|selected|active)(?:\s|$)/.test(n.className));
    });
    if(!checked)await label.click({timeout:3000});
  }
}

async function counts(page){
  for(const frame of page.frames().filter(allowed)){
    try{
      const text=await frame.locator('body').innerText({timeout:1500});
      const result=parseProgress(text);
      if(result) return result;
    }catch{}
  }
  return null;
}

async function openCourse(context, url, cred, login=autoLogin){
  // Chrome may provide an initial blank tab. Reuse it instead of leaving an
  // empty window behind; also reuse the requested page after a fresh launch.
  const pages=context.pages();
  const page=pages.find(p=>p.url()===url)||pages.find(p=>{
    try{return new URL(p.url()).hostname==='passport2.chaoxing.com';}catch{return false;}
  })||pages.find(p=>p.url()==='about:blank')||await context.newPage();
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.bringToFront();
  const target=new URL(url);
  if(target.protocol==='https:'&&target.hostname.endsWith('.chaoxing.com')&&await needsLogin(page)){
    if(!cred)return '课程需要登录，请先在“平台账号”保存超星账号，或在当前浏览器中手动登录。';
    const result=await login(context,cred,page);
    if(!result.ok)return result.message;
    if(stopped)return '任务已停止。';
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.bringToFront();
    if(await needsLogin(page))return '自动登录后课程仍要求验证，请在浏览器中完成验证后重试。';
    return '已自动登录并打开所选课程。';
  }
  return '已打开课程浏览器。';
}

async function scan(context){
  const space=await taskPage(context);
  let keepSpace=false;
  try{
    emit('progress',{message:'正在读取超星学习空间…'});
    await space.goto('https://i.mooc.chaoxing.com/space/',{waitUntil:'domcontentloaded',timeout:45000});
    let found=new Map(), loginTried=false, courseNavigationOpened=false;
    for(let i=0;i<30&&!stopped;i++){
      for(const [key,value] of await links(space))found.set(key,value);
      if(found.size)break;
      if(await needsLogin(space)){
        keepSpace=true;
        if(credentials&&!loginTried){
          loginTried=true;
          emit('progress',{message:'检测到未登录，正在使用已保存的账号自动登录…'});
          const result=await autoLogin(context,credentials,space);
          if(result.ok){
            keepSpace=false;
            emit('progress',{message:'自动登录成功，正在读取课程…'});
            await space.goto('https://i.mooc.chaoxing.com/space/',{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
            continue;
          }
          return result.message;
        }
        await space.bringToFront();
        return '后台未登录。请到“平台账号 → 打开网页登录”登录超星，或保存账号后重新检查。';
      }
      if(!courseNavigationOpened && await openLearningCourses(space)){
        courseNavigationOpened=true;
        emit('progress',{message:'已进入“我学的课”，正在读取课程列表…'});
      }
      await delay(500);
    }
    if(stopped)return '已停止检查。';
    if(!found.size){keepSpace=true;return '未识别到课程，请确认学习空间已显示“我学的课”。原有记录未删除。';}
    let partial=false;
    for(const frame of space.frames().filter(allowed)){
      const all=frame.locator('a[onclick="getAllCourse()"]');
      if(await all.count() && await all.first().isVisible()){
        await all.first().click({timeout:3000}); await delay(400);
      }
    }
    for(let pageNumber=0;pageNumber<50&&!stopped;pageNumber++){
      let stable=0;
      for(let step=0;step<25&&!stopped;step++){
        const before=found.size;
        for(const frame of space.frames().filter(allowed)){
          try{await frame.evaluate(()=>{
            window.scrollTo(0,document.body.scrollHeight);
            for(const el of document.querySelectorAll('div'))
              if(el.scrollHeight>el.clientHeight+50 && ['auto','scroll'].includes(getComputedStyle(el).overflowY)) el.scrollTop=el.scrollHeight;
          });}catch{}
        }
        await delay(250);
        for(const [key,value] of await links(space))found.set(key,value);
        stable=found.size===before?stable+1:0;
        if(stable>=3)break;
        if(step===24)partial=true;
      }
      let next=null;
      for(const frame of space.frames().filter(allowed)){
        const candidates=frame.getByText('下一页',{exact:true});
        for(let i=0;i<await candidates.count();i++){
          const el=candidates.nth(i);
          if(await el.isVisible() && await el.isEnabled() && !/disable/i.test(await el.getAttribute('class')||''))next=el;
        }
        if(await frame.locator('li.folder:visible, li.file:visible, [folderid]:visible').count())partial=true;
      }
      if(!next)break;
      const before=found.size;
      try{await next.click({timeout:3000});await delay(400);}catch{partial=true;break;}
      for(const [key,value] of await links(space))found.set(key,value);
      if(before===found.size){partial=true;break;}
      if(pageNumber===49)partial=true;
    }
    const courses=[...found.values()];
    emit('catalog',{courses});
    let successful=0, done=0;
    // 单门课程内部：任务点 / 学习次数 / 任务·作业·讨论 三路并行读取。
    async function checkOne(item, i){
      const idx=i+1, total=courses.length;
      const stage=name=>emit('progress',{message:`检查 ${idx}/${total}：${item.name}（${name}）· 已完成 ${done}`});
      const detail=await taskPage(context);
      const visitsPage=await taskPage(context);
      const catsPage=await taskPage(context);
      let result=null, error='未读取到任务点总数，请打开课程确认页面。';
      const readCounts=(async()=>{
        try{
          await detail.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000});
          stage('任务点');
          const chapter=detail.getByText('章节',{exact:true});
          await chapter.first().waitFor({state:'visible',timeout:10000});
          await chapter.first().click({timeout:3000});
          for(let attempt=0;attempt<40&&!stopped;attempt++){
            if(await needsLogin(detail)){error='登录已失效，请重新登录。';break;}
            const r=await counts(detail);
            if(r){result=r;break;}
            await delay(150);
          }
        }catch{error='页面加载失败或章节入口不可用，请打开课程检查。';}
      })();
      const readVisits=(async()=>{
        stage('学习次数');
        // 先进入课程内页（点「章节」），「学习记录」菜单才在内页。
        await visitsPage.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
        const chapter=visitsPage.getByText('章节',{exact:true}).first();
        await chapter.waitFor({state:'visible',timeout:10000}).catch(()=>{});
        await chapter.click({timeout:3000}).catch(()=>{});
        return readStudyRecords(visitsPage,trackPage,()=>stopped);
      })();
      const readCats=(async()=>{
        stage('任务·作业·讨论');
        // 先进入课程内页（点「章节」），任务/作业/讨论菜单才在内页。
        await catsPage.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
        const chapter=catsPage.getByText('章节',{exact:true}).first();
        await chapter.waitFor({state:'visible',timeout:10000}).catch(()=>{});
        await chapter.click({timeout:3000}).catch(()=>{});
        // Load this page while study records are being read; only the final
        // category calculation depends on the discussion requirement there.
        const v=await readVisits;
        return readOtherCategories(catsPage,v.discussion,()=>stopped);
      })();
      await readCounts;
      const visits=await readVisits;
      const metrics=await readCats;
      await detail.close().catch(()=>{});
      await visitsPage.close().catch(()=>{});
      await catsPage.close().catch(()=>{});
      if(result)successful++;
      done++;
      emit('course',{url:item.url,counts:result,visits,metrics,error:result?'':error,message:`已检查 ${done}/${total}，成功读取任务点 ${successful} 门。`});
    }
    // 跨课程并发：同时处理多门，总耗时接近「最慢一门 × 批次数」。
    const CONCURRENCY=4;
    let cursor=0;
    async function worker(){
      while(!stopped){
        const i=cursor++;
        if(i>=courses.length)return;
        const item=courses[i];
        await checkOne(item, i);
      }
    }
    await Promise.all(Array.from({length:Math.min(CONCURRENCY,courses.length)},()=>worker()));
    if(stopped)return '已停止检查，已读取结果已保存，其余课程待确认。';
    return `检查结束：发现 ${courses.length} 门，成功读取 ${successful} 门，${courses.length-successful} 门待确认。${partial?'分页或课程文件夹未全部确认，请检查学习空间。':''}`;
  }finally{
    if(!keepSpace&&!space.isClosed())await space.close().catch(()=>{});
  }
}

async function visitOne(context,url){
  const chapter=await taskPage(context), stats=await taskPage(context);
  try{
    await chapter.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    if(await needsLogin(chapter)){
      if(!credentials)return '后台未登录，请先完成网页登录。';
      const login=await autoLogin(context,credentials);
      if(!login.ok)return login.message;
      await chapter.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    }
    let ready=false;
    const prepare=async()=>{
      if(ready)return;
      await chapter.getByText('章节',{exact:true}).first().click({timeout:5000});
      for(let i=0;i<25&&!stopped;i++){
        if(chapter.frames().some(f=>f.url().includes('/mycourse/studentcourse?'))){ready=true;return;}
        await delay(200);
      }
      throw new Error('chapter unavailable');
    };
    return await refreshVisits({
      read:async()=>{
        await stats.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
        return readStudyRecords(stats,trackPage,()=>stopped);
      },
      refresh:async()=>{
        await prepare();
        const frame=chapter.frames().find(f=>f.url().includes('/mycourse/studentcourse?'));
        if(!frame || !allowed(frame))throw new Error('chapter unavailable');
        await frame.goto(frame.url(),{waitUntil:'domcontentloaded',timeout:15000});
      },
      wait:delay,stopped:()=>stopped,
      onCounts:visits=>emit('visits',{url,visits}),
      report:message=>emit('progress',{message}),
    });
  }catch{
    return stopped?'学习次数刷新已停止。':'章节页面刷新或次数核对失败，已暂停，请重新检查。';
  }finally{
    await chapter.close().catch(()=>{});
    await stats.close().catch(()=>{});
  }
}

// Course catalogues and player navigation can live inside nested frames.
async function findNext(page){
  // Never treat a "下一节" button inside a floating dialog/modal as a navigation target:
  // such buttons belong to the "任务点未完成" popup and would skip the quiz before answering.
  const MODAL_SEL='[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="Modal"],[class*="layui-layer"],[class*="popup"],[class*="Popup"],[class*="Tips"],[class*="mask"],[class*="confirm"],[role="dialog"]';
  const inModal=frame=>frame.evaluate(sel=>{
    return el=>!!el.closest(sel);
  },MODAL_SEL).catch(()=>()=>false);
  for(const frame of page.frames()){
    if(!allowed(frame))continue;
    const modal=await inModal(frame);
    for(const sel of ['#prevNextFocusNext','#prev_next .next','[title="下一节"]']){
      try{
        const el=frame.locator(sel).first();
        if(await el.count()&&await el.isVisible()){
          const isModal=await el.evaluate((e,s)=>!!e.closest(s),MODAL_SEL).catch(()=>false);
          if(!isModal)return el;
        }
      }catch{}
    }
    try{
      const els=frame.getByText(/^\s*下一(?:节|章|章节)\s*$/);
      for(let i=0;i<await els.count();i++){
        const el=els.nth(i);
        if(await el.isVisible()&&await el.isEnabled()){
          const isModal=await el.evaluate((e,s)=>!!e.closest(s),MODAL_SEL).catch(()=>false);
          if(!isModal)return el;
        }
      }
    }catch{}
  }
  return null;
}

async function waitForVideo(page, timeout=10000){
  const deadline=Date.now()+timeout;
  do{
    for(const frame of page.frames()){
      if(!allowed(frame))continue;
      try{if(await frame.locator('video').count())return true;}catch{}
    }
    if(stopped)return false;
    await delay(250);
  }while(Date.now()<deadline);
  return false;
}

async function chapterCandidates(frame){
  return frame.evaluate(()=>{
    for(const el of document.querySelectorAll('[data-course-helper-chapter]'))el.removeAttribute('data-course-helper-chapter');
    const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
    const numbered=el=>/^\d+(?:\.\d+)+\s+\S/.test(el.textContent.trim());
    const known='.chapter_item[onclick*="toOld"] .catalog_title, .posCatalog_select .posCatalog_name, .posCatalog_name, [onclick*="getTeacherAjax"], a[href*="/mycourse/studentstudy"], a[href*="/knowledge/cards"]';
    const leaves=[...document.querySelectorAll('a,span,div,p,h3,h4')].filter(el=>
      visible(el)&&el.textContent.trim().length<180&&numbered(el)&&
      ![...el.children].some(child=>numbered(child)));
    const targets=[...new Set([...document.querySelectorAll(known),...leaves])];
    const titles=targets.filter(el=>!targets.some(other=>other!==el&&el.contains(other)));
    const result=[];
    const green=color=>{
      const rgb=color.match(/[\d.]+/g)?.map(Number)||[];
      return rgb.length>=3&&(rgb.length<4||rgb[3]>0)&&rgb[1]>90&&rgb[1]>rgb[0]*1.15&&rgb[1]>rgb[2]*1.08;
    };
    const orange=color=>{
      const rgb=color.match(/[\d.]+/g)?.map(Number)||[];
      return rgb.length>=3&&(rgb.length<4||rgb[3]>0)&&rgb[0]>180&&rgb[1]>65&&rgb[1]<220&&rgb[2]<rgb[1]*.8;
    };
    for(const el of targets){
      if(!visible(el))continue;
      const explicitRow=el.closest('.chapter_item, .posCatalog_select');
      // One click target per modern catalogue row; its title is the event entry.
      if(explicitRow&&targets.some(other=>other!==el&&explicitRow.contains(other)&&other.matches('.catalog_title'))&&!el.matches('.catalog_title'))continue;
      let row=explicitRow||el;
      // Include the badge beside the title without swallowing adjacent chapters.
      for(let depth=0;!explicitRow&&depth<4&&row.parentElement;depth++){
        const parent=row.parentElement;
        if(titles.filter(item=>parent.contains(item)).length>1||parent===document.body)break;
        row=parent;
      }
      const marks=[row,...row.querySelectorAll('*')].filter(mark=>visible(mark)&&
        (mark===el||mark.textContent.trim().length<12));
      const complete=!!row.querySelector('.icon_yiwanc, .icon_Completed, .icon_completed, [title="已完成"]')||
        marks.some(mark=>[getComputedStyle(mark),getComputedStyle(mark,'::before')].some(style=>
          green(style.backgroundColor)||green(style.color)));
      if(complete)continue;
      const badges=marks.filter(mark=>mark.matches('.catalog_points_yi, .orangeNew, .orange01')||[getComputedStyle(mark),getComputedStyle(mark,'::before')].some(style=>
        orange(style.backgroundColor)||orange(style.color)));
      // 橙色 0 的节（章节壳/知识扩展等）也按顺序进去看一眼。
      const zeroBadge=badges.some(mark=>mark.textContent.trim()==='0');
      const index=result.length;
      el.setAttribute('data-course-helper-chapter',String(index));
      result.push({index,title:(el.querySelector('.catalog_name')||el).textContent.trim(),pending:badges.length>0,zero:zeroBadge});
    }
    return result; // 保持 DOM 顺序（按目录从上到下），不按 pending 排序。
  });
}

async function sectionState(page){
  const state={video:false,expectedVideo:false,document:false,live:false,livePending:false,detail:false,quiz:false,knowledge:false};
  for(const frame of page.frames()){
    if(!allowed(frame))continue;
    try{
      const local=await frame.evaluate(()=>{
        const text=document.body?.innerText||'';
        const live=/直播/.test(text)&&(/主播|观看时长|未开始|直播已结束/.test(text));
        return {video:!!document.querySelector('video'),
          expectedVideo:!!document.querySelector('iframe.ans-insertvideo-online')||/\/ananas\/modules\/video\//.test(location.href),
          document:!!document.querySelector('.pdfViewer, #viewerContainer, .ndfHF-content, [data-document-viewer], iframe[src*="/ananas/modules/pdf/"], iframe[src*="/ananas/modules/ppt/"], iframe[src*="/screen/v2/"]')||
            /\/(?:pdf|ppt|document)(?:\/|\.|\?)/i.test(location.href)||/\/screen\/v2\//.test(location.href),
          knowledge:/\/ananas\/dialog\/ballchart(?:[/?#]|$)/.test(location.href),
          live,livePending:live&&/未开始|尚未开始|直播已结束/.test(text),
          detail:/章节详情/.test(text)||/\/mycourse\/studentstudy|\/knowledge\/cards/.test(location.href)};
      });
      for(const key of Object.keys(state))state[key] ||= local[key];
    }catch{}
  }
  // Use the same evidence as answering. Catalogue labels and generic forms
  // are present on non-quiz sections too (including knowledge-extension pages).
  state.quiz=!!await findQuizFrame(page);
  return state;
}

async function waitForSection(page, timeout=10000){
  const deadline=Date.now()+timeout;
  do{
    const state=await sectionState(page);
    if(state.video||state.document||state.live||state.quiz||state.knowledge)return state;
    if(stopped)break;
    await delay(250);
  }while(Date.now()<deadline);
  return sectionState(page);
}

async function enterChapter(page, emitMsg, timeout=15000){
  const deadline=Date.now()+timeout;
  const attempted=new Set();
  do{
    const state=await sectionState(page);
    if(state.video||state.document||state.live||state.quiz||state.detail)return true;
    for(const frame of page.frames()){
      if(!allowed(frame))continue;
      try{
        const candidates=await chapterCandidates(frame);
        for(const candidate of candidates){
          const key=frame.url()+'|'+candidate.title;
          if(attempted.has(key))continue;
          attempted.add(key);
          const chapter=frame.locator(`[data-course-helper-chapter="${candidate.index}"]`);
          emitMsg(`正在进入章节任务点：${candidate.title}…`);
          await chapter.click({timeout:5000});
          const loaded=await waitForSection(page,Math.min(5000,Math.max(0,deadline-Date.now())));
          if(loaded.video||loaded.document||loaded.live||loaded.detail)return true;
          // A click with no content change is not a successful chapter entry.
          if(Date.now()>=deadline)return false;
        }
      }catch{}
    }
    if(stopped)return false;
    await delay(250);
  }while(Date.now()<deadline);
  return false;
}

// Reuse the current catalogue. Refresh only when it has no usable entries.
// 返回 true=已跳转到新任务点；false=目录中没有可跳的未完成任务点。
async function gotoFirstPending(page,emitMsg,attempted,setCurrent){
  const currentFP=await sectionFingerprint(page);
  let refreshed=false;
  for(let tryn=0;tryn<8&&!stopped;tryn++){
    const before=await sectionFingerprint(page);
    let clickedKey=null;
    for(const frame of page.frames()){
      if(!allowed(frame))continue;
      let candidates=[];
      try{candidates=await chapterCandidates(frame);}catch{continue;}
      for(const cand of candidates){
        const key=frame.url()+'|'+cand.title;
        if(attempted.has(key))continue;
        try{
          emitMsg(`跳转未完成任务点：${cand.title}…`);
          await frame.locator(`[data-course-helper-chapter="${cand.index}"]`).click({timeout:5000});
          clickedKey=key;break;
        }catch{attempted.add(key);continue;}
      }
      if(clickedKey)break;
    }
    if(!clickedKey){
      if(refreshed)return false;
      refreshed=true;
      await page.reload({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
      try{
        const tab=page.getByText('章节',{exact:true}).first();
        if(await tab.count())await tab.click({timeout:1000});
      }catch{}
      continue;
    }
    if(await waitForSectionChange(page,before,10000)){
      // 又落回跳转前的同一节（该任务点未完成仍排最前）：标记并跳过。
      if(await sectionFingerprint(page)===currentFP){
        attempted.add(clickedKey);
        continue;
      }
      setCurrent&&setCurrent(clickedKey);
      return true;
    }
    // 未跳转：可能是「任务点未完成」拦截弹窗。确认离开则成功；关闭/去学习
    // 则留在原节——把这个任务点标记为已尝试，继续挑下一个。
    const leave=await confirmLeaveDialog(page);
    if(leave==='skip'&&await waitForSectionChange(page,before,15000)){
      setCurrent&&setCurrent(clickedKey);
      return true;
    }
    attempted.add(clickedKey);
    emitMsg('该任务点暂时无法进入，跳过并尝试下一个。');
  }
  return false;
}

async function scrollDocuments(page, emitMsg, {wait=delay,cancelled=()=>stopped}={}){
  let documents=0;
  // Document iframes are often lazy-loaded after the section is entered. If no
  // document frame is visible yet, poll briefly so the PDF/PPT player has time
  // to mount instead of bailing out immediately.
  const hasScreenFrame=()=>page.frames().some(f=>{try{return /\/screen\/v2\//.test(f.url());}catch{return false;}});
  const hasDocFrame=()=>page.frames().some(f=>{
    try{return /\/ananas\/modules\/(pdf|ppt|flash)\//.test(f.url())||
      f.url().includes('/pdf/')||f.url().includes('/ppt/')||
      /\/screen\/v2\//.test(f.url());}catch{return false;}
  });
  const initial=await sectionState(page);
  // Keep lazy-document waits when a document wrapper is present or the type
  // is still unknown. Known non-document content does not need a 10-second poll.
  if(!hasDocFrame()&&!initial.document&&
     (initial.video||initial.expectedVideo||initial.quiz||initial.live||initial.knowledge)){
    brushTrace('document_wait_skipped',{reason:initial.knowledge?'knowledge':initial.quiz?'quiz':'media'});
    return 0;
  }
  // The real PDF lives in a lazily-mounted pan-yz /screen/ frame. If a pdf
  // wrapper is present but its /screen/ child hasn't mounted, wait a bit.
  let waited=0;
  while(!hasDocFrame()&&waited<10000&&!cancelled()){
    await wait(500);
    waited+=500;
  }
  let screenWaited=0;
  while(hasDocFrame()&&!hasScreenFrame()&&screenWaited<3000&&!cancelled()){
    await wait(500);
    screenWaited+=500;
  }
  waited+=screenWaited;
  brushTrace('document_frames',{waited,frames:page.frames().map(frame=>{
    try{const u=new URL(frame.url());return {host:u.hostname,path:u.pathname};}catch{return {path:'unsupported'};}
  })});
  for(const frame of page.frames()){
    if(cancelled())break;
    try{
      let embedded=false;
      try{
        const parent=frame.parentFrame();
        if(parent&&allowed(parent)&&/\/ananas\/modules\/pdf\//.test(parent.url())){
          const owner=await frame.frameElement();
          embedded=await owner.evaluate(el=>el.matches('#panView, #wpsView, #office-iframe'));
        }
      }catch{embedded=false;}
      // The site's PDF/PPT wrapper delegates rendering and scrolling to panView,
      // which can be hosted on the school's document/CDN domain.
      if(!allowed(frame)&&!embedded)continue;
      let isDocument=embedded;
      if(!isDocument){
        try{
          isDocument=await frame.evaluate(()=>!!document.querySelector('.pdfViewer, #viewerContainer, .ndfHF-content, [data-document-viewer]')||
            /\/(?:pdf|ppt|document)(?:\/|\.|\?)/i.test(location.href));
        }catch{isDocument=false;}
        // chaoxing renders the actual PDF/PPT inside pan-yz.chaoxing.com
        // /screen/v2/... frames (nested below the panView wrapper). Match by
        // URL without relying on evaluate, since these frames can detach.
        if(!isDocument&&/\/screen\/v2\//.test(frame.url()))isDocument=true;
      }
      if(!isDocument)continue;
      brushTrace('frame_is_document',{host:frame.url().slice(0,100),embedded});
      // A blank embedded frame is an empty placeholder — skip it. The real PDF
      // (pan-yz /screen/v2/) is ALSO marked embedded (its frameElement is the
      // panView iframe) and must NOT be skipped — it is the actual content.
      if(embedded&&frame.url()==='about:blank')continue;
      brushTrace('document_detected',{embedded,host:new URL(frame.url()).hostname,path:new URL(frame.url()).pathname,
        hasPanIframe:await frame.locator('iframe#panView, iframe#wpsView, iframe#office-iframe').count(),
        bodyLen:(await frame.evaluate(()=>(document.body&&document.body.innerHTML.length)||0).catch(()=>0))});
      // The PDF content usually lives in THIS frame's body (the panView
      // <iframe>s are often empty placeholders). Scroll this frame first; only
      // fall back to child frames when this frame has nothing scrollable.
      let ready=false;
      for(let attempt=0;attempt<30&&!cancelled();attempt++){
        ready=await frame.evaluate(()=>{
          if(!document.body)return false;
          if(document.body.innerText.trim())return true;
          if(document.querySelector('img,canvas,svg,embed,object,.page,.pdf-page,[class*="page"]'))return true;
          // PDF renderers may keep everything inside nested containers or
          // load lazily — consider any non-trivial body content as ready.
          return (document.body.innerHTML||'').length>200;
        });
        if(ready)break;
        await wait(500);
      }
      if(cancelled())break;
      if(!ready){
        brushTrace('document_not_ready',{embedded,host:frame.url().slice(0,120),
          bodyLen:(await frame.evaluate(()=>(document.body&&document.body.innerHTML.length)||0).catch(()=>0)),
          html:(await frame.evaluate(()=>(document.documentElement&&document.documentElement.outerHTML||'').slice(0,500)).catch(()=>''))});
        continue;
      }
      const scrolled=await scrollOneFrame(page,frame,emitMsg,wait,cancelled);
      if(scrolled)documents++;
    }catch(error){
      const msg=String(error.message||error);
      brushTrace('document_error',{message:msg.replace(/https?:\/\/[^\s]+/g,'[url]')});
      // Frame detach/close is a transient, recoverable condition (lazy frames
      // often navigate away) — skip this frame and keep scanning the rest.
      if(/closed|detached|context or browser/i.test(msg))continue;
      if(!cancelled())throw error;
    }
  }
  return documents;
}

// Scroll a single document frame to the bottom. Returns true when the frame's
// own scrolling pane reaches the bottom (or is already there).
async function scrollOneFrame(page,frame,emitMsg,wait,cancelled){
  emitMsg('正在下拉课件右侧滚动条至底部…');
  let bottom=false, stable=0, lastExtent='', unchanged=0;
  for(let step=0;step<500&&!cancelled();step++){
    // 用户手动切换章节：中止滚动，交还主循环重新识别。
    if(await navChanged(page))throw new Error('manual section change');
    const target=await frame.evaluate(()=>{
      document.querySelectorAll('[data-course-helper-scroll]').forEach(el=>el.removeAttribute('data-course-helper-scroll'));
      // #panView may be a scrollable div (real scroller) OR an <iframe> whose
      // content lives in a child frame. Only treat it as a scroll pane when it
      // is NOT an iframe — otherwise its scrollHeight is misleadingly equal to
      // clientHeight and we would falsely report "already at bottom".
      const panRaw=document.querySelector('#panView');
      const pan=(panRaw&&panRaw.tagName!=='IFRAME')?panRaw:null;
      // Dump every element that has scrollable overflow OR a scrollbar-ish
      // style, plus the body/root, so we can see the real scroll geometry.
      const dump=[];
      for(const n of [document.scrollingElement,...document.querySelectorAll('body *')]){
        const cs=getComputedStyle(n);
        const overflow=cs.overflowY;
        const scrollable=n.scrollHeight>n.clientHeight+1||/auto|scroll|overlay/.test(overflow);
        if(scrollable){
          dump.push({t:n.tagName,id:n.id||'',cls:typeof n.className==='string'?n.className.slice(0,40):'',sh:n.scrollHeight,ch:n.clientHeight,st:n.scrollTop,ov:overflow});
        }
      }
      // Report the real shape of panView and any document iframes so we can
      // tell whether the scroller is a div, an iframe, or a nested child.
      const iframes=[...document.querySelectorAll('iframe')].map(f=>({id:f.id||'',cls:typeof f.className==='string'?f.className.slice(0,30):'',src:(f.getAttribute('src')||'').slice(0,80)}));
      const panInfo=pan?{tag:pan.tagName,id:pan.id,cls:typeof pan.className==='string'?pan.className.slice(0,40):'',sh:pan.scrollHeight,ch:pan.clientHeight,ov:getComputedStyle(pan).overflowY,childTags:[...pan.children].slice(0,12).map(c=>c.tagName+(c.id?'#'+c.id:''))}:null;
      window.__scrollDiag={mode:pan?'panView':'native',panInfo,iframes,dump};
      // chaoxing panView scrolls via wheel events on the panView element
      // (its content layer is absolutely positioned, often with no native
      // overflow scroller). Detect panView and measure its real content
      // extent through its scrollHeight.
      if(pan){
        pan.setAttribute('data-course-helper-scroll','active');
        return {top:pan.scrollTop,height:pan.clientHeight,total:pan.scrollHeight};
      }
      const roots=[...new Set([document.scrollingElement,...document.querySelectorAll('body *')])].filter(el=>{
        if(!el||el.clientHeight<80||el.clientWidth<150||!el.getClientRects().length)return false;
        const style=getComputedStyle(el);
        return style.visibility!=='hidden'&&el.scrollHeight>el.clientHeight+3&&
          (el===document.scrollingElement||/auto|scroll|overlay/.test(style.overflowY));
      });
      let inner=roots.filter(el=>!roots.some(other=>el!==other&&el.contains(other)));
      inner.sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
      // Fallback: chaoxing often sets overflow:hidden/visible and scrolls via
      // JS. Accept any element with real overflow when no native scroller is
      // found, so the real PDF pane is not missed.
      if(!inner.length){
        inner=[...new Set([document.scrollingElement,...document.querySelectorAll('body *')])].filter(el=>{
          if(!el||el.clientHeight<80||el.clientWidth<150||!el.getClientRects().length)return false;
          const style=getComputedStyle(el);
          return style.visibility!=='hidden'&&el.scrollHeight>el.clientHeight+8;
        });
        inner=inner.filter(el=>!inner.some(other=>el!==other&&el.contains(other)));
        inner.sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
      }
      const cands=(inner.length?inner:[document.scrollingElement]).filter(c=>c.scrollHeight>c.clientHeight+3);
      let el=null;
      for(const c of cands){
        const before=c.scrollTop;
        c.scrollTop=c.scrollHeight-c.clientHeight;
        if(c.scrollTop>before+1){el=c;break;}
      }
      if(!el&&cands.length)el=cands[0];
      if(!el)return null;
      el.setAttribute('data-course-helper-scroll','active');
      window.__scrollDiag={mode:'native',cands:cands.length,elClass:(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className)||'',elTag:el.tagName,panInfo,iframes,dump};
      return {top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight};
    });
    if(!target){brushTrace('scroll_no_target',{});return false;}
    const diag=await frame.evaluate(()=>window.__scrollDiag);
    brushTrace('scroll_before',{step,...target,diag});
    const pane=frame.locator('[data-course-helper-scroll="active"]');
    if(target.top+target.height<target.total-3){
      if(diag.mode==='panView'){
        // Drive panView with wheel events (its native input), then force
        // scrollTop as a fallback for viewers without wheel handlers.
        const box=await pane.boundingBox();
        if(box)await page.mouse.move(Math.max(0,Math.floor(box.x)+Math.min(100,box.width/2)),Math.floor(box.y)+Math.min(300,box.height/2));
        else await page.mouse.move(200,300);
        for(let w=0;w<60;w++){
          await page.mouse.wheel(0,900);
          await wait(30);
        }
        await pane.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      }else{
        await dragDocumentScrollbar(page,frame,pane);
      }
    }
    await wait(500);
    const after=await pane.evaluate(el=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>
      resolve({top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight})))));
    bottom=after.top+after.height>=after.total-3;
    brushTrace('scroll_after',{step,bottom,...after});
    const extent=`${after.total}|${after.height}`;
    stable=bottom&&extent===lastExtent?stable+1:0;
    lastExtent=extent;
    unchanged=!bottom&&after.top<=target.top?unchanged+1:0;
    if(unchanged>=5)throw new Error('document scroll stalled');
    if(stable>=2)break;
  }
  if(bottom&&!cancelled())return true;
  emitMsg('文档尚未浏览到底，任务点完成情况请在平台核对。');
  return false;
}

async function dragDocumentScrollbar(page,frame,pane){
  const geometry=await pane.evaluate(el=>({
    root:el===document.scrollingElement,top:el.scrollTop,total:el.scrollHeight,
    height:el.clientHeight,width:el.clientWidth,
    gutter:el===document.scrollingElement?innerWidth-document.documentElement.clientWidth:el.offsetWidth-el.clientWidth-el.clientLeft*2,
    left:el.clientLeft,borderTop:el.clientTop,
  }));
  let box;
  if(geometry.root&&frame!==page.mainFrame()){
    const owner=await frame.frameElement();
    await owner.scrollIntoViewIfNeeded({timeout:5000});
    box=await owner.boundingBox();
    if(box){
      const border=await owner.evaluate(el=>({left:el.clientLeft,top:el.clientTop}));
      box={...box,x:box.x+border.left,y:box.y+border.top};
    }
  }else if(geometry.root){box={x:0,y:0};}
  else{
    await pane.scrollIntoViewIfNeeded({timeout:5000});
    box=await pane.boundingBox();
    if(box)box={...box,x:box.x+geometry.left,y:box.y+geometry.borderTop};
  }
  if(!box)throw new Error('document scroll target unavailable');
  if(geometry.gutter>3){
    const inset=Math.min(16,geometry.height*.1);
    const track=geometry.height-inset*2;
    const thumb=Math.max(20,track*geometry.height/geometry.total);
    const travel=Math.max(0,track-thumb);
    const x=box.x+geometry.width+geometry.gutter/2;
    const from=box.y+inset+thumb/2+travel*geometry.top/Math.max(1,geometry.total-geometry.height);
    const to=box.y+geometry.height-inset-thumb/2;
    await page.mouse.move(x,from);
    await page.mouse.down();
    try{await page.mouse.move(x,to,{steps:24});}
    finally{await page.mouse.up();}
  }
  // Overlay/custom scrollbar thumbs may not expose a native gutter. Apply the
  // same scroll position to this verified viewer pane, never the outer page.
  // The browser dispatches the viewer's ordinary scroll event after this move.
  await pane.evaluate(el=>{el.scrollTop=el.scrollHeight-el.clientHeight;});
}

function defaultMuteMedia(){
  const mute=el=>{el.defaultMuted=true;el.muted=true;};
  const prepare=el=>{
    mute(el);
    el.addEventListener('loadedmetadata',()=>mute(el));
    el.addEventListener('play',()=>mute(el));
    el.addEventListener('playing',()=>mute(el));
  };
  const scan=root=>{
    if(root.matches?.('video,audio'))prepare(root);
    root.querySelectorAll?.('video,audio').forEach(prepare);
  };
  scan(document);
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)scan(node);
  }).observe(document,{subtree:true,childList:true});
}

async function sectionFingerprint(page){
  const parts=[];
  for(const frame of page.frames()){
    if(!allowed(frame))continue;
    try{
      const part=await frame.evaluate(()=>{
        const chapter=document.querySelector('#chapterIdid')?.value||
          [...new URL(location.href).searchParams].find(([key])=>key.toLowerCase()==='chapterid')?.[1];
        const card=document.querySelector('#prev_tab .prev_ul li.active, .prev_list li.active')?.getAttribute('cardid');
        // Exclude floating dialogs/tips so a "任务点未完成" popup doesn't look like a section change.
        const stripModal=s=>{
          const clone=document.body.cloneNode(true);
          clone.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="Modal"],[class*="Tips"],[class*="mask"],[class*="popup"],[class*="layui-layer"],[role="dialog"],#cx-hud').forEach(e=>e.remove());
          return (clone.innerText||'').replace(/\s+/g,' ').slice(0,1200);
        };
        // Player timers, loading text and catalogue counters change during normal
        // playback. A real chapter/card identity must not depend on that text.
        if(chapter)return JSON.stringify({url:location.origin+location.pathname,chapter,card,
          content:document.querySelector('#iframe')?.getAttribute('src')});
        return JSON.stringify({url:location.href,
        headings:[...document.querySelectorAll('h1,h2,h3,.chapter_title,.chapter-title')].map(el=>el.textContent.trim()),
        media:[...document.querySelectorAll('video,iframe,embed,object')].map(el=>el.getAttribute('src')||el.getAttribute('data')||''),
        // Content identity also covers same-URL AJAX navigation without headings.
        text:stripModal()});
      });
      parts.push(part);
      if(JSON.parse(part).chapter)return JSON.stringify([part]);
    }catch{}
  }
  return JSON.stringify(parts);
}

async function waitForSectionChange(page,before,timeout=10000){
  const deadline=Date.now()+timeout;
  while(!stopped&&Date.now()<deadline){
    await delay(250);
    if(await sectionFingerprint(page)!==before){
      // Allow replaced frames and lazy players to attach before scanning media.
      await delay(1000);
      return true;
    }
  }
  return false;
}

// Negotiate once per video from the requested ceiling downward. A later
// platform reset lowers that ceiling, so rejected speeds are not forced again.
async function setPlaybackSpeed(frame, i, requested='auto', {ceiling=Infinity}={}){
  const limit=Math.min(ceiling,requested==='auto'?Math.max(...PLAYBACK_SPEEDS):
    PLAYBACK_SPEEDS.includes(requested)?requested:1);
  const meta=await frame.evaluate(i=>{
    const video=document.querySelectorAll('video')[i];
    if(!video)return {exists:false,rates:[]};
    const player=video.closest('.video-js')||video.parentElement;
    const control=player?.querySelector('.vjs-playback-rate');
    const enabled=control&&!control.classList.contains('vjs-hidden')&&control.getClientRects().length&&
      getComputedStyle(control).visibility!=='hidden'&&control.getAttribute('aria-disabled')!=='true';
    const rates=enabled?[...control.querySelectorAll('.vjs-menu-item')].filter(item=>
      item.getAttribute('aria-disabled')!=='true'&&!item.classList.contains('vjs-disabled'))
      .map(item=>/^\d+(?:\.\d+)?\s*[x×倍]/i.test(item.textContent.trim())?parseFloat(item.textContent):NaN)
      .filter(Number.isFinite):[];
    return {exists:true,rates};
  },i);
  if(!meta.exists)return 1;
  const candidates=[...new Set([...PLAYBACK_SPEEDS,...meta.rates])]
    .filter(rate=>rate<=limit&&rate>=(limit<1?.75:1)).sort((a,b)=>b-a);
  if(!candidates.includes(1))candidates.push(1);
  const attempted=[];
  for(const speed of candidates){
    if(stopped)break;
    attempted.push(speed);
    const native=await frame.evaluate(({i,speed})=>{
      const video=document.querySelectorAll('video')[i];
      if(!video)return false;
      const player=video.closest('.video-js')||video.parentElement;
      const control=player?.querySelector('.vjs-playback-rate');
      const enabled=control&&!control.classList.contains('vjs-hidden')&&control.getClientRects().length&&
        getComputedStyle(control).visibility!=='hidden'&&control.getAttribute('aria-disabled')!=='true';
      const option=enabled&&[...control.querySelectorAll('.vjs-menu-item')].find(item=>
        /^\d+(?:\.\d+)?\s*[x×倍]/i.test(item.textContent.trim())&&parseFloat(item.textContent)===speed&&
        item.getAttribute('aria-disabled')!=='true'&&!item.classList.contains('vjs-disabled'));
      if(option&&speed!==1){option.click();return true;}
      try{video.playbackRate=speed;}catch{}
      return false;
    },{i,speed});
    await delay(350);
    const read=()=>frame.evaluate(i=>document.querySelectorAll('video')[i]?.playbackRate||1,i);
    let actual=await read();
    if(native&&Math.abs(actual-speed)>.01&&!stopped){
      await frame.evaluate(({i,speed})=>{try{document.querySelectorAll('video')[i].playbackRate=speed;}catch{}},{i,speed});
      await delay(350);
      actual=await read();
    }
    if(Math.abs(actual-speed)<=.01){
      brushTrace('playback_speed',{requested,attempted,actual});
      return actual;
    }
  }
  return frame.evaluate(i=>document.querySelectorAll('video')[i]?.playbackRate||1,i);
}

async function playLiveEntry(page, section, emitMsg, playbackSpeed='auto'){
  const originalUrl=page.url();
  const originalFP=watchFP;
  let popup=null, clicked=false;
  const onPopup=p=>{popup=p;};
  page.on('popup',onPopup);
  try{
    for(const frame of page.frames()){
      if(!allowed(frame))continue;
      const entry=frame.getByText('直播',{exact:true}).first();
      if(!await entry.isVisible().catch(()=>false))continue;
      emitMsg('点击直播入口，等待直播或回放页面…');
      await entry.click({timeout:5000});
      clicked=true;
      break;
    }
    if(!clicked)return 0;
    const deadline=Date.now()+20000;
    let target=page;
    while(!stopped&&Date.now()<deadline){
      target=popup||page;
      if(target.isClosed())break;
      if((await sectionState(target)).video)break;
      await delay(250);
    }
    if(stopped||target.isClosed())return 0;
    if(!(await sectionState(target)).video){
      emitMsg('直播入口已打开，但未发现可播放的直播或回放，任务保留待确认。');
      if(popup&&!popup.isClosed())await popup.close();
      if(page.url()!==originalUrl)await page.goto(originalUrl,{waitUntil:'domcontentloaded'});
      await page.bringToFront();
      return 0;
    }
    await target.bringToFront();
    watchFP=await sectionFingerprint(target);
    const played=await playVideos(target,section,emitMsg,playbackSpeed);
    if(played&&!stopped){
      if(popup&&!popup.isClosed())await popup.close();
      if(page.url()!==originalUrl)await page.goto(originalUrl,{waitUntil:'domcontentloaded'});
      else await page.reload({waitUntil:'domcontentloaded'});
      await page.bringToFront();
      await waitForSection(page);
      emitMsg('直播播放结束，已返回并刷新章节，请以平台任务点状态为准。');
    }
    return played;
  }finally{
    page.off('popup',onPopup);
    watchFP=originalFP;
  }
}

async function playVideos(page, section, emitMsg, playbackSpeed='auto'){
  let played=0;
  const frames=[];
  for(const f of page.frames()){
    try{if(allowed(f)&&await f.locator('video').count())frames.push(f);}catch{}
  }
  for(const f of frames){
    let n=0;
    try{n=await f.locator('video').count();}catch{continue;}
    for(let i=0;i<n&&!stopped;i++){
      try{
        const state=await f.evaluate(({i})=>{
          const v=document.querySelectorAll('video')[i];
          if(!v)return null;
          v.muted=true;v.playbackRate=1;
          return {cur:v.currentTime||0,dur:isFinite(v.duration)?v.duration:0};
        },{i});
        if(!state)continue;
        if(state.dur&&state.cur>=state.dur-2)continue;
        emitMsg(`第 ${section+1} 节：播放视频 ${i+1}/${n}${state.dur?`（约 ${Math.round(state.dur)} 秒）`:''}…`);
        // Native controls initialize the platform player and its normal event flow.
        const start=f.locator('.vjs-big-play-button').nth(i);
        if(await start.count()&&await start.isVisible().catch(()=>false))await start.click({timeout:3000}).catch(()=>{});
        await f.evaluate(({i})=>{
          const v=document.querySelectorAll('video')[i];
          const p=v.play();if(p)p.catch(()=>{});
        },{i}).catch(()=>{});
        let actualSpeed=await setPlaybackSpeed(f,i,playbackSpeed);
        emitMsg(playbackSpeed==='auto'?`已自动选择可用倍速：${actualSpeed} 倍。`:
          Math.abs(actualSpeed-playbackSpeed)<.01?`视频使用 ${actualSpeed} 倍速播放。`:
          `所选倍速不可用，已调整为 ${actualSpeed} 倍。`);
        let finished=false, started=false, lastTime=state.cur, stalledAt=Date.now();
        let durationKnown=state.dur>0;
        let deadline=Date.now()+(state.dur?state.dur*1000:0)+180000;
        while(!stopped&&Date.now()<deadline){
          const st=await f.evaluate(({i})=>{
            const v=document.querySelectorAll('video')[i];
            if(!v)return null;
            v.muted=true;
            return {ended:v.ended,cur:v.currentTime||0,dur:isFinite(v.duration)?v.duration:0,paused:v.paused,rate:v.playbackRate};
          },{i}).catch(()=>null);
          if(!st)break;
          // 用户手动切换章节：放弃当前视频，交还主循环重新识别。
          if(await navChanged(page))throw new Error('manual section change');
          if(!durationKnown&&st.dur>0){
            durationKnown=true;
            deadline=Date.now()+Math.max(0,st.dur-st.cur)*1000+180000;
          }
          if(st.ended||(st.dur&&st.cur>=st.dur-1)){finished=true;break;}
          if(st.cur>lastTime+.1){started=true;lastTime=st.cur;stalledAt=Date.now();}
          if(Date.now()-stalledAt>45000){
            emitMsg(started?'视频播放已停滞，请在保留的课程页面检查。':'视频尚未开始播放，请在保留的课程页面检查加载或验证提示。');
            throw new Error('video playback stalled');
          }
          if(Math.abs(st.rate-actualSpeed)>.01){
            actualSpeed=await setPlaybackSpeed(f,i,playbackSpeed,{ceiling:actualSpeed-.01});
            emitMsg(`播放器限制发生变化，已调整为可用的 ${actualSpeed} 倍速。`);
          }
          if(st.paused)await f.evaluate(({i})=>{
            const v=document.querySelectorAll('video')[i];
            const p=v.play();if(p)p.catch(()=>{});
          },{i}).catch(()=>{});
          // 暂停：同步暂停视频，恢复时继续；期间不推进 stalled 计时。
          if(paused){
            await f.evaluate(({i})=>{
              const v=document.querySelectorAll('video')[i];
              if(v&&!v.paused)v.pause();
            },{i}).catch(()=>{});
            while(paused&&!stopped)await delay(250);
            stalledAt=Date.now();
            await f.evaluate(({i})=>{
              const v=document.querySelectorAll('video')[i];
              const p=v.play();if(p)p.catch(()=>{});
            },{i}).catch(()=>{});
            continue;
          }
          await delay(2000);
        }
        if(finished)played++;
        else if(!stopped)throw new Error('video playback incomplete');
      }catch(error){if(!stopped)throw error;}
    }
  }
  return played;
}

async function findQuizFrame(page){
  for(const frame of page.frames()){
    if(!allowed(frame))continue;
    try{
      if(/\/work\/(?:doHomeWork|doHomeWorkNew|selectWorkQuestion|doTest)/.test(frame.url()))return frame;
      if(await frame.evaluate(()=>[...document.querySelectorAll('.questionLi, .TiMu, div[id^="question"]')]
        .some(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&(el.innerText||'').trim())))return frame;
      // New-UI pages render questions without classic classes; match by text markers.
      if(await frame.evaluate(()=>{
        const t=document.body?.innerText||'';
        return /\[\s*(单选|多选|判断)题\s*\]/.test(t)||(/作业与测试/.test(t)&&/暂时保存/.test(t));
      }))return frame;
    }catch{}
  }
  return null;
}

// Reusable quiz extraction (answering mode AND review page share the same DOM).
// Returns decoded questions: {i,type,stem,options}.
async function extractQuizQuestions(frame){
  const questions=await frame.evaluate(()=>{
    const pick=sel=>[...document.querySelectorAll(sel)];
    let items=pick('div[id^="question"]');
    if(!items.length)items=pick('.questionLi, .TiMu');
    if(!items.length){
      items=pick('[class*="question"],[class*="Question"],[class*="TiMu"],[class*="timu"]')
        .filter(el=>el.getClientRects().length&&!el.querySelector('div[id^="question"],[class*="question"],[class*="TiMu"]'));
    }
    // Keep only the deepest question containers (drop wrappers that contain other questions).
    if(items.length>1)items=items.filter(el=>!items.some(o=>o!==el&&el.contains(o)));
    const stemOf=el=>{
      const t=el.querySelector('.Zy_TItle, .newZy_TItle, .fontLabel, .mark_name, h3, .TiMu')||el;
      // Some layouts place options inside the title wrapper. Read only the
      // nodes before the answer area, retaining inline formula text.
      const option=t.querySelector('ul.Zy_ulTop, .answerArea, .answerItem, .num_item, [class*="answerItem"], [class*="answer-item"], .mark_letter');
      const range=document.createRange();
      range.selectNodeContents(t);
      if(option)range.setEndBefore(option);
      return range.toString().trim().replace(/^\d+[\.、\s]*/, '').slice(0,800);
    };
    const optionSelector='ul.Zy_ulTop>li, .answerArea .answerItem, .answerItem, .num_item, [class*="answerItem"], [class*="answer-item"], .mark_letter li';
    return items.slice(0,60).map((el,i)=>{
      const text=el.innerText||'';
      let type='single';
      if(/多选/.test(text))type='multiple';
      else if(/判断/.test(text))type='judge';
      const stem=stemOf(el);
      let optEls=[...el.querySelectorAll(optionSelector)];
      if(!optEls.length){
        optEls=[...el.querySelectorAll('li,[onclick],label,div,span')].filter(o=>{
          if(!o.getClientRects().length)return false;
          if(o.querySelector('input[type=radio],input[type=checkbox]'))return true;
          const t=(o.innerText||'').trim();
          return /^([A-Z])(?![a-zA-Z])/.test(t)&&t.length<120&&o.children.length<=5;
        });
      }
      const options=optEls.map(o=>(o.innerText||'').trim()).filter(Boolean).slice(0,10);
      const images=[...el.querySelectorAll('img')].map(img=>img.currentSrc||img.src||img.getAttribute('data-src')||'');
      return {i,type,stem,options,images};
    }).filter(q=>q.stem&&q.options.length);
  });
  if(!questions.length){
    brushTrace('quiz_extract_failed',{
      url:frame.url().slice(0,160),
      samples:await frame.evaluate(()=>[...document.querySelectorAll('div[id^="question"],.questionLi,.TiMu')]
        .slice(0,3).map(el=>({tag:el.tagName,id:el.id,cls:el.className.slice(0,80),head:(el.innerText||'').slice(0,80)}))).catch(()=>[]),
    });
    return [];
  }
  const imageData=new Map();
  const needed=new Set(questions.flatMap(q=>q.images));
  if(needed.size){
    for(const image of await frame.locator('img').all()){
      const source=await image.evaluate(img=>img.currentSrc||img.src||img.getAttribute('data-src')||'').catch(()=>'');
      if(!needed.has(source)||imageData.has(source))continue;
      try{
        await image.evaluate(img=>img.decode());
        const bytes=await image.screenshot({type:'png',timeout:5000});
        if(bytes.length<=2000000)imageData.set(source,'data:image/png;base64,'+bytes.toString('base64'));
      }catch{}
    }
    for(const q of questions){
      q.image_data=q.images.map(source=>imageData.get(source)||'');
    }
  }
  // 加密字体:从页面内嵌 base64 构建解码器,还题干与选项为明文。
  if(await ensureCxDecoder(frame)){
    for(const q of questions){
      q.stem=cxDecode(q.stem);
      q.options=q.options.map(cxDecode);
    }
  }
  // Log raw stems so we can tell plaintext vs font-obfuscated (加密字体) questions.
  brushTrace('quiz_extracted',{url:frame.url().slice(0,160),decoded:!!cxDecoder,
    sample:questions.slice(0,2).map(q=>({type:q.type,stem:q.stem.slice(0,120),options:q.options.slice(0,4)}))});
  return questions;
}

// Click option rows by letter inside question container #qi.
function quizClickScript({qi,choice}){
  const pick=sel=>[...document.querySelectorAll(sel)];
  let items=pick('div[id^="question"]');
  if(!items.length)items=pick('.questionLi, .TiMu');
  if(items.length>1)items=items.filter(el=>!items.some(o=>o!==el&&el.contains(o)));
  const el=items[qi];
  if(!el)return false;
  const optionSelector='ul.Zy_ulTop>li, .answerArea .answerItem, .answerItem, .num_item, [class*="answerItem"], [class*="answer-item"], .mark_letter li';
  let opts=[...el.querySelectorAll(optionSelector)];
  if(!opts.length){
    opts=[...el.querySelectorAll('li,[onclick],label,div,span')].filter(o=>{
      if(!o.getClientRects().length)return false;
      if(o.querySelector('input[type=radio],input[type=checkbox]'))return true;
      const t=(o.innerText||'').trim();
      return /^([A-Z])(?![a-zA-Z])/.test(t)&&t.length<120&&o.children.length<=5;
    });
  }
  const seen=new Set();
  let hit=0;
  for(const o of opts){
    const t=(o.innerText||'').trim();
    // Option letter is usually in span.num_option (data attr) or the row's leading char.
    const letterEl=o.querySelector('.num_option, [class*="num_option"], [class*="optionNum"]');
    const m=(letterEl?(letterEl.innerText||letterEl.getAttribute('data')||''):t).trim().match(/^([A-Z])(?![a-zA-Z])/)||t.match(/^([A-Z])(?![a-zA-Z])/);
    if(m&&choice.includes(m[1])&&!seen.has(m[1])){
      seen.add(m[1]);
      const target=o.querySelector('input[type=radio],input[type=checkbox],a.after,a,[onclick]')||o.closest('[onclick]')||o;
      target.click();
      hit++;
    }
  }
  return hit>0;
}

// Stable key for matching a question across redo attempts (order is shuffled).
function stemKey(s){
  return (s||'').replace(/\s+/g,'').replace(/^【?\[?(单选|多选|判断)题】?\]?/,'').slice(0,80);
}

// ---------- 本地题库：批阅页自动导入，答题时优先命中 ----------
const QUIZ_BANK_FILE=path.join(DATA_ROOT,'quiz_bank.json');
let quizBank=null;
function loadQuizBank(){
  if(quizBank)return quizBank;
  try{quizBank=JSON.parse(fs.readFileSync(QUIZ_BANK_FILE,'utf8'));}catch{quizBank={};}
  if(!quizBank||typeof quizBank!=='object')quizBank={};
  return quizBank;
}
function saveQuizBank(){
  try{
    fs.mkdirSync(path.dirname(QUIZ_BANK_FILE),{recursive:true});
    fs.writeFileSync(QUIZ_BANK_FILE,JSON.stringify(quizBank,null,1));
  }catch{}
}
// 批阅页答案入库：correct 已知的题全部记录，返回新增/更新条数。
function bankImport(answers){
  const bank=loadQuizBank();
  let changed=0;
  for(const q of answers||[]){
    if(!q||!q.correct)continue;
    const key=stemKey(q.stem);
    if(!key)continue;
    if(!bank[key]||bank[key].correct!==q.correct)changed++;
    bank[key]={stem:String(q.stem||'').slice(0,300),correct:q.correct,updated:new Date().toISOString()};
  }
  if(changed)saveQuizBank();
  return changed;
}
function bankLookup(stem){
  const bank=loadQuizBank();
  const key=stemKey(stem);
  const hit=bank[key];
  if(hit&&hit.correct)return hit.correct;
  // 重做页可能使用不同的加密字体子集，解码文本存在字形差异（如"下列"→"惛列"），
  // 精确匹配失败时按 LCS 相似度取最接近的题。
  let best=null,bestScore=0;
  for(const [k,v] of Object.entries(bank)){
    const s=textSimilarity(key,k);
    if(s>bestScore){bestScore=s;best=v;}
  }
  return bestScore>=0.75&&best&&best.correct?best.correct:null;
}

// LCS 相似度（2*LCS/长度和），比较前 80 字控制开销。
function textSimilarity(a,b){
  if(!a||!b)return 0;
  if(a===b)return 1;
  const A=String(a).slice(0,80),B=String(b).slice(0,80);
  const m=A.length,n=B.length;
  if(!m||!n)return 0;
  let prev=new Array(n+1).fill(0);
  for(let i=1;i<=m;i++){
    const cur=new Array(n+1).fill(0);
    for(let j=1;j<=n;j++)cur[j]=A[i-1]===B[j-1]?prev[j-1]+1:Math.max(prev[j],cur[j-1]);
    prev=cur;
  }
  return 2*prev[n]/(m+n);
}

// 在批阅页答案（优先）与本地题库（兜底）中为一道题找出已知正确答案。
function matchCorrect(stem,answers){
  const key=stemKey(stem);
  for(const q of answers||[]){
    if(q&&q.correct&&stemKey(q.stem)===key)return q.correct;
  }
  for(const q of answers||[]){
    if(q&&q.correct&&textSimilarity(key,stemKey(q.stem))>=0.75)return q.correct;
  }
  return bankLookup(stem);
}

// 当前是否处于批阅页（有题目且出现"正确答案："）。
async function quizReviewMode(page){
  for(const frame of page.frames()){
    if(!allowed(frame))continue;
    try{
      if(await frame.evaluate(()=>/正确答案[：:]/.test(document.body?.innerText||'')&&
        !!document.querySelector('div[id^="question"],.questionLi,.TiMu')))return true;
    }catch{}
  }
  return false;
}

// Read the review/批阅 page: stems plus 我的答案/正确答案 letters (decoded).
async function collectReview(page){
  const frame=await findQuizFrame(page);
  if(!frame)return null;
  const raw=await frame.evaluate(()=>{
    const pick=sel=>[...document.querySelectorAll(sel)];
    let items=pick('div[id^="question"]');
    if(!items.length)items=pick('.questionLi, .TiMu');
    if(items.length>1)items=items.filter(el=>!items.some(o=>o!==el&&el.contains(o)));
    return items.map(el=>{
      const t=el.querySelector('.Zy_TItle, .newZy_TItle, .fontLabel, .mark_name, h3, .TiMu')||el;
      const stem=(t.innerText||'').trim().replace(/^\d+[\.、\s]*/,'').slice(0,800);
      const text=el.innerText||'';
      const mine=((text.match(/我的答案[：:]\s*([A-Z]+)/)||[])[1]||'').trim();
      const correct=((text.match(/正确答案[：:]\s*([A-Z]+)/)||[])[1]||'').trim();
      return {stem,mine,correct};
    }).filter(q=>q.stem);
  }).catch(()=>[]);
  if(!raw.length)return null;
  if(await ensureCxDecoder(frame))for(const q of raw)q.stem=cxDecode(q.stem);
  // Read the page score / redo budget once (e.g. "成绩：80" / "重做（剩余 5 次）").
  const meta=await frame.evaluate(()=>{
    const body=document.body?.innerText||'';
    // Only use an earned overall score outside questions. A question's “得分”
    // or the paper's “满分” is not the student's final grade.
    const copy=document.body?.cloneNode(true);
    copy?.querySelectorAll('div[id^="question"],.questionLi,.TiMu').forEach(el=>el.remove());
    const summary=copy?.textContent||'';
    const scoreM=summary.match(/(?:最终成绩|本次成绩|测验成绩|作业成绩|成绩|总得分|总成绩|最终得分|本次得分|得分)\s*[：:]?\s*(\d+(?:\.\d+)?)/);
    const score=scoreM?parseFloat(scoreM[1]):NaN;
    const redoM=body.match(/重做\s*[（(]\s*剩余\s*(\d+)\s*次/);
    const redoLeft=redoM?parseInt(redoM[1],10):NaN;
    const hasRedo=[...document.querySelectorAll('button, a, .btn, div, span')]
      .some(el=>/^重做/.test((el.innerText||'').trim())&&el.getClientRects().length);
    return {score,redoLeft,hasRedo};
  }).catch(()=>({score:NaN,redoLeft:NaN,hasRedo:false}));
  return {frame,answers:raw,...meta};
}

// After a confirmed submission the review page reveals correct answers. Redo and
// re-answer known questions and request answers for newly sampled questions.
// Questions are matched by stem text, not index. Repeat while wrong answers
// remain and 重做 attempts are left, aiming for a full score.
async function redoForFullScore(page,emitMsg){
  for(let round=0;round<=3&&!stopped;round++){
    const review=await collectReview(page);
    if(!review||!review.answers.length)break;
    // 批阅页出现正确答案 → 自动导入本地题库（下次答题直接命中，不再问 AI）。
    const imported=bankImport(review.answers);
    if(imported){
      emitMsg(`已将 ${imported} 条「题目→正确答案」导入本地题库。`);
      brushTrace('bank_imported',{count:imported,total:review.answers.length});
    }
    // A final successful attempt may leave no redo button or remaining attempts.
    if(!Number.isNaN(review.score)&&review.score>=100){
      emitMsg('当前已得满分，无需重做。');
      return true;
    }
    if(round===3){
      emitMsg('已达到本轮三次重做上限，保留当前批阅结果供人工检查。');
      return false;
    }
    // Only redo when a redo opportunity exists and is not exhausted.
    if(!review.hasRedo){
      emitMsg('本次无重做机会（或次数已用完），保留当前成绩。');
      return false;
    }
    if(!Number.isNaN(review.redoLeft)&&review.redoLeft<=0){
      emitMsg('重做次数已用完，保留当前成绩。');
      return false;
    }
    const wrong=review.answers.filter(q=>q.correct&&q.mine&&q.mine!==q.correct);
    brushTrace('redo_review',{round,score:review.score,redoLeft:review.redoLeft,
      questions:review.answers.length,wrong:wrong.length,
      sample:review.answers.slice(0,3).map(q=>({mine:q.mine,correct:q.correct,stem:q.stem.slice(0,60)}))});
    if(!wrong.length&&review.answers.every(q=>q.correct&&q.mine===q.correct)&&
       (Number.isNaN(review.score)||review.score>=100)){
      if(round>0)emitMsg('重做批阅核对：全部正确，满分通过。');
      return true;
    }
    if(!wrong.length){
      emitMsg('批阅结果不足以确认全部正确，已保留页面供人工检查。');
      return false;
    }
    if(!Number.isFinite(review.score)){
      emitMsg('未能确认本次实际成绩，已停止自动重做，请人工检查。');
      return false;
    }
    emitMsg(`批阅发现 ${wrong.length} 道错题，正在重做冲击满分…`);
    // Click the 重做 button (e.g. 重做（剩余 5 次）) inside the work frame.
    const clicked=await review.frame.evaluate(()=>{
      const nodes=[...document.querySelectorAll('button, a, .btn, div, span')];
      const btn=nodes.find(el=>{
        const t=(el.innerText||'').trim();
        return /^重做/.test(t)&&el.getClientRects().length&&!el.querySelector('button,a');
      });
      if(!btn)return false;
      (btn.closest('button,a,[onclick]')||btn).click();
      return true;
    }).catch(()=>false);
    if(!clicked){emitMsg('未找到重做按钮，保留当前成绩。');return false;}
    // Wait for the redo answering page. The site may show in-page confirm dialogs
    // ("确定重做吗") that block navigation — keep dismissing them while waiting.
    let frame=null,questions=[];
    for(let i=0;i<40&&!stopped;i++){
      await delay(700);
      for(const f of page.frames()){
        if(!allowed(f))continue;
        // 不依赖弹窗容器的 class（站点弹窗结构多变）：全局找文本恰好是
        // 确定/确认的可见叶子按钮直接点。重做等待期间页面没有其他确定按钮。
        await f.evaluate(()=>{
          const btn=[...document.querySelectorAll('button, a, .btn, div, span')].find(el=>{
            const t=(el.innerText||'').trim();
            if(!['确定','确 定','确认'].includes(t))return false;
            if(!el.getClientRects().length)return false;
            if(el.querySelector('button,a'))return false;
            if(el.closest('#cx-hud'))return false;
            return true;
          });
          if(btn)(btn.closest('button,a,[onclick]')||btn).click();
        }).catch(()=>{});
      }
      const f=await findQuizFrame(page);
      if(!f)continue;
      const reviewMode=await f.evaluate(()=>/正确答案[：:]/.test(document.body?.innerText||'')).catch(()=>true);
      if(reviewMode)continue;
      questions=await extractQuizQuestions(f);
      if(questions.length){frame=f;break;}
    }
    if(!frame||!questions.length){emitMsg('重做页面未加载出题目，保留当前成绩。');return false;}
    // Re-answer ALL questions: match by review answers first (exact then fuzzy),
    // falling back to the local bank — font subsets differ across pages.
    const filledIndexes=new Set();
    const matched=[];
    for(const q of questions){
      const correct=matchCorrect(q.stem,review.answers);
      if(!correct)continue;
      matched.push({stem:q.stem.slice(0,50),correct});
      const choice=[...correct];
      const ok=await frame.evaluate(quizClickScript,{qi:q.i,choice}).catch(()=>false);
      if(ok)filledIndexes.add(q.i);
    }
    const missing=questions.filter(q=>!filledIndexes.has(q.i));
    if(missing.length&&!stopped){
      emitMsg(`重做有 ${missing.length}/${questions.length} 题未匹配到可用答案，正在请求 AI 重新作答…`);
      brushTrace('redo_request_answers',{round,total:questions.length,missing:missing.map(q=>q.i)});
      // Each redo has a fresh session: never reuse an ungraded answer from
      // the preceding submission, even when the same question is drawn again.
      const reply=await createQuizAnswerSession()(missing,emitMsg);
      const requested=new Set(missing.map(q=>q.i));
      for(const ans of reply?.answers||[]){
        if(stopped)break;
        if(!requested.has(ans.i)||filledIndexes.has(ans.i))continue;
        const choice=(Array.isArray(ans.choice)?ans.choice:[]).filter(c=>typeof c==='string'&&/^[A-Z]$/.test(c));
        if(!choice.length)continue;
        const ok=await frame.evaluate(quizClickScript,{qi:ans.i,choice}).catch(()=>false);
        if(ok)filledIndexes.add(ans.i);
      }
    }
    const filled=filledIndexes.size;
    brushTrace('redo_filled',{round,total:questions.length,filled,matched});
    if(stopped||filled!==questions.length){emitMsg(`重做仅匹配并点选 ${filled}/${questions.length} 题，已停止并保留页面供人工检查。`);return false;}
    const unselected=await unansweredIndexes(frame);
    if(unselected.length){
      brushTrace('redo_unselected',{round,indexes:unselected});
      emitMsg(`重做仍有 ${unselected.length} 题未确认选中，已保留页面供人工检查。`);
      return false;
    }
    emitMsg(`已重做 ${filled}/${questions.length} 题，正在提交…`);
    let submitted=false;
    for(let attempt=0;attempt<3&&!stopped;attempt++){
      const result=await attemptSubmit(frame,page,emitMsg);
      if(result==='success'){submitted=true;break;}
      if(result!=='incomplete')break;
      await delay(800);
    }
    if(!submitted){emitMsg('重做提交未确认成功，请手动检查。');return false;}
  }
  return false;
}

function createQuizAnswerSession(request=requestAnswers){
  // Lifetime: one answering attempt, including click/submit retries only.
  // Full text, question type and ordered options form the key; no fuzzy reuse.
  const cache=new Map();
  const keyOf=q=>JSON.stringify([q.type||'single',q.stem,q.options,q.images||[]]);
  return async(questions,emitMsg)=>{
    const groups=new Map();
    for(const q of questions){
      const key=keyOf(q);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(q);
    }
    const pending=[];
    let hits=0;
    for(const [key,group] of groups){
      if(cache.has(key))hits+=group.length;
      else pending.push(group[0]);
    }
    if(hits)emitMsg(`复用本次作答的 ${hits} 道答案，避免重复调用 AI。`);
    if(pending.length&&!stopped){
      const reply=await request(pending,emitMsg);
      for(const ans of reply?.answers||[]){
        const q=pending.find(q=>q.i===ans.i);
        if(!q||!Array.isArray(ans.choice)||!ans.choice.length)continue;
        const choice=[...new Set(ans.choice)].sort();
        if(choice.length!==ans.choice.length||
           choice.some(c=>typeof c!=='string'||!/^[A-Z]$/.test(c)||c.charCodeAt(0)-65>=q.options.length)||
           (q.type!=='multiple'&&choice.length!==1))continue;
        cache.set(keyOf(q),choice);
      }
    }
    return {answers:questions.flatMap(q=>{
      const choice=cache.get(keyOf(q));
      return choice?[{i:q.i,choice:[...choice]}]:[];
    })};
  };
}

async function tryAnswerQuiz(page, emitMsg){
  // If the "任务点未完成" popup auto-opened on entering this quiz section, dismiss it
  // (staying on the section) so it does not interfere with reading/answering.
  if(await confirmLeaveDialog(page)==='closed')emitMsg('已关闭自动弹出的任务点未完成提示，继续答题…');
  const frame=await findQuizFrame(page);
  if(!frame)return 0;
  // 批阅页守卫：批阅页也有题目容器但绝不能当新题作答，交给重做流程。
  if(await frame.evaluate(()=>/正确答案[：:]/.test(document.body?.innerText||'')).catch(()=>false)){
    emitMsg('当前为批阅页，跳过作答（重做流程会处理）。');
    return 0;
  }
  const questions=await extractQuizQuestions(frame);
  if(!questions.length)return 0;
  const answerSession=createQuizAnswerSession();
  // 本地题库优先：命中的题直接用已验证的正确答案，不问 AI。
  const bankMap=new Map();
  questions.forEach(q=>{
    const correct=bankLookup(q.stem);
    if(correct)bankMap.set(q.i,[...correct]);
  });
  let filled=0;
  for(const [qi,choice] of bankMap){
    const ok=await frame.evaluate(quizClickScript,{qi,choice}).catch(()=>false);
    if(ok)filled++;
  }
  if(bankMap.size)emitMsg(`本地题库命中 ${bankMap.size}/${questions.length} 题，已直接填入正确答案。`);
  const rest=questions.filter(q=>!bankMap.has(q.i));
  if(rest.length){
    emitMsg(`检测到 ${questions.length} 道测验题目（题库未命中 ${rest.length} 题），正在请求 AI 作答…`);
    const reply=await answerSession(rest,emitMsg);
    for(const ans of (reply?.answers||[])){
      const qi=ans.i;
      const choice=(ans.choice||[]).filter(c=>typeof c==='string');
      if(!choice.length||!questions.some(q=>q.i===qi))continue;
      const ok=await frame.evaluate(quizClickScript,{qi,choice}).catch(()=>false);
      if(ok)filled++;
    }
  }
  if(!filled){
    emitMsg('AI 未能作答测验题目，请人工完成。');
    return 0;
  }
  emitMsg(`AI 已作答 ${filled}/${questions.length} 题，正在提交…`);
  let submitted=false;
  for(let attempt=0;attempt<3&&!stopped;attempt++){
    const result=await attemptSubmit(frame,page,emitMsg);
    if(result==='success'){submitted=true;break;}
    if(result!=='incomplete')break;
    const missing=await unansweredIndexes(frame);
    if(!missing.length)continue;
    const todo=questions.filter(q=>missing.includes(q.i));
    emitMsg(`还有 ${todo.length} 题未作答，准备补答…`);
    const retry=await answerSession(todo,emitMsg);
    let more=0;
    for(const ans of (retry?.answers||[])){
      const choice=(ans.choice||[]).filter(c=>typeof c==='string');
      if(!choice.length||ans.i==null)continue;
      const ok=await frame.evaluate(quizClickScript,{qi:ans.i,choice}).catch(()=>false);
      if(ok)more++;
    }
    if(!more){
      emitMsg('补答未成功，请人工完成剩余题目后再提交。');
      break;
    }
    emitMsg(`补答完成 ${more} 题，再次提交…`);
  }
  if(!submitted)emitMsg('本测验尚未确认提交成功，已保留页面，请手动检查并提交后再进入下一节。');
  else{
    // Submission confirmed: the review page reveals correct answers. Redo wrong
    // ones to push the score toward full marks (question order is reshuffled).
    try{
      if(!await redoForFullScore(page,emitMsg))return 0;
    }catch(err){
      brushTrace('redo_error',{message:String(err.message).replace(/https?:\/\/[^\s]+/g,'[url]')});
      emitMsg('重做过程出错，已停止并保留页面供人工检查。');
      return 0;
    }
  }
  return submitted?filled:0;
}

function requestAnswers(questions, emitMsg){
  const token=Math.random().toString(36).slice(2);
  return new Promise(resolve=>{
    const waiter={resolve,timer:null,stopTimer:null};
    waiter.timer=setTimeout(()=>{
      if(quizWaiters.delete(token)){clearInterval(waiter.stopTimer);resolve(null);}
    },180000);
    waiter.stopTimer=setInterval(()=>{
      if(stopped){
        if(quizWaiters.delete(token)){clearInterval(waiter.timer);clearInterval(waiter.stopTimer);resolve(null);}
      }
    },500);
    quizWaiters.set(token,waiter);
    emit('quiz',{token,questions});
  });
}

async function unansweredIndexes(frame){
  return frame.evaluate(()=>{
    const pick=sel=>[...document.querySelectorAll(sel)];
    let items=pick('div[id^="question"]');
    if(!items.length)items=pick('.questionLi, .TiMu');
    if(items.length>1)items=items.filter(el=>!items.some(o=>o!==el&&el.contains(o)));
    return items.map((el,i)=>{
      if(el.querySelector('input[type=radio]:checked,input[type=checkbox]:checked'))return -1;
      const marked=[...el.querySelectorAll('[class*="check"],[class*="Check"],[class*="selected"],[class*="cur"],.on, .active')]
        .find(m=>m.getClientRects().length&&m.closest('li,[class*="answerItem"],[class*="num_item"],ul'));
      if(marked)return -1;
      return i;
    }).filter(i=>i>=0);
  }).catch(()=>[]);
}

async function attemptSubmit(frame, page, emitMsg){
  // Returns 'success' | 'incomplete' | 'unknown'. Native dialogs are accepted globally during brush.
  const clicked=await frame.evaluate(()=>{
    const nodes=[...document.querySelectorAll('button, a, .btn, [class*="submit"], [class*="Submit"], div, span')];
    const btn=nodes.find(el=>{
      const t=(el.innerText||'').trim();
      if(t!=='提交'&&t!=='提交作业')return false;
      if(!el.getClientRects().length)return false;
      if(el.querySelector('button,a'))return false;
      const inModal=!!el.closest('[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="Modal"],[class*="layui-layer"],[role="dialog"]');
      return !inModal&&!el.closest('.questionLi, .TiMu, div[id^="question"]');
    });
    if(btn){const target=btn.closest('button,a,[onclick]')||btn;target.setAttribute('data-cx-submit','1');target.click();return true;}
    return false;
  }).catch(()=>false);
  brushTrace('submit_clicked',{frame:frame.url().slice(0,120),ok:clicked});
  if(!clicked){
    emitMsg('未找到提交按钮，请手动提交。');
    return 'unknown';
  }
  await delay(1500);
  // 在所有 frame 中轮询:提交成功 / "未做完"弹窗(取消) / 确认弹窗(点确认)。
  const MODAL_SEL='[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="Modal"],[class*="layui-layer"],[class*="popup"],[class*="Popup"],[class*="pop"],[role="dialog"]';
  for(let i=0;i<10;i++){
    for(const f of page.frames()){
      if(!allowed(f))continue;
      const state=await f.evaluate(sel=>{
        const body=document.body?.innerText||'';
        if(/提交成功|已提交|交卷成功/.test(body))return {kind:'success'};
        const modals=[...document.querySelectorAll(sel)].filter(m=>m.getClientRects().length&&(m.innerText||'').trim().length<400);
        const inModal=el=>!!el.closest(sel);
        const clickBtn=words=>modals.some(m=>[...m.querySelectorAll('button, a, .btn, div, span')].some(el=>{
          const t=(el.innerText||'').trim();
          if(words.includes(t)&&el.getClientRects().length&&!el.querySelector('button,a')&&!el.hasAttribute('data-cx-submit')){
            (el.closest('button,a,[onclick]')||el).click();return true;
          }
          return false;
        }));
        if(modals.some(m=>/未做完|未作答|未答完|还有未/.test(m.innerText||''))){
          return {kind:'incomplete',handled:clickBtn(['取消','关 闭','关闭','我知道了'])};
        }
        if(modals.length){
          return {kind:'confirm',handled:clickBtn(['提交','确定','确 定','确认提交'])};
        }
        return {kind:'none'};
      },MODAL_SEL).catch(()=>({kind:'error'}));
      if(state.kind==='success'){brushTrace('submit_done');emitMsg('测验已自动提交。');return 'success';}
      if(state.kind==='incomplete'){
        brushTrace('submit_incomplete',{canceled:state.handled});
        if(state.handled){
          emitMsg('检测到有题目未作答，已取消提交，准备补答…');
          return 'incomplete';
        }
        continue;
      }
      if(state.kind==='confirm'){
        brushTrace('submit_confirm',{clicked:state.handled,frame:f.url().slice(0,120)});
        if(state.handled){
          await delay(2000);
          break; // re-poll from first frame to observe success
        }
      }
    }
    await delay(700);
  }
  // 兜底:可能已提交但成功文案不在预期内,或弹窗结构未识别。
  // 成功判定放宽:出现成功文案,或提交按钮已消失/变成只读,或题目已进入已提交态,都算成功。
  const anySuccess=await Promise.all(page.frames().filter(allowed).map(f=>f.evaluate(()=>{
    const body=document.body?.innerText||'';
    if(/提交成功|已提交|交卷成功|恭喜|成绩|得分|重新作答|重新提交/.test(body))return true;
    // The submit button is gone or now reads a "done" state.
    const submit=[...document.querySelectorAll('button, a, .btn, [class*="submit"], [class*="Submit"]')];
    const submitVisible=submit.some(el=>el.getClientRects().length&&/提交/.test((el.innerText||'').trim()));
    const questions=document.querySelectorAll('div[id^="question"],.questionLi,.TiMu');
    const disabled=(document.body.classList.contains('submitted')||document.body.classList.contains('finished'))||
      (questions.length&&[...document.querySelectorAll('input[type=radio],input[type=checkbox]')].every(el=>el.disabled||el.readOnly));
    // No visible submit button left while questions were present => treated as submitted.
    return (questions.length>0&&!submitVisible)||disabled;
  }).catch(()=>false)));
  brushTrace('submit_unknown',{anySuccess});
  emitMsg(anySuccess.some(Boolean)?'测验已自动提交。':'提交结果未确认，请在保留的页面检查，必要时手动提交。');
  return anySuccess.some(Boolean)?'success':'unknown';
}

async function confirmLeaveDialog(page){
  // The "任务点未完成" modal must NOT be answered with 下一节 — that skips the quiz.
  // Return 'closed' (dismissed, staying on this section) or 'skip' (a real leave-confirm was
  // accepted) so the caller knows whether navigation actually happened.
  const SKIP_WORDS=['继续学习','继续','确定','确 定','是','知道了','我知道了','好的'];
  const CLOSE_WORDS=['取消','关 闭','关闭','取消提交','暂不','稍后','我知道了'];
  const SEL='[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="Modal"],[class*="Tips"],[class*="mask"],[class*="popup"],[role="dialog"],[class*="layui-layer"],[class*="confirm"]';
  for(const frame of page.frames()){
    if(!allowed(frame))continue;
    try{
      const r=await frame.evaluate(({SEL,SKIP_WORDS,CLOSE_WORDS})=>{
        const inModal=el=>!!el.closest(SEL);
        const modals=[...document.querySelectorAll(SEL)].filter(m=>m.getClientRects().length);
        const text=(modals.map(m=>m.innerText||'').join(' ')||document.body.innerText||'');
        const nodes=[...document.querySelectorAll('button, a, .btn, div, span')].filter(el=>el.getClientRects().length&&!el.querySelector('button,a'));
        const findBtn=words=>nodes.find(el=>{
          const t=(el.innerText||'').trim();
          return words.includes(t)&&(modals.length?inModal(el):true);
        });
        // Never click 下一节 in the incomplete modal — stay on this section.
        if(/未完成|未做完|未作答|未答完|还有.*未|任务点未/.test(text)){
          const closeBtn=findBtn(CLOSE_WORDS);
          if(closeBtn){(closeBtn.closest('button,a,[onclick]')||closeBtn).click();return 'closed';}
          // "去学习" stays on the current section and dismisses the popup — same effect as closing.
          const stayBtn=findBtn(['去学习']);
          if(stayBtn){(stayBtn.closest('button,a,[onclick]')||stayBtn).click();return 'closed';}
          // Fallback: the top-right X of the dialog (icon font, no text).
          const xBtn=nodes.find(el=>{
            if(!inModal(el))return false;
            const cls=(typeof el.className==='string'?el.className:'').toLowerCase();
            if(/close|el-icon-error/.test(cls))return true;
            const t=(el.innerText||el.textContent||'').trim();
            return (t==='×'||t==='✕'||t==='X'||t==='x')&&t.length<2;
          });
          if(xBtn){(xBtn.closest('button,a,[onclick]')||xBtn).click();return 'closed';}
          return 'stuck';
        }
        // Otherwise it is a leave-confirm dialog; accept it to proceed.
        const okBtn=findBtn(SKIP_WORDS);
        if(okBtn){(okBtn.closest('button,a,[onclick]')||okBtn).click();return 'skip';}
        return 'none';
      },{SEL,SKIP_WORDS,CLOSE_WORDS});
      if(r==='closed'||r==='skip')return r;
    }catch{}
  }
  return 'none';
}

// 暂停等待：刷课主循环每步前调用，paused 为真时阻塞直到恢复或停止。
// “知识扩展”类任务点：本节没有视频/文档/测验，只有一篇带蓝色超链接的扩展阅读页。
// 平台判定规则：点开任意一个蓝色链接再返回即算完成该任务点。
// 链接可能在新标签页打开（target=_blank，关闭新页即可），也可能在内容 iframe 内
// 跳转（记录原地址再导航回去）。返回 true 表示成功点过至少一个链接。
async function clickKnowledgeLink(page, emitMsg){
  for(const frame of page.frames()){
    if(!allowed(frame))continue;
    const frameUrl=frame.url();
    let handle=null;
    try{
      handle=await frame.evaluateHandle(()=>{
        const ok=a=>{
          const href=a.getAttribute('href')||'';
          if(!/^https?:/i.test(href))return false;
          const r=a.getBoundingClientRect();
          if(r.width<2||r.height<2)return false;
          // 知识扩展卡片内的链接（超星 insertlink 模块）直接命中
          if(a.closest('[class*="insertlink"],[class*="knowledge"],[class*="Knowledge"]'))return true;
          // 兜底：蓝色且带下划线的正文链接
          const st=getComputedStyle(a);
          const m=st.color&&st.color.match(/(\d+),\s*(\d+),\s*(\d+)/);
          const blue=m&&(+m[3]>150&&+m[3]-+m[1]>80&&+m[3]-+m[2]>80);
          const underline=/underline/.test(st.textDecorationLine||st.textDecoration||'');
          return !!(blue&&underline);
        };
        return [...document.querySelectorAll('a')].find(ok)||null;
      });
      const el=handle.asElement();
      if(!el)continue;
      const title=await el.evaluate(a=>(a.textContent||'').trim().slice(0,40)).catch(()=>'');
      emitMsg(`本节为知识扩展类任务点，点击链接“${title||'扩展阅读'}”后返回…`);
      const popupPromise=page.context().waitForEvent('page',{timeout:6000}).catch(()=>null);
      await el.click({timeout:5000});
      const popup=await popupPromise;
      if(popup){
        // 新标签页打开：停留片刻让平台记录阅读行为，然后关掉新页
        await delay(2500);
        await popup.close().catch(()=>{});
        emitMsg('已点开链接并关闭，任务点已处理，继续下一节。');
      }else{
        // 可能在当前 iframe 内跳转：若地址变了，导航回原页面
        await delay(2500);
        const now=frame.url();
        if(now&&frameUrl&&now!==frameUrl&&!stopped){
          await frame.goto(frameUrl,{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});
          emitMsg('已点开链接并返回本节，任务点已处理，继续下一节。');
        }else{
          emitMsg('已点击扩展链接，任务点已处理，继续下一节。');
        }
      }
      await delay(1000);
      return true;
    }catch(err){
      brushTrace('knowledge_link_fail',{frame:frameUrl.slice(0,120),error:String(err).slice(0,120)});
    }finally{
      await handle.dispose().catch(()=>{});
    }
  }
  return false;
}

async function waitWhilePaused(){
  while(paused&&!stopped)await delay(250);
}

// 手动切换检测：主循环为当前节记录指纹，长等待中指纹变化即视为用户手动切换了章节。
let watchFP=null;
let pendingManualCommand=null;
const MANUAL_COMMANDS=['auto','video','document','quiz'];
async function navChanged(page){
  if(pendingManualCommand)return true;
  if(!watchFP)return false;
  try{return await sectionFingerprint(page)!==watchFP;}catch{return false;}
}

// 注入课程页面右上角的悬浮状态条(HUD)。显示当前动作 + 「暂停/继续」「停止」按钮。
// 按钮点击通过 window.__cxHud 回传标志，由主循环的 waitWhilePaused 消费。
function hudInitScript(platform='chaoxing'){
  // 只在顶层课程文档挂载，避免在每个 iframe 里重复生成。
  try{if(window.top!==window&&window.parent!==window)return;}catch{return;}
  const id='cx-hud';
  if(document.getElementById(id))return;
  const hud=document.createElement('div');
  hud.id=id;
  Object.assign(hud.style,{
    position:'fixed',top:'16px',right:'16px',zIndex:'2147483647',
    display:'flex',flexDirection:'column',alignItems:'stretch',gap:'12px',
    padding:'10px 14px',borderRadius:'10px',
    background:'rgba(20,149,143,0.94)',color:'#fff',
    font:'13px/1.5 -apple-system,"Microsoft YaHei",sans-serif',
    boxShadow:'0 4px 16px rgba(0,0,0,0.25)',width:'380px',maxWidth:'calc(100vw - 60px)',boxSizing:'border-box'
  });
  const dot=document.createElement('span');
  dot.textContent='●';
  dot.style.cssText='color:#d7fff5;animation:cxPulse 1s infinite';
  const style=document.createElement('style');
  style.textContent='@keyframes cxPulse{0%,100%{opacity:1}50%{opacity:.35}}';
  document.head.appendChild(style);
  const text=document.createElement('span');
  text.id='cx-hud-text';
  text.textContent='正在初始化…';
  text.style.cssText='white-space:normal;overflow-wrap:anywhere;flex:1;min-width:0;line-height:1.6';
  const btnPause=document.createElement('button');
  btnPause.textContent='暂停';
  btnPause.id='cx-hud-pause';
  const btnStop=document.createElement('button');
  btnStop.id='cx-hud-stop';
  btnStop.textContent='停止';
  const btnCss='border:1px solid transparent;border-radius:6px;padding:7px 10px;min-height:36px;cursor:pointer;font:inherit;color:#106b66;background:#fff;';
  btnPause.style.cssText=btnCss;
  btnStop.style.cssText=btnCss+'background:#ff6b6b;color:#fff;';
  btnPause.onclick=()=>{window.__cxHud={...window.__cxHud,pause:btnPause.textContent==='暂停'};};
  const command=document.createElement('select');
  command.id='cx-hud-command';
  command.setAttribute('aria-label','手动指令');
  command.style.cssText=btnCss;
  const entries=platform==='yuketang'?[['video','刷视频'],['quiz','做习题'],['exam','考试（预留）'],['auto','恢复自动刷课']]:[['video','刷视频'],['document','浏览 PPT / 文档'],['quiz','做题'],['auto','恢复自动刷课']];
  for(const [value,label] of entries){
    const option=document.createElement('option');option.value=value;option.textContent=label;command.appendChild(option);
    if(platform==='yuketang'&&value==='exam')option.disabled=true;
  }
  const run=document.createElement('button');
  run.id='cx-hud-run';run.textContent='执行指令';run.style.cssText=btnCss;
  run.onclick=()=>{
    window.__cxHud={command:command.value};
    text.textContent='指令已发送，正在切换任务…';
  };
  const resume=document.createElement('button');
  resume.id='cx-hud-auto';resume.textContent='恢复自动刷课';resume.style.cssText=btnCss+'font-weight:600;';
  resume.onclick=()=>{
    window.__cxHud={command:'auto'};
    text.textContent='正在恢复自动刷课…';
  };
  btnStop.onclick=()=>{window.__cxHud={stop:true};};
  const status=document.createElement('div');
  status.style.cssText='display:flex;align-items:baseline;gap:8px';
  status.append(dot,text);
  const commands=document.createElement('div');
  commands.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
  command.style.flex='1';command.style.minWidth='130px';
  commands.append(command,run);
  const controls=document.createElement('div');
  controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
  resume.style.flex='1';
  controls.append(resume,btnPause,btnStop);
  hud.append(status,commands,controls);
  const mount=()=>{
    if(document.getElementById(id))return;
    if(document.body)document.body.appendChild(hud);
    else document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(hud),{once:true});
  };
  mount();
}

// 把一条状态消息同步到 HUD 文本；由 emitMsg 包装调用。
async function hudUpdate(page, message){
  try{
    for(const frame of page.frames()){
      if(!frame.url()||frame.url()==='about:blank')continue;
      const ok=await frame.evaluate(msg=>{
        const t=document.getElementById('cx-hud-text');
        if(!t)return false;
        t.textContent=msg;t.title=msg;return true;
      },String(message)).catch(()=>false);
      if(ok)return;
    }
  }catch{}
}

async function brushOne(context, url, emitMsg, playbackSpeed='auto', taskOptions={}){
  const materials=taskOptions.materials!==false, quizzes=taskOptions.quiz!==false;
  brushTrace('start',{revision:'stable',worker:__filename});
  const page=await taskPage(context);
  let keepOpen=false, hudGuard=null, hudAlive=true, hudMessage='打开课程…';
  try{
    // Auto-accept every native alert/confirm during brushing so "任务点未完成" dialogs never block navigation.
    const nativeDialogHandler=d=>{d.accept().catch(()=>{});};
    page.on('dialog',nativeDialogHandler);
    // Covers live/video/audio elements created later in any nested task frame.
    await page.addInitScript(defaultMuteMedia);
    await page.addInitScript(hudInitScript);
    // Eagerly mount the HUD into the current/next document too: addInitScript only
    // covers documents created after registration, and section loads replace frames.
    let hudMounted=false;
    const mountHud=async()=>{
      try{
        await page.evaluate(hudInitScript);
        await hudUpdate(page,hudMessage);
        if(!hudMounted){hudMounted=true;brushTrace('hud_mounted',{url:page.url().slice(0,120)});}
      }catch{}
    };
    if(!process.env.CX_NO_HUD_MOUNT){
      page.on('load',mountHud);
      page.on('domcontentloaded',mountHud);
      page.on('framenavigated',frame=>{if(frame===page.mainFrame())mountHud();});
      // Keep it alive if the page's own scripts wipe the body.
      hudGuard=setInterval(()=>{if(hudAlive&&!stopped&&!page.isClosed())mountHud();},5000);
    }
    // Wrap emitMsg so every status line also lands on the in-browser HUD.
    const _emit=emitMsg;
    emitMsg=m=>{hudMessage=m;_emit(m);hudUpdate(page,m);};
    // Background loop: poll the HUD buttons, mirror pause/stop into worker flags.
    let hudBusy=false;
    const hudPoll=async()=>{
      while(hudAlive&&!stopped&&!page.isClosed()){
        if(hudBusy){await delay(250);continue;}
        hudBusy=true;
        try{
          for(const frame of page.frames()){
            if(!frame.url()||frame.url()==='about:blank')continue;
            const sig=await frame.evaluate(()=>{
              const h=window.__cxHud;if(!h)return null;
              const pauseBtn=document.getElementById('cx-hud-pause');
              if(pauseBtn&&h.pause!==undefined)pauseBtn.textContent=h.pause?'继续':'暂停';
              window.__cxHud=null;
              return {pause:h.pause,stop:h.stop,command:h.command};
            }).catch(()=>null);
            if(sig){
              if(sig.stop!==undefined&&sig.stop){stopTask();break;}
              if(MANUAL_COMMANDS.includes(sig.command)){
                pendingManualCommand=sig.command;paused=false;
                await frame.evaluate(()=>{const b=document.getElementById('cx-hud-pause');if(b)b.textContent='暂停';}).catch(()=>{});
                emitMsg('收到手动指令，正在切换任务…');
              }
              if(sig.pause!==undefined){paused=sig.pause;emitMsg(paused?'已暂停，点击「继续」恢复。':'已继续。');}
            }
          }
        }finally{hudBusy=false;}
        await delay(250);
      }
    };
    if(!process.env.CX_NO_HUD_POLL)hudPoll();
    emitMsg('打开课程…');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
    if(page.url()==='about:blank'){
      await page.goto(url,{waitUntil:'load',timeout:60000}).catch(()=>{});
      if(page.url()==='about:blank')return '课程页面打开失败，请检查网络后重试。';
    }
    if(await needsLogin(page)){
      if(!credentials)return '未登录：请先在“平台账号”页保存超星账号，或在浏览器中手动登录后再刷课。';
      emitMsg('检测到未登录，正在使用已保存的账号自动登录…');
      const login=await autoLogin(context,credentials);
      if(!login.ok)return login.message;
      emitMsg('自动登录成功，重新打开课程…');
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
      if(await needsLogin(page))return '自动登录后仍无法进入课程，请在浏览器中手动登录后重试。';
    }
    // Chapter-detail pages have no chapter tab. Avoid Playwright's full
    // auto-wait for a control that does not exist there.
    try{
      const chapterTab=page.getByText('章节',{exact:true}).first();
      if(await chapterTab.count())await chapterTab.click({timeout:1000});
    }catch{}
    emitMsg('读取章节内容…');
    if(!await enterChapter(page,emitMsg)){
      keepOpen=!stopped;
      return stopped?'已停止播放。':'未能识别可进入的章节，课程页面已保留，请打开具体任务点后重试。';
    }
    let state=await waitForSection(page);
    brushTrace('section_ready',state);
    let total=0, documents=0, liveSkipped=0, quizAnswered=0, section=0, unresolved=false;
    const handledQuiz=new Set();
    const retriedSections=new Set();
    const attemptedTasks=new Set();
    let currentKey=null;
    let taskMode='auto', manualIdle=false;
    for(section=0;section<200&&!stopped;section++){
      while(manualIdle&&!pendingManualCommand&&!stopped&&!page.isClosed())await delay(250);
      if(page.isClosed())break;
      await waitWhilePaused();
      if(stopped)break;
      if(pendingManualCommand){
        taskMode=pendingManualCommand;pendingManualCommand=null;manualIdle=false;
        state=await waitForSection(page);handledQuiz.clear();
        emitMsg(`执行指令：${{auto:'自动刷课',video:'刷视频',document:'浏览 PPT / 文档',quiz:'做题'}[taskMode]}`);
      }
      // 为本节记录指纹：长等待中指纹变化 = 用户手动切换了章节。
      watchFP=await sectionFingerprint(page);
      if((taskMode==='auto'&&materials||taskMode==='video')&&state.expectedVideo&&!state.video)throw new Error('video playback not loaded');
      if(state.live&&!state.video&&(taskMode==='auto'&&materials||taskMode==='video')){
        const played=await playLiveEntry(page,section,emitMsg,playbackSpeed);
        total+=played;
        if(!played){
          liveSkipped++;
          emitMsg('本节直播无法播放，保留未完成状态，继续下一节。');
        }
        state=await waitForSection(page);
        watchFP=await sectionFingerprint(page);
      }else if(state.livePending){
        liveSkipped++;
        emitMsg('本节直播未开始或已结束，保留未完成状态，继续下一节。');
      }else if(state.live&&!state.video){
        unresolved=true;
        emitMsg('本节直播暂未发现可播放内容，保留未完成状态，继续下一节。');
      }
      let manualSwitch=false;
      try{
        if(taskMode==='auto'&&materials||taskMode==='video')total+=await playVideos(page, section, emitMsg, playbackSpeed);
        if(pendingManualCommand)continue;
        watchFP=await sectionFingerprint(page).catch(()=>watchFP);
        emitMsg('检查本节任务…');
        if(taskMode==='auto'&&materials||taskMode==='document')documents+=await scrollDocuments(page,emitMsg);
        if(pendingManualCommand)continue;
        watchFP=await sectionFingerprint(page).catch(()=>watchFP);
      }catch(err){
        if(!/manual section change/.test(err.message))throw err;
        manualSwitch=true;
      }
      if(!manualSwitch&&(taskMode==='quiz'||taskMode==='auto'&&quizzes&&!state.video&&!state.document&&!state.live)){
        if(state.quiz){
          const fp=await sectionFingerprint(page);
          if(!handledQuiz.has(fp)){
            handledQuiz.add(fp);
            // 批阅页（上次答过、有待提高分数）：直接走题库重做冲满分。
            if(await quizReviewMode(page)){
              const ok=await redoForFullScore(page,emitMsg);
              watchFP=await sectionFingerprint(page).catch(()=>watchFP);
              if(ok){
                emitMsg('本节已通过重做拿到满分，继续下一节。');
                state=await waitForSection(page);
              }else{
                unresolved=true;
                keepOpen=true;
                emitMsg('批阅页重做未完成。可执行「做题」重试，或点击「恢复自动刷课」。');
                manualIdle=true;section--;continue;
              }
            }else{
              const done=await tryAnswerQuiz(page,emitMsg);
              // done>0 means the quiz was answered AND its submission was confirmed
              // successful. On failure the section is NOT advanced — clicking 下一节
              // here would trigger the "任务点未完成" interception popup.
              if(done>0){
                quizAnswered+=done;
                // 答题提交后页面变为批阅页：刷新基准指纹，避免被误判为手动切换。
                watchFP=await sectionFingerprint(page).catch(()=>watchFP);
              }else{
                unresolved=true;
                keepOpen=true;
                emitMsg('本节测验未完成。可执行「做题」重试，或点击「恢复自动刷课」。');
                manualIdle=true;section--;continue;
              }
            }
          }else{
            emitMsg('本节测验已处理过，尝试进入下一节。');
          }
        }else if(taskMode==='auto'&&materials){
          // 无视频/文档/测验：先尝试知识扩展类任务点（点链接即完成），
          // 点不到链接才视为未识别内容。
          const linked=await clickKnowledgeLink(page,emitMsg);
          if(linked){
            // 点击/返回后刷新基准指纹，避免被误判为手动切换章节。
            watchFP=await sectionFingerprint(page).catch(()=>watchFP);
          }else{
            unresolved=true;
            emitMsg('本节未识别到视频或文档，继续查找下一节，未确认任务点完成。');
          }
        }
      }
      if(taskMode==='auto'&&materials&&!quizzes&&!state.video&&!state.document&&!state.live&&!state.quiz){
        await clickKnowledgeLink(page,emitMsg);
        watchFP=await sectionFingerprint(page).catch(()=>watchFP);
      }
      if(pendingManualCommand){section--;continue;}
      if(taskMode!=='auto'){
        manualIdle=true;
        const found=taskMode==='video'?state.video:taskMode==='document'?state.document:state.quiz;
        emitMsg(manualSwitch?'页面已切换，请重新下达指令。':!found?'当前章节未识别到所选任务，请打开对应任务点后重新执行。':'本次指令处理结束，停留当前章节，等待下一条指令。');
        section--;continue;
      }
      // 手动切换检测：页面指纹与节开始（或最近一次脚本自身操作）时不同
      // （用户点了目录里别的节）→ 放弃本节的下一节导航，重新识别新页面。
      if(manualSwitch||await navChanged(page)){
        watchFP=null;
        emitMsg('检测到手动切换章节，按新页面继续处理…');
        brushTrace('manual_nav',{});
        state=await waitForSection(page);
        handledQuiz.clear();
        continue;
      }
      // 导航策略：刷新页面后直接跳目录里第一个橙色未完成任务点（跳过已完成
      // 与空节）；目录没有可跳的才回退到「下一节」顺序推进。
      if(currentKey)attemptedTasks.add(currentKey);
      const jumped=await gotoFirstPending(page,emitMsg,attemptedTasks,k=>{currentKey=k;});
      if(!jumped){
        const next=await findNext(page);
        if(!next)break;
        emitMsg(`准备进入第 ${section+2} 节，任务点完成情况需重新检查…`);
        const before=await sectionFingerprint(page);
        try{await next.click({timeout:5000});}catch{break;}
        if(!await waitForSectionChange(page,before)){
          // A "任务点未完成" modal blocks navigation. Do NOT skip: dismiss it and stay,
          // so the quiz/submission can still be handled instead of silently losing it.
          const leave=await confirmLeaveDialog(page);
          if(leave==='skip'&&await waitForSectionChange(page,before,15000)){
            emitMsg('本节为确认离开提示，已确认进入下一节。');
          }else if(leave==='closed'&&!retriedSections.has(section)){
            // Popup dismissed but we stayed on this section: re-handle it once
            // (finish the quiz / submission) instead of giving up immediately.
            retriedSections.add(section);
            emitMsg('已关闭“任务点未完成”弹窗，留在本节继续处理…');
            state=await waitForSection(page);
            section--; // redo this section in the next loop iteration
            continue;
          }else{
            unresolved=true;
            emitMsg('本节任务点未全部完成，已停止前进并保留页面，请先完成或提交本节任务。');
            break;
          }
        }
      }
      state=await waitForSection(page);
      brushTrace('section_ready',state);
    }
    if((!total&&!documents||unresolved||liveSkipped||quizAnswered)&&!stopped)keepOpen=true;
    if(stopped)return `已停止刷课：处理到第 ${section+1} 节，共播放 ${total} 个视频。`;
    return `本轮播放 ${total} 个视频，浏览到底 ${documents} 份文档${liveSkipped?`，跳过 ${liveSkipped} 个无法播放的直播`:''}${quizAnswered?`，AI 已作答并提交 ${quizAnswered} 道测验题`:''}。${keepOpen?'课程页面已保留。':''}请重新检查平台任务点；未播放的直播和未成功提交的测验需另行确认。`;
  }catch(err){
    brushTrace('brush_error',{message:String(err.message).replace(/https?:\/\/[^\s]+/g,'[url]')});
    keepOpen=!stopped;
    if(stopped)return '已停止播放。';
    if(err.message==='document viewer not loaded')return '文档查看器未加载出内容，已暂停并保留课程页面，请检查网络或文档是否可打开。';
    if(/document scroll/.test(err.message))return '课件内部未能正常滚动到底，已暂停并保留页面，请检查课件区域的滚动条。';
    if(/video playback/.test(err.message))return '视频未正常播放完毕，已暂停并保留课程页面，请检查加载或验证提示。';
    return '播放过程出错，课程页面已保留，请检查网络或页面结构。';
  }finally{
    // 先优雅停掉 HUD 循环并等 in-flight 的 evaluate 落地，
    // 否则关闭浏览器时可能被未完成的协议调用卡住。
    hudAlive=false;
    await page.evaluate(()=>{
      const hud=document.getElementById('cx-hud');
      if(!hud)return;
      hud.querySelectorAll('button,select').forEach(control=>{control.disabled=true;control.style.opacity='.55';control.style.cursor='default';});
      const text=document.getElementById('cx-hud-text');
      if(text)text.textContent+=' 任务已结束，请在课程助手中重新启动刷课。';
    }).catch(()=>{});
    pendingManualCommand=null;
    if(hudGuard)clearInterval(hudGuard);
    await delay(300);
    if(!keepOpen)await page.close().catch(()=>{});
  }
}

async function manualLogin(context, {platform='chaoxing', stopped:cancelled=()=>stopped,
    newPage=()=>taskPage(context), timeout=300000, wait=delay, progress=()=>{}}={}){
  let page;
  try{
    page=await newPage();
    await page.bringToFront();
    if(context.newCDPSession){
      const session=await context.newCDPSession(page);
      try{
        const {windowId}=await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
      }finally{await session.detach();}
    }
    progress('登录窗口已打开，正在加载登录页…');
    try{
      await page.goto(platform==='mooc'?'https://www.icourse163.org/':'https://passport2.chaoxing.com/login',
        {waitUntil:'domcontentloaded',timeout:45000});
    }catch(error){
      // The login service may replace its initial navigation during redirects.
      if(!String(error.message).includes('net::ERR_ABORTED') || page.isClosed())throw error;
    }
    await page.bringToFront();
    progress('请在浏览器中自行登录，完成后会自动保存登录状态。');
    const deadline=Date.now()+timeout;
    while(!cancelled() && !page.isClosed() && Date.now()<deadline){
      for(const candidate of context.pages()){
        try{
          if(platform==='mooc'){
            if(await moocAuthenticated(candidate))return {status:'success'};
            if(/^https:\/\/([\w-]+\.)?icourse163\.org\//.test(candidate.url())){
              for(const frame of candidate.frames()){
                const remember=frame.getByRole('checkbox',{name:/十天内免登录/}).first();
                if(await remember.count())await remember.check({timeout:1000}).catch(()=>{});
              }
            }
          }else{
            const url=new URL(candidate.url());
            if(url.protocol==='https:' && ['i.chaoxing.com','i.mooc.chaoxing.com'].includes(url.hostname)
                && !await needsLogin(candidate)
                && (await context.cookies('https://i.chaoxing.com/')).some(c=>c.name==='_uid' && /^[1-9]\d*$/.test(c.value))){
              return {status:'success'};
            }
            if(url.protocol==='https:' && url.hostname==='passport2.chaoxing.com'){
              await enableRememberLogin(candidate).catch(()=>{});
            }
          }
        }catch{} // A redirect can replace the execution context during this check.
      }
      await wait(750);
    }
    return {status:cancelled()||page.isClosed()?'cancelled':'not_logged_in'};
  }catch(error){
    const code=String(error.message||'').match(/net::ERR_[A-Z_]+/)?.[0];
    return {status:cancelled()||page?.isClosed()?'cancelled':'error',reason:'open_page',
      ...(code?{error_code:code}:{})};
  }
  // Keep the user's login page and the persistent browser profile intact.
}

module.exports={hudInitScript,defaultMuteMedia,brushOne,chapterCandidates,sectionState,scrollDocuments,waitForSectionChange,sectionFingerprint,enterChapter,findNext,waitForVideo,parseProgress,openCourse,enableRememberLogin,classifyLoginError,hasCaptcha,loginAccount,manualLogin,backgroundContext,platformSession,setPlaybackSpeed,links,openLearningCourses,__fontTest:{parseTtfGlyphHashes,parseTtfCmap}};
module.exports.hudUpdate=hudUpdate;

if(require.main===module){
readline.createInterface({input:process.stdin}).on('line', line=>{
    const text=line.trim();
    if(!text)return;
    if(text==='stop'||text==='"stop"'){stopTask();return;}
    try{
      const parsed=JSON.parse(text);
      if(parsed?.type==='session_bootstrap'){
        savedSession=parsed.state;
        bootstrapReady=true;
      }
      if(parsed?.type==='quiz_answers'&&parsed.token){
        const waiter=quizWaiters.get(parsed.token);
        if(waiter){
          quizWaiters.delete(parsed.token);
          clearTimeout(waiter.timer);
          clearInterval(waiter.stopTimer);
          waiter.resolve(parsed);
        }
      }
      if(parsed&&typeof parsed.username==='string'&&typeof parsed.password==='string')credentials=parsed;
    }catch{}
});
(async()=>{
  let browser, hidden;
  try{
    let context;
    if(['scan','visits','login','login_status','mooc_login','mooc_login_status','mooc_scan','yuketang_scan','yuketang_login_status'].includes(process.argv[3])){
      emit('progress',{message:'正在后台检查课程，浏览器不会弹出…'});
      hidden=await backgroundContext(process.argv[2],process.argv[3].startsWith('yuketang_')?'yuketang':process.argv[3].startsWith('mooc_')?'mooc':'chaoxing');
      context=hidden;
    }else{
      browser=await chromium.connectOverCDP(process.argv[2]);
      context=browser.contexts()[0];
    }
    if(stopped){
      emit('done',{message:'任务已停止。'});
    }else if(process.argv[3]==='close'){
      const session=await browser.newBrowserCDPSession();
      await session.send('Browser.close');
    }else if(process.argv[3]==='yuketang_brush'){
      const options=process.argv[6]?JSON.parse(process.argv[6]):{};
      const speed=process.argv[5]==='auto'?'auto':Number(process.argv[5]);
      emit('done',{message:await brushYuketang(context,process.argv[4],{
        options,speed,stopped:()=>stopped,newPage:()=>taskPage(context),trackPage,
        hudInitScript,hudUpdate,requestAnswers,emitMsg:message=>emit('progress',{message})
      })});
    }else if(process.argv[3]==='yuketang_scan'){
      emit('done',{message:await scanYuketang(context,{stopped:()=>stopped,emit,newPage:()=>taskPage(context)})});
    }else if(['yuketang_login','yuketang_login_visible','yuketang_login_status','yuketang_login_manual'].includes(process.argv[3])){
      const action=process.argv[3];
      if(action==='yuketang_login'||action==='yuketang_login_visible')for(let i=0;i<40&&!credentials&&!stopped;i++)await delay(50);
      const result=await loginYuketang(context,credentials,{checkOnly:action==='yuketang_login_status',manual:action==='yuketang_login_manual',stopped:()=>stopped,newPage:()=>taskPage(context),progress:message=>emit('progress',{message})});
      if(result.status==='success')emit('session_state',{state:platformSession(await context.storageState(),'yuketang')});
      emit('login_result',result);
      emit('done',{message:result.status==='success'?'长江雨课堂登录成功。':'长江雨课堂登录未完成，请检查登录网页。'});
    }else if(['login_manual','mooc_login_manual'].includes(process.argv[3])){
      const platform=process.argv[3].startsWith('mooc_')?'mooc':'chaoxing';
      const result=await manualLogin(context,{platform,progress:message=>emit('progress',{message})});
      if(result.status==='success')emit('session_state',{state:platformSession(await context.storageState(),platform)});
      emit('login_result',result);
      emit('done',{message:result.status==='success'?'网页登录成功，登录状态已保留。':'网页登录未完成。'});
    }else if(['mooc_login','mooc_login_visible','mooc_login_status'].includes(process.argv[3])){
      for(let i=0;i<40&&!credentials&&process.argv[3]!=='mooc_login_status'&&!stopped;i++)await delay(50);
      const result=await loginMooc(context,credentials,{checkOnly:process.argv[3]==='mooc_login_status',visible:process.argv[3]==='mooc_login_visible',stopped:()=>stopped,newPage:()=>taskPage(context)});
      emit('login_result',result);
      emit('done',{message:result.status==='success'?'MOOC 登录成功。':result.status==='captcha'?'需要验证码，请在网页完成验证。':'MOOC 登录未完成，请重试。'});
    }else if(['login','login_visible','login_status'].includes(process.argv[3])){
      for(let i=0;i<40&&!credentials&&process.argv[3]!=='login_status'&&!stopped;i++)await delay(50);
      const result=await loginAccount(context,credentials,{checkOnly:process.argv[3]==='login_status',visible:process.argv[3]==='login_visible'});
      emit('login_result',result);
      emit('done',{message:result.status==='success'?'登录成功。':result.status==='captcha'?'需要验证码，请在网页完成验证。':result.status==='invalid_credentials'?'账号或密码错误，请重新登录。':'登录未完成，请重试。'});
    }else if(process.argv[3]==='mooc_scan'){
      for(let i=0;i<40&&!credentials&&!stopped;i++)await delay(50);
      try{
        emit('done',{message:await scanMooc(context,{stopped:()=>stopped,newPage:()=>taskPage(context),emit,credentials})});
      }catch(error){
        emit('done',{message:stopped?'任务已停止，已保存记录保留。':error.message});
      }
    }else if(process.argv[3]==='open'){
      emit('done',{message:await openCourse(context,process.argv[4],credentials)});
    }else if(process.argv[3]==='visits'){
      emit('done',{message:await visitOne(context,process.argv[4])});
    }else if(process.argv[3]==='brush'){
      const requested=process.argv[5]&&process.argv[5]!=='auto'?Number(process.argv[5]):'auto';
      const speed=requested==='auto'||PLAYBACK_SPEEDS.includes(requested)?requested:1;
      let taskOptions={};
      if(process.argv[6]){taskOptions=JSON.parse(process.argv[6]);if(!taskOptions||typeof taskOptions!=='object')throw new Error('invalid task options');}
      const message=await brushOne(context,process.argv[4],m=>emit('progress',{message:m}),speed,taskOptions);
      emit('done',{message});
    }else{
      const message=await scan(context);
      emit('done',{message});
    }
  }catch(err){
    if(['login_manual','mooc_login_manual'].includes(process.argv[3])){
      emit('login_result',{status:stopped?'cancelled':'error',reason:'browser_connect',
        error_code:/has been closed|Target closed|Browser closed/i.test(String(err.message))?'browser_closed':'browser_connect_failed'});
    }
    emit('done',{message:stopped?'任务已停止，已保存记录保留。':'浏览器连接或页面读取失败，请确认网络和登录状态后重试。旧记录已保留。'});
    if(!stopped)process.exitCode=1;
  }finally{
    if(hidden){
      if(hidden.syncVisibleSession)await hidden.syncVisibleSession().catch(()=>{});
      await hidden.close().catch(()=>{});
    }
    if(browser)await browser.close().catch(()=>{});
    process.stdin.destroy();
  }
})();
}
