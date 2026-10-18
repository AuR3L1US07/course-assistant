// Read only the platform's published outline and submission records.
// Never open a video/document, start an attempt, or submit coursework.
const {authenticated, loginMooc, trusted} = require('./mooc_login.cjs');
const HOME = 'https://www.icourse163.org/';
const categories = ['courseware', 'discussion', 'quiz', 'homework'];
const unknown = error => Object.fromEntries(categories.map(k => [k, {required:null, done:null, error}]));

function learningURL(value, base = HOME) {
  const u = new URL(value, base);
  if (!trusted(u.href) || !['www.icourse163.org', 'icourse163.org'].includes(u.hostname) ||
      !/^\/(?:spoc\/)?learn\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) throw Error('课程链接无效');
  u.hash = '/learn/content';
  return u.href;
}

// These functions run in the page and read DOM only; no application internals.
function catalogDOM() {
  const root = document.querySelector('#j-coursewrap');
  return [...(root?.querySelectorAll('.course-card-wrapper') || [])].map(card => ({
    name: card.querySelector('.title')?.textContent.trim(),
    url: card.querySelector('.score a[href]')?.getAttribute('href'),
    availability: card.querySelector('.course-status')?.textContent.trim() || '',
  }));
}

function outlineDOM() {
  const root = document.querySelector('#courseLearn-inner-box');
  const visible = el => Boolean(el && el.getClientRects().length);
  const chapters = [...(root?.querySelectorAll('.m-learnChapterNormal') || [])];
  return {
    chapters: chapters.length,
    collapsed: chapters.map((e,i) => visible(e.querySelector('.j-up')) ? i : -1).filter(i => i >= 0),
    empty: [...(root?.querySelectorAll('.j-empty') || [])].some(e => visible(e) && /还没有发布.*学习内容/.test(e.textContent)),
    items: [...(root?.querySelectorAll('.sourceList .lsicon') || [])].map(e => ({
      id:e.getAttribute('data-cid'), kind:e.querySelector('.tag')?.textContent.trim(),
      done:e.classList.contains('learned') || Boolean(e.querySelector('.tag.learned')),
    })),
  };
}

function outlineMetrics(items) {
  const unique = new Map();
  for (const item of items) {
    if (!['视频','文档','讨论'].includes(item.kind)) continue;
    if (!item.id) throw Error('课件缺少项目编号');
    const old = unique.get(item.id);
    if (old && (old.kind !== item.kind || old.done !== item.done)) throw Error('课件完成标记不一致');
    unique.set(item.id, item);
  }
  const count = kinds => {
    const list = [...unique.values()].filter(i => kinds.includes(i.kind));
    return {required:list.length, done:list.filter(i => i.done === true).length};
  };
  return {
    courseware:{...count(['视频','文档']), videos:count(['视频']), documents:count(['文档'])},
    discussion:count(['讨论']),
  };
}

function assessmentsDOM() {
  const root = document.querySelector('#courseLearn-inner-box');
  return {
    empty:[...(root?.querySelectorAll('.j-empty') || [])].some(e => e.getClientRects().length && /还没有发布.*(测试|测验).*作业/.test(e.textContent)),
    items:[...(root?.querySelectorAll('.u-quizHwListItem') || [])].map((e,index) => ({
      index, name:e.querySelector('.j-name')?.textContent.trim(),
      kind:/作业/.test(e.querySelector('.j-quizBtn')?.textContent || '') ? 'homework' :
           /测验/.test(e.querySelector('.j-quizBtn')?.textContent || '') ? 'quiz' : null,
      submissions:e.querySelector('.j-submitCount')?.textContent.trim() || '',
    })),
  };
}

function submitted(count) {
  const match = /^\s*(\d+)\s*\/\s*\d+\s*$/.exec(count || '');
  return match ? Number(match[1]) > 0 : null;
}

function assessmentMetric(items) {
  return {required:items.length,
    done:items.some(i => i.done === null) ? null : items.filter(i => i.done === true).length,
    error:items.some(i => i.done === null) ? '部分提交状态未识别，请打开课程核对。' : ''};
}

function homeworkStatusDOM() {
  const root=document.querySelector('#courseLearn-inner-box');
  if (!root) return {done:null};
  const visible=el=>Boolean(el && el.getClientRects().length);
  // Status banners can contain nested spans, whitespace and duplicate hidden
  // templates. Read visible banners instead of a strict global text locator.
  const banners=[...root.querySelectorAll('.j-aftersubmit, .cxinfo')].filter(visible);
  const text=banners.map(el=>el.textContent.replace(/\s+/g,'')).join('\n');
  let done=/作业已(?:完成并)?提交|已提交作业/.test(text) ? true :
           /作业(?:尚)?未提交|未提交作业/.test(text) ? false : null;
  const reviews={};
  for (const tab of root.querySelectorAll('.jdtab')) {
    if (!visible(tab)) continue;
    const label=tab.querySelector('span')?.textContent.replace(/\s+/g,'') || '';
    const status=tab.querySelector('.j-status');
    const checked=status?.classList.contains('done') ? true :
                  status?.classList.contains('undone') ? false : null;
    if (/^完成并提交/.test(label) && checked!==null) done=done ?? checked;
    if (/^互评(作业|任务)$/.test(label)) reviews.peer=checked;
    if (/^自评(作业|任务)$/.test(label)) reviews.self=checked;
  }
  return {done,reviews};
}

