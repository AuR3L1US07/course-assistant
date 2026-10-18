const assert=require('node:assert/strict');
const {chromium}=require('../.runtime/playwright-core');
const {setPlaybackSpeed}=require('../browser_worker.cjs');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    async function fixture(options='',style=''){
      await page.setContent(`<div class="video-js"><video></video><div class="vjs-playback-rate" style="${style}">${options}</div></div>`);
    }
    const item='<button class="vjs-menu-item" onclick="document.querySelector(\'video\').playbackRate=2">2x</button>';
    await fixture(item);
    assert.equal(await setPlaybackSpeed(page,0,2),2,'native supported speed');
    assert.equal(await setPlaybackSpeed(page,0,1),1,'return to normal');
    await fixture();
    assert.equal(await setPlaybackSpeed(page,0,2),2,'browser rate when no native option exists');
    await fixture(item,'display:none');
    assert.equal(await setPlaybackSpeed(page,0,2),2,'browser rate when control is hidden');
    await fixture('<button class="vjs-menu-item">2x</button>');
    assert.equal(await setPlaybackSpeed(page,0,2),2,'browser fallback when menu ignores change');
    await fixture(item);
    assert.equal(await setPlaybackSpeed(page,0,3),1,'invalid speed');
    assert.equal(await setPlaybackSpeed(page,0,1.5),1.5,'browser rate when requested native option is unavailable');
    await page.setContent('<video></video>');
    assert.equal(await setPlaybackSpeed(page,0,2),2,'video with no player menu');
    assert.equal(await setPlaybackSpeed(page,0,.75),.75,'slower selected rate remains available');
    for(const speed of [4,8,10,16]){
      assert.equal(await setPlaybackSpeed(page,0,speed),speed,`browser supports ${speed}x`);
    }
    assert.equal(await setPlaybackSpeed(page,0,32),1,'unsupported extreme rate falls back to normal');
    assert.equal(await setPlaybackSpeed(page,0,'auto'),16,'auto selects highest working candidate');
    await page.evaluate(()=>document.querySelector('video').addEventListener('ratechange',event=>{
      if(event.target.playbackRate>2)event.target.playbackRate=1;
    }));
    assert.equal(await setPlaybackSpeed(page,0,10),2,'a video limited to 2x falls back from 10x to 2x, not 1x');
    assert.equal(await setPlaybackSpeed(page,0,'auto'),2,'auto finds the highest rate accepted by the site');
    assert.equal(await setPlaybackSpeed(page,0,1.5),1.5,'manual selection remains an upper bound');
    await fixture('<button class="vjs-menu-item" onclick="document.querySelector(\'video\').playbackRate=3">3x</button>');
    await page.evaluate(()=>document.querySelector('video').addEventListener('ratechange',event=>{
      if(event.target.playbackRate>3)event.target.playbackRate=1;
    }));
    assert.equal(await setPlaybackSpeed(page,0,'auto'),3,'auto includes additional rates exposed by native menus');
    await page.setContent('<video></video>');
    await page.evaluate(()=>document.querySelector('video').addEventListener('ratechange',event=>{
      if(event.target.playbackRate!==1)event.target.playbackRate=1;
    }));
    assert.equal(await setPlaybackSpeed(page,0,2),1,'site resets rate: report normal speed rather than repeatedly forcing it');
    assert.equal(await setPlaybackSpeed(page,0,10),1,'site resets high rate: report normal speed');
    assert.equal(await setPlaybackSpeed(page,0,'auto'),1,'fully restricted player stays at normal speed');
    assert.equal(await setPlaybackSpeed(page,1,2),1,'missing video is handled');
    await page.setContent('<video></video>');
    assert.equal(await setPlaybackSpeed(page,0,'auto',{ceiling:4-.01}),2,'after a delayed reset, do not retry previously rejected rates');
    console.log('Playback speed: 24 checks passed, including auto maximum, descending fallback and site restrictions');
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
