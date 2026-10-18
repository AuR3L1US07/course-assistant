const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {hudInitScript}=require('../browser_worker.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  await page.setContent('<h1>课程章节</h1>');await page.evaluate(hudInitScript);
  await page.selectOption('#cx-hud-command','document');await page.click('#cx-hud-run');
  assert.equal(await page.evaluate(()=>window.__cxHud.command),'document');
  await page.evaluate(()=>{window.__cxHud=null;});await page.click('#cx-hud-pause');
  assert.equal(await page.evaluate(()=>window.__cxHud.pause),true);
  await page.evaluate(()=>{document.querySelector('#cx-hud-pause').textContent='继续';window.__cxHud=null;});
  await page.click('#cx-hud-pause');assert.equal(await page.evaluate(()=>window.__cxHud.pause),false);
  await page.evaluate(hudInitScript);assert.equal(await page.locator('#cx-hud').count(),1);
  for(const mode of ['video','quiz','auto']){await page.selectOption('#cx-hud-command',mode);await page.click('#cx-hud-run');assert.equal(await page.evaluate(()=>window.__cxHud.command),mode);}
  await page.click('#cx-hud-auto');
  assert.equal(await page.evaluate(()=>window.__cxHud.command),'auto');
  await page.screenshot({path:'.test-artifacts/manual-command-hud.png'});
  await page.setViewportSize({width:480,height:700});
  assert.ok(await page.locator('#cx-hud').evaluate(el=>el.getBoundingClientRect().left>=0));
  await page.click('#cx-hud-stop');assert.equal(await page.evaluate(()=>window.__cxHud.stop),true);
  console.log('manual command HUD passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
