// MOOC's public NetEase password-login UI. Challenges are left to the user.
const HOME = 'https://www.icourse163.org/';
const trusted = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'icourse163.org' || u.hostname.endsWith('.icourse163.org'));
  } catch { return false; }
};

function classifyError(text) {
  if (/验证码|滑块|安全验证|短信验证|验证失败|扫码/.test(text)) return 'captcha';
  if (/密码.{0,12}(错误|不正确)|帐号.{0,12}(不存在|错误)|账号.{0,12}(不存在|错误)|用户名.{0,12}(不存在|错误)/.test(text)) return 'invalid_credentials';
  return 'error';
}

async function authenticated(page) {
  if (!trusted(page.url())) return false;
  // Closing a modal or leaving a password frame is not proof of authentication.
  const loggedOut = await page.locator('.navLoginBtn:visible').count();
  if (loggedOut) return false;
  const profile = await page.locator('a[href*="/home.htm?userId="]:visible').count();
  const logout = await page.getByText(/^(退出登录|退出)$/).count();
  return Boolean(profile || logout);
}

async function passwordFrame(page, stopped, phone) {
  const selector = (phone ? '#j-ursContainer-0' : '#j-ursContainer-1') + ':not(.tab-hide) iframe';
  for (let i = 0; i < 30 && !stopped(); i++) {
    const iframe = page.locator(selector);
    if (await iframe.count()) {
      const src = await iframe.getAttribute('src');
      if (!trusted(src)) return null;
      const frame = page.frameLocator(selector);
      if (await frame.locator('input[type="password"].j-inputtext:visible').count()) return frame;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function challenge(page, selectedFrame) {
  for (const frame of [page, selectedFrame]) {
    if (await frame.locator('.yidun_panel:visible, .yidun_popup:visible, iframe[src*="captcha"]:visible, input[name="captcha"]:visible').count()) return true;
  }
  return false;
}

async function loginMooc(context, credentials, options = {}) {
  const {checkOnly = false, visible = false, stopped = () => false, newPage = () => context.newPage()} = options;
  let page, keepPage = false;
  let stage = 'open_page';
  try {
    if (stopped()) return {status: 'cancelled'};
    if (!checkOnly && !credentials) return {status: 'error'};
    if (!checkOnly) {
      // Do not verify fresh credentials using a previous account's session.
      await context.clearCookies({domain: /(^|\.)icourse163\.org$/});
    }
    page = visible ? context.pages().find(p => trusted(p.url())) : null;
    page = page || await newPage();
    await page.goto(HOME, {waitUntil: 'domcontentloaded', timeout: 45000});
    if (!trusted(page.url())) return {status: 'error'};
    if (checkOnly) {
      for (let i = 0; i < 20 && !stopped(); i++) {
        if (await authenticated(page)) return {status: 'success'};
        await page.waitForTimeout(300);
      }
      return {status: stopped() ? 'cancelled' : 'not_logged_in'};
    }
    keepPage = true;
    stage = 'open_login';
    await page.locator('.navLoginBtn').click({timeout: 15000});
    const phone = /^1\d{10}$/.test(credentials.username);
    const mode = phone ? '手机号登录' : '邮箱登录';
    stage = 'select_mode';
    // The tab can contain an extra “上次登录” badge. Match the tab itself,
    // not its entire exact text, and leave an already selected tab alone.
    const modeTab = page.locator('.ux-tabs-underline_hd > li').filter({hasText: mode});
    await modeTab.waitFor({state: 'visible', timeout: 15000});
    const classes = (await modeTab.getAttribute('class') || '').split(/\s+/);
    if (!classes.includes('z-sel')) await modeTab.click({timeout: 10000});
    stage = 'load_form';
    const frame = await passwordFrame(page, stopped, phone);
    if (!frame) return {status: stopped() ? 'cancelled' : 'error', reason: stage};
    const password = frame.locator('input[type="password"].j-inputtext:visible').first();
    const username = phone ? frame.locator('#phoneipt') : frame.locator('input[name="email"][type="text"]:visible, input[type="email"]:visible').first();
    stage = 'fill_form';
    await username.fill(credentials.username);
    await password.fill(credentials.password);
    const remember = frame.getByRole('checkbox', {name: /十天内免登录/});
    if (await remember.count()) await remember.first().check();
    // These are the password-submit controls observed in the official URS frames.
    stage = 'submit';
    await frame.locator('#dologin:visible, #submitBtn:visible').first().click();
    stage = 'confirm_login';
    for (let i = 0; i < 60 && !stopped(); i++) {
      await page.waitForTimeout(500);
      if (await authenticated(page)) { keepPage = false; return {status: 'success'}; }
      try {
        if (await challenge(page, frame)) return {status: 'captcha'};
        const error = frame.locator('.nerror:visible, #nerror:visible, .ferrorhead:visible, .ferror:visible, .error:visible, [role="alert"]:visible').first();
        if (await error.count()) {
          const text = await error.innerText();
          if (text.trim()) return {status: classifyError(text)};
        }
      } catch {
        // URS frames can detach during a successful redirect. Wait for the
        // homepage's authenticated state instead of treating that as failure.
        if (page.isClosed()) return {status: stopped() ? 'cancelled' : 'error', reason: stage};
      }
    }
    // An unrecognized challenge must remain available for manual verification.
    return {status: stopped() ? 'cancelled' : 'not_logged_in', reason: 'confirm_login'};
  } catch {
    return {status: stopped() ? 'cancelled' : 'error', reason: stage};
  } finally {
    if (page && (!visible || !keepPage || stopped())) await page.close().catch(() => {});
  }
}

module.exports = {loginMooc, classifyError, trusted, authenticated};
