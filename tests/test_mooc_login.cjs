const assert = require('node:assert/strict');
const {loginMooc, trusted, classifyError} = require('../mooc_login.cjs');

function scenario(mode, selected = false) {
  let submitted = false, closed = false, cleared = false;
  const fields = {}, clicks = [];
  const locator = selector => ({
    first() { return this; },
    filter(options) {
      assert.equal(selector, '.ux-tabs-underline_hd > li');
      const labels = ['上次登录手机号登录', '邮箱登录', '爱课程登录'];
      assert.equal(labels.filter(text => text.includes(options.hasText)).length, 1);
      return locator(options.hasText);
    },
    waitFor: async () => {},
    count: async () => {
      if (selector === '.navLoginBtn:visible') return submitted && mode === 'success' ? 0 : 1;
      if (selector.includes('a[href*="/home.htm?userId="]')) return submitted && mode === 'success' ? 1 : 0;
      if (selector.includes('input[type="password"]')) return 1;
      if (selector.includes('iframe') && selector.includes('j-ursContainer')) return 1;
      if (selector.includes('.yidun_panel')) return submitted && mode === 'captcha' ? 1 : 0;
      if (selector.includes('.ferror')) return submitted && mode === 'invalid_credentials' ? 1 : 0;
      return 0;
    },
    fill: async text => { fields[selector] = text; },
    getAttribute: async name => name === 'src' ? 'https://reg.icourse163.org/webzj/v1.0.1/pub/index_dl2_new.html' : name === 'class' ? (selected ? 'z-sel last-login-holder' : 'last-login-holder') : null,
    click: async () => {
      clicks.push(selector);
      if (selector.includes('#dologin')) submitted = true;
    },
    check: async () => {},
    innerText: async () => '帐号或密码错误',
  });
  const frame = {url: () => 'https://reg.icourse163.org/webzj/v1.0.1/pub/index_dl2_new.html', locator,
    getByRole: () => locator('remember')};
  const page = {
    url: () => mode === 'redirect' ? 'https://untrusted.example/' : 'https://www.icourse163.org/',
    goto: async () => { if (mode === 'network') throw Error('offline'); },
    locator: selector => {
      assert.ok(!selector.includes('input[type="password"]'), 'never search the main page/offscreen 爱课程 form for a password');
      return locator(selector);
    },
    frameLocator: selector => {
      clicks.push('frame:' + selector);
      return frame;
    },
    frames: () => [frame],
    getByText: text => locator(String(text)),
    waitForTimeout: async () => {},
    isClosed: () => closed,
    close: async () => { closed = true; },
  };
  const context = {newPage: async () => page, pages: () => [page], clearCookies: async options => {
    assert.ok(options.domain.test('.icourse163.org'));
    assert.ok(!options.domain.test('.chaoxing.com'));
    cleared = true;
  }};
  return {context, fields, clicks, get closed() {return closed;}, get cleared() {return cleared;}};
}

(async () => {
  assert.equal(trusted('https://reg.icourse163.org/login'), true);
  assert.equal(trusted('https://icourse163.org.attacker.test/'), false);
  assert.equal(classifyError('帐号或密码错误'), 'invalid_credentials');
  assert.equal(classifyError('请完成滑块验证'), 'captcha');
  for (const mode of ['success', 'invalid_credentials', 'captcha', 'network', 'redirect']) {
    const mock = scenario(mode);
    const result = await loginMooc(mock.context, {username: 'test@example.com', password: 'secret'});
    assert.equal(result.status, ['network', 'redirect'].includes(mode) ? 'error' : mode);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(mock.cleared, true);
    if (['network', 'redirect'].includes(mode)) assert.equal(Object.keys(mock.fields).length, 0);
    else {
      assert.ok(mock.clicks.includes('邮箱登录'));
      assert.ok(mock.clicks.includes('frame:#j-ursContainer-1:not(.tab-hide) iframe'));
      assert.equal(mock.fields['input[name="email"][type="text"]:visible, input[type="email"]:visible'], 'test@example.com');
    }
    assert.equal(mock.closed, true);
  }
  const manual = scenario('captcha');
  assert.equal((await loginMooc(manual.context, {username: '13800000000', password: 'secret'}, {visible: true})).status, 'captcha');
  assert.ok(manual.clicks.includes('手机号登录'));
  assert.ok(manual.clicks.includes('frame:#j-ursContainer-0:not(.tab-hide) iframe'));
  assert.equal(manual.fields['#phoneipt'], '13800000000');
  assert.equal(manual.fields['input[type="password"].j-inputtext:visible'], 'secret');
  assert.equal(manual.closed, false);
  const check = scenario('captcha');
  assert.equal((await loginMooc(check.context, null, {checkOnly: true})).status, 'not_logged_in');
  assert.equal(check.cleared, false);
  const alreadySelected = scenario('success', true);
  assert.equal((await loginMooc(alreadySelected.context, {username: '13800000000', password: 'secret'})).status, 'success');
  assert.ok(!alreadySelected.clicks.includes('手机号登录'), 'an already selected tab must not be clicked again');
  const cancelled = scenario('success');
  assert.equal((await loginMooc(cancelled.context, null, {stopped: () => true})).status, 'cancelled');
  assert.equal(cancelled.cleared, false);
  console.log('MOOC login, error, manual challenge, cancellation and domain checks passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