function homeworkReviews(items) {
  const metrics={};
  for (const phase of ['peer','self']) {
    const offered=items.filter(item=>item.reviews && Object.hasOwn(item.reviews,phase));
    if (!offered.length) continue;
    const unknown=items.some(item=>item.reviews===undefined);
    metrics[phase]={required:unknown?null:offered.length,
      done:unknown||offered.some(item=>item.reviews[phase]===null)?null:offered.filter(item=>item.reviews[phase]===true).length};
  }
  return metrics;
}

// Bound browser load, stop scheduling on cancellation/failure, and always drain
// active readers before their shared context can be closed.
async function scanConcurrently(items, read, stopped = () => false, limit = 3) {
  let cursor = 0, failure;
  async function worker() {
    while (!stopped() && !failure) {
      const index = cursor++;
      if (index >= items.length) return;
      try { await read(items[index], index); }
      catch (error) { failure = failure || error; }
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, worker));
  if (failure) throw failure;
  if (stopped()) throw Error('stopped');
}

async function scanMooc(context, options = {}) {
  const {stopped = () => false, newPage = () => context.newPage(), emit = () => {}, credentials} = options;
  const check = () => { if (stopped()) throw Error('stopped'); };
  const poll = async (page, read, ready, message) => {
    for (let i=0;i<60;i++) {
      check();
      if (!trusted(page.url())) throw Error('页面已离开 MOOC');
      const result = await read();
      if (ready(result)) return result;
      await page.waitForTimeout(250);
    }
    throw Error(message);
  };
  const dismissRating = async page => {
    const skip = page.getByText('暂不评价', {exact:true});
    if (await skip.isVisible().catch(()=>false)) await skip.click();
  };
  let catalog;
  const courses = new Map();
  let read = 0, failed = 0;
  try {
    catalog = await newPage();
    await catalog.goto(HOME, {waitUntil:'domcontentloaded', timeout:45000});
    let signedIn = false;
    for (let i=0;i<30 && !signedIn;i++) {check(); signedIn=await authenticated(catalog); if(!signedIn)await catalog.waitForTimeout(250);}
    if (!signedIn && credentials) {
      const result = await loginMooc(context, credentials, {stopped, newPage});
      if (result.status === 'success') {
        await catalog.reload({waitUntil:'domcontentloaded'});
        signedIn = await authenticated(catalog);
      }
    }
    if (!signedIn) throw Error('MOOC 登录已失效，请在「账号」中打开网页完成登录后重试。');
    const profile = catalog.locator('a[href*="/home.htm?userId="]').first();
    const profileURL = new URL(await profile.getAttribute('href'), HOME);
    if (profileURL.origin !== new URL(HOME).origin || profileURL.pathname !== '/home.htm' || !/^\d+$/.test(profileURL.searchParams.get('userId') || '')) throw Error('个人中心链接未识别');
    for (const [type, hash] of [['MOOC','/home/course'], ['SPOC','/home/spocCourse']]) {
      check();
      profileURL.hash = hash;
      await catalog.goto(profileURL.href, {waitUntil:'domcontentloaded', timeout:45000});
      // A hash-only navigation may still expose the previous list briefly.
      if (type === 'SPOC') await catalog.reload({waitUntil:'domcontentloaded',timeout:45000});
      const tab = catalog.locator('a').filter({hasText:new RegExp('^\\s*'+type+'课程\\s*[（(]\\d+[）)]\\s*$')});
      await tab.first().waitFor({state:'visible',timeout:20000});
      const expected = Number((await tab.first().innerText()).match(/\d+/)?.[0]);
      if (!Number.isInteger(expected)) throw Error(type+' 课程数量未识别');
      if (!expected) continue;
      const seenPages = new Set();
      let typeCount = 0;
      for (let pageNo=0;pageNo<500;pageNo++) {
        const cards = await poll(catalog, () => catalog.evaluate(catalogDOM), list=>list.length>0, type+' 课程列表未加载完成');
        const signature = cards.map(c=>c.url).join('|');
        if (seenPages.has(signature)) throw Error(type+' 课程分页未更新，请重试。');
        seenPages.add(signature);
        for (const card of cards) {
          if (!card.name || !card.url) throw Error(type+' 课程卡片信息不完整');
          const url = learningURL(card.url);
          const key = type+':'+url;
          if (!courses.has(key)) {courses.set(key,{...card,url,course_type:type}); typeCount++;}
        }
        if (typeCount>=expected) break;
        const next = catalog.locator('#j-coursewrap .ux-pager_btn__next a');
        if (!await next.isVisible() || /disable/.test(await next.getAttribute('class') || '')) throw Error(type+' 课程列表不完整');
        await next.click();
        await poll(catalog, () => catalog.evaluate(catalogDOM), list=>list.length>0 && list.map(c=>c.url).join('|')!==signature, type+' 课程分页未加载完成');
      }
      if (typeCount<expected) throw Error(type+' 课程分页过多，未能完整读取。');
    }
    emit('catalog',{courses:[...courses.values()]});
    async function checkCourse(course) {
      check();
      let page;
      const metrics = unknown('页面未读取');
      try {
        emit('progress',{message:`正在检查 ${course.course_type}：${course.name}`});
        page=await newPage();
        await page.goto(course.url, {waitUntil:'domcontentloaded',timeout:45000});
        if (!/^\/(?:spoc\/)?learn\//.test(new URL(page.url()).pathname)) {
          throw Error(/距离开课还有/.test(course.availability) ? '尚未开课，已发布项目待确认。' : '学习页暂不可访问，请打开课程核对。');
        }
        await dismissRating(page);
        let outline=await poll(page,()=>page.evaluate(outlineDOM),data=>data.chapters>0||data.empty,'课件列表未加载完成');
        // Collapsed chapters lazily create their leaves; expanding is essential.
        for (const index of outline.collapsed) {
          check();
          const chapter=page.locator('.m-learnChapterNormal').nth(index);
          await chapter.locator('.j-titleBox').click();
          await poll(page,()=>chapter.locator('.j-lessoBox').innerText(),text=>Boolean(text.trim()),'章节内容未加载完成');
        }
        outline=await page.evaluate(outlineDOM);
        if (outline.collapsed.length) throw Error('部分章节未展开');
        Object.assign(metrics, outlineMetrics(outline.items));
        const testURL=new URL(course.url); testURL.hash='/learn/testlist';
        await page.goto(testURL.href, {waitUntil:'domcontentloaded',timeout:45000});
        await dismissRating(page);
        let assessments=await poll(page,()=>page.evaluate(assessmentsDOM),data=>data.items.length>0||data.empty,'测验与作业列表未加载完成');
        for (const item of assessments.items) {
          if (item.kind !== 'quiz' || submitted(item.submissions) !== null) continue;
          await page.locator('.u-quizHwListItem').nth(item.index).locator('.j-titleBox').click();
          await poll(page,()=>page.locator('.u-quizHwListItem').nth(item.index).locator('.j-submitCount').count(),n=>n>0,'测验提交记录未加载完成');
        }
        assessments=await page.evaluate(assessmentsDOM);
        if (assessments.items.some(i=>!i.kind)) throw Error('存在未识别的测验或作业');
        metrics.quiz=assessmentMetric(assessments.items.filter(i=>i.kind==='quiz').map(i=>({...i,done:submitted(i.submissions)})));
        const homework=[];
        const homeworkItems=assessments.items.filter(i=>i.kind==='homework');
        for (const [index,item] of homeworkItems.entries()) {
          check();
          let done=null, reviews;
          try {
            // This opens the overview only. No "开始作答" or "提交答案" action.
            await page.locator('.u-quizHwListItem').nth(item.index).locator('.j-quizBtn').click();
            await page.waitForURL(/#\/learn\/hw\?/, {timeout:15000});
            const state=await poll(page,()=>page.evaluate(homeworkStatusDOM),state=>state.done!==null,'作业提交状态未识别');
            done=state.done;
            reviews=state.reviews;
          } catch (error) {check();}
          homework.push({...item,done,reviews});
          if (index+1 < homeworkItems.length) {
            await page.goto(testURL.href,{waitUntil:'domcontentloaded',timeout:45000});
            await poll(page,()=>page.evaluate(assessmentsDOM),data=>data.items.length===assessments.items.length,'测验与作业列表未恢复');
          }
        }
        metrics.homework=assessmentMetric(homework);
        const reviews=homeworkReviews(homework);
        if (Object.keys(reviews).length) metrics.homework.reviews=reviews;
      } catch (error) {
        check();
        for (const metric of Object.values(metrics)) if (metric.required===null) metric.error=error.message;
      } finally {if(page)await page.close().catch(()=>{});}
      const complete=categories.every(k=>metrics[k].required!==null && metrics[k].done!==null);
      complete ? read++ : failed++;
      const counts=metrics.courseware.required===null ? null : [metrics.courseware.done,metrics.courseware.required];
      emit('course',{url:course.url,counts,metrics,error:metrics.courseware.error || '',message:`已检查 ${read+failed}/${courses.size}：${course.name}${complete?'':'（部分进度待确认）'}`});
    }
    await scanConcurrently([...courses.values()], checkCourse, stopped);
    return `检查结束：发现 ${courses.size} 门 MOOC/SPOC 课程，完整读取 ${read} 门，${failed} 门待确认。`;
  } finally {if(catalog)await catalog.close().catch(()=>{});}
}
module.exports={scanMooc,scanConcurrently,learningURL,catalogDOM,outlineDOM,outlineMetrics,assessmentsDOM,submitted,assessmentMetric,homeworkStatusDOM,homeworkReviews};
