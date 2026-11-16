// tools/test-login.js —— login.js 的离线自测（node 直接跑，不需要浏览器）
// 用假的 DOM / fetch 驱动整个流程，验证接口调用顺序、参数、状态机与渲染。
//   node tools/test-login.js
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.dirname(__dirname);
var UID = 'e199c5f34badd0bb1a60cb98cd68ae15d4e80d60';
var TIMEOUT = 2000;

// ---------- 极简 DOM ----------

function El(id) {
  this.id = id;
  this.hidden = false;
  this.disabled = false;
  this.textContent = '';
  this.className = '';
  this.value = '';
  this.children = [];
  this.attrs = {};
  this.listeners = {};
  this.src = '';
  this.complete = false;
  this.naturalWidth = 0;
  this.width = 0;
  this.height = 0;
  this.onload = null;
  this.onerror = null;
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.removeChild = function (c) { this.children.splice(this.children.indexOf(c), 1); };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k]; };
El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
El.prototype.click = function () {
  var ev = { currentTarget: this };
  (this.listeners.click || []).forEach(function (fn) { fn(ev); });
};

var ids = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8')
  .match(/id="([^"]+)"/g).map(function (s) { return s.slice(4, -1); });

function makeDocument() {
  var els = {};
  ids.forEach(function (id) { els[id] = new El(id); });
  if (els.qrImg) { els.qrImg.naturalWidth = 205; els.qrImg.naturalHeight = 205; els.qrImg.complete = true; }
  // login.html 里 token 区的 4 个复制按钮（真实 DOM 里是 #tokRows 的子元素）
  for (var i = 0; i < 4; i++) {
    var b = new El('tokBtn' + i);
    b.tag = 'button';
    els.tokRows.appendChild(b);
  }
  var docListeners = {};
  var doc = {
    title: '',
    body: { appendChild: function () {}, removeChild: function () {} },
    getElementById: function (id) { return els[id] || null; },
    createElement: function (tag) {
      var e = new El('created:' + tag);
      e.tag = tag;
      return e;
    },
    addEventListener: function (t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    querySelectorAll: function (sel) { return sel === '#tokRows button' ? els.tokRows.children.slice() : []; },
    fire: function (t) { (docListeners[t] || []).forEach(function (fn) { fn(); }); },
    execCommand: function () { return true; }
  };
  return { doc: doc, els: els };
}

// 监听 <img>.src 赋值，模拟图片加载成功
function watchQrImg(els, onLoad) {
  var img = els.qrImg;
  var internal = img.src;
  Object.defineProperty(img, 'src', {
    configurable: true,
    get: function () { return internal; },
    set: function (v) { internal = v; img.complete = true; setTimeout(function () { onLoad(v); }, 0); }
  });
}

// ---------- 假网络 ----------

function makeFetch(routes) {
  var calls = [];
  function impl(url, init) {
    var method = (init && init.method) || 'GET';
    calls.push({ url: url, method: method, body: (init && init.body) || '', headers: (init && init.headers) || {} });
    var key = Object.keys(routes).find(function (k) { return url.indexOf(k) >= 0; });
    if (key === undefined) throw new Error('unexpected fetch: ' + url);
    var r = routes[key];
    var body = typeof r === 'function' ? r(url, init) : r;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); }
    });
  }
  impl.calls = calls;
  return impl;
}

// ---------- 启动沙箱 ----------

function boot(routes) {
  var env = makeDocument();
  var logs = [];
  var sandbox = {
    console: { log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); }, error: console.error },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AbortController: AbortController,
    Blob: function () {},
    navigator: { clipboard: { writeText: function () { return Promise.resolve(); } } },
    URL: { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} },
    document: env.doc,
    window: { addEventListener: function () {} },
    jsQR: function () { return { data: 'https://yun.115.com/scan/dg-' + UID }; }
  };
  sandbox.windowMagnet = true;
  sandbox.self = sandbox;
  sandbox.fetch = makeFetch(routes);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), sandbox, { filename: 'shared.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'login.js'), 'utf8'), sandbox, { filename: 'login.js' });
  watchQrImg(env.els, function () { env.els.qrImg.onload && env.els.qrImg.onload(); });
  env.doc.fire('DOMContentLoaded');
  return { els: env.els, fetch: sandbox.fetch, doc: env.doc, M: sandbox.self.Magnet115, logs: logs };
}

function waitFor(fn, ms, env) {
  return new Promise(function (resolve, reject) {
    var t0 = Date.now();
    (function tick() {
      var v;
      try { v = fn(); } catch (e) { return reject(e); }
      if (v) return resolve(v);
      if (Date.now() - t0 > (ms || TIMEOUT)) {
        var extra = env ? ' | diag=' + env.els.diag.textContent + ' | calls=' +
          env.fetch.calls.map(function (c) { return c.method + ' ' + c.url; }).join(' , ') : '';
        return reject(new Error('timeout: ' + fn.toString() + extra));
      }
      setTimeout(tick, 4);
    })();
  });
}

// ---------- 用例 ----------

var TOKEN_OK = {
  state: 1, code: 0, message: '',
  data: { uid: UID, time: 1794837427, sign: '7f2601fe0a0d8d08812a28ea648e87f4', qrcode: 'https://115.com/scan/dg-' + UID }
};
var COOKIE_OK = { state: 1, data: { cookie: { UID: '123', CID: 'c', SEID: 's', KID: 'k' } } };

var results = [];

async function testGetToken() {
  var env = boot({ '1.0/token/': TOKEN_OK });
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; });
  assert(env.fetch.calls.length === 1, '只请求一次 token');
  assert(env.fetch.calls[0].url === 'https://qrcodeapi.115.com/api/1.0/web/1.0/token/', 'token URL');
  assert(env.els.vUid.textContent === UID, 'uid 显示');
  assert(env.els.vSign.textContent === TOKEN_OK.data.sign, 'sign 显示');
  var t = env.els.tokRows;
  assert(t && !t.hidden, 'token 行可见');
  assert(!env.els.qrImg.hidden, '二维码图片可见');
  assert(env.els.qrImg.src.indexOf('https://qrcodeapi.115.com/api/1.0/web/1.0/qrcode/?uid=' + UID) === 0, '二维码图片改用 web 通道: ' + env.els.qrImg.src);
  var btnCopy = env.els.tokRows.children[0];
  assert(btnCopy && btnCopy.attrs['data-copy'] === UID, '复制按钮绑定 uid');
  var t2 = env.els.tokRows.children[1];
  assert(t2 && t2.attrs['data-copy'] === String(TOKEN_OK.data.time), '复制按钮绑定 time');
  assert(env.els.tokRows.children.length === 4, '共 4 个行复制按钮');
  assert(!env.els.copyToken.disabled, '复制 Token JSON 可用');
}

async function testSwitchAppReloadsQr() {
  var env = boot({ '1.0/token/': TOKEN_OK });
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; });
  env.els.appSel.value = 'mac';
  env.els.appSel.listeners.change[0]();
  await waitFor(function () { return env.fetch.calls.length === 2 && env.els.qrImg.src.indexOf('/mac/') > 0; });
  assert(env.els.qrImg.src.indexOf('/api/1.0/mac/1.0/qrcode/') > 0, '切换设备后二维码走 mac 通道');
  assert(env.els.appHint.textContent.indexOf('macOS') > 0, '提示文案跟随设备');
}

async function testFullLoginFlow() {
  var statuses = [0, 1, 2];
  var env = boot({
    '1.0/token/': TOKEN_OK,
    '/get/status/': function () { return { state: 1, data: { status: statuses.length ? statuses.shift() : 2 } }; },
    'login/qrcode/': COOKIE_OK
  });
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; });
  env.els.login.click();
  try {
    await waitFor(function () { return !env.els.result.hidden; }, 8000);
  } catch (e) {
    throw new Error(e.message + ' | status=' + env.els.statusText.textContent + ' | calls=' +
      env.fetch.calls.map(function (c) { return c.method + ' ' + c.url; }).join(' , '));
  }

  var polls = env.fetch.calls.filter(function (c) { return c.url.indexOf('/get/status/') >= 0; });
  assert(polls.length === 3, '轮询 3 次（0→1→2），实际 ' + polls.length);
  assert(polls[0].url === 'https://qrcodeapi.115.com/get/status/?uid=' + UID + '&time=1794837427&sign=' + TOKEN_OK.data.sign,
    '状态 URL 参数与原脚本一致: ' + polls[0].url);

  var post = env.fetch.calls.filter(function (c) { return c.method === 'POST'; })[0];
  assert(post && /login\/qrcode\/$/.test(post.url), '兑换用 POST: ' + (post && post.url));
  assert(post.method === 'POST', '兑换用 POST');
  assert(post.url === 'https://passportapi.115.com/app/1.0/web/1.0/login/qrcode/', '兑换 URL: ' + post.url);
  assert(post.body === 'app=web&account=' + UID, '兑换 body: ' + post.body);
  assert(/x-www-form-urlencoded/.test(post.headers['Content-Type']), '表单 Content-Type');

  assert(env.els.cookieList.children.length === 8, 'cookie 列表 4 组键值');
  assert(env.els.cookieList.children[0].textContent === 'UID', '第一条键名');
  assert(env.els.cookieList.children[1].textContent === '123', '第一条值');
  assert(env.els.resultTitle.textContent.indexOf('网页版') > 0, '结果标题含设备名');
  assert(env.els.cancel.disabled && !env.els.getToken.disabled, '结束后按钮状态复位');
}

async function testExpired() {
  var env = boot({ '1.0/token/': TOKEN_OK, '/get/status/': { state: 1, data: { status: -1 } } });
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; });
  env.els.login.click();
  await waitFor(function () { return /过期/.test(env.els.statusText.textContent); });
  assert(env.els.statusText.textContent.indexOf('过期') >= 0, '过期提示');
  assert(env.els.dot.className.indexOf('err') >= 0, '过期红点');
  assert(env.els.login.disabled, '过期后需重新获取');
}

async function testCanceledAndCancelButton() {
  var env = boot({ '1.0/token/': TOKEN_OK, '/get/status/': { state: 1, data: { status: -2 } } });
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; });
  env.els.login.click();
  await waitFor(function () { return /取消/.test(env.els.statusText.textContent); });
  assert(env.els.statusText.textContent.indexOf('手机端取消') >= 0, '手机取消提示');

  var env2 = boot({ '1.0/token/': TOKEN_OK, '/get/status/': { state: 1, data: { status: 0 } } });
  env2.els.getToken.click();
  await waitFor(function () { return !env2.els.login.disabled; });
  env2.els.login.click();
  await waitFor(function () { return env2.fetch.calls.some(function (c) { return c.url.indexOf('/get/status/') >= 0; }); });
  env2.els.cancel.click();
  var n = env2.fetch.calls.length;
  await new Promise(function (r) { setTimeout(r, 1300); });
  assert(env2.fetch.calls.length === n, '取消后不再轮询');
  assert(!env2.els.login.disabled, '取消后可重新等待扫码');
}

async function testTokenError() {
  var env = boot({ '1.0/token/': { state: 0, message: '风控' } });
  env.els.getToken.click();
  await waitFor(function () { return /失败/.test(env.els.statusText.textContent); });
  assert(env.els.dot.className.indexOf('err') >= 0, '错误红点');
  assert(!env.els.getToken.disabled, '可重试');
  assert(env.els.login.disabled, '没 token 不能开始轮询');
}

async function testSelfCheck() {
  var env = boot({ '1.0/token/': TOKEN_OK });
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; });
  env.els.selfCheck.click();
  await waitFor(function () { return /自检/.test(env.els.statusText.textContent); });
  assert(env.els.statusText.textContent.indexOf('自检通过') >= 0 || env.els.statusText.textContent.indexOf('自检失败') >= 0,
    '自检有结论: ' + env.els.statusText.textContent);
  // 模拟二维码图片取不到：自检应失败而不是抛出
  var env2 = boot({ '1.0/token/': TOKEN_OK });
  env2.els.getToken.click();
  await waitFor(function () { return !env2.els.login.disabled; });
  env2.els.qrImg.naturalWidth = 0;
  env2.els.selfCheck.click();
  await waitFor(function () { return /自检/.test(env2.els.statusText.textContent); });
  assert(env2.els.statusText.textContent.indexOf('自检失败') >= 0, '图片不可用时自检失败: ' + env2.els.statusText.textContent);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 诊断行：排障时用户能直接看到卡在哪一步（点按钮后毫无反应的情况要能自证）
async function testDiag() {
  var env = boot({ '1.0/token/': TOKEN_OK });
  assert(!env.els.diag.hidden, '加载后就显示诊断行');
  assert(/jsQR 已加载/.test(env.els.diag.textContent), '诊断行内容: ' + env.els.diag.textContent);
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; });
  assert(/二维码图片已加载/.test(env.els.diag.textContent), '取到二维码后诊断更新: ' + env.els.diag.textContent);
  assert(env.logs.some(function (l) { return l.indexOf('[115 扫码]') === 0; }), '同时打到 console');
}

// 设备类型选择：mac/linux/windows/tv 通道的 token 不带 qrcode，但仍要能扫码
async function testNoQrcodeChannel() {
  var env = boot({ '1.0/token/': function () {
    return { state: 1, data: { uid: UID, time: 1794837427, sign: 'abc' } };
  } });
  // 先选 mac，再点获取：refreshHint 会读取下拉框的当前值
  env.els.appSel.value = 'mac';
  env.els.appSel.listeners.change[0]();
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; }, TIMEOUT, env);
  assert(env.els.vUid.textContent === UID, '没有 qrcode 字段也应成功出码');
  assert(env.els.vQrcode.textContent === '', 'qrcode 列留空而不是 undefined');
  assert(env.els.qrImg.src.indexOf('/api/1.0/mac/1.0/qrcode/') > 0, '图片走 mac 通道: ' + env.els.qrImg.src);
  assert(!env.els.kickWarn.hidden, 'mac 通道也要显示踢下线提示');
  assert(env.els.kickWarn.innerHTML.indexOf('macOS') >= 0, '提示里写明当前设备: ' + env.els.kickWarn.innerHTML);
}

// 兑换后显示 115 当前认的端信息，便于确认拿到的是哪种设备的 cookie
async function testSessionInfo() {
  var statuses = [2];
  var env = boot({
    '1.0/token/': TOKEN_OK,
    '/get/status/': function () { return { state: 1, data: { status: statuses.length ? statuses.shift() : 2 } }; },
    'login/qrcode/': COOKIE_OK,
    'ct=login&ac=index': { state: 1, data: { ssoent: 'A1', login_type: 1 } }
  });
  env.els.getToken.click();
  await waitFor(function () { return !env.els.login.disabled; }, TIMEOUT, env);
  env.els.login.click();
  // 端信息是登录成功后的辅助查询，失败也不影响主流程
  await new Promise(function (r) { setTimeout(r, 300); });
  assert(/ssoent=A1/.test(env.els.sessionInfo.textContent), '端信息展示: ' + env.els.sessionInfo.textContent +
    ' | diag=' + env.els.diag.textContent);
  var post = env.fetch.calls.filter(function (c) { return c.method === 'POST'; })[0];
  assert(post && /account=/.test(post.body), '兑换请求未变');
}

var TESTS = [
  ['getToken', testGetToken],
  ['switchApp', testSwitchAppReloadsQr],
  ['fullLogin', testFullLoginFlow],
  ['expired', testExpired],
  ['cancel', testCanceledAndCancelButton],
  ['tokenError', testTokenError],
  ['selfCheck', testSelfCheck],
  ['diag', testDiag],
  ['noQrcodeChannel', testNoQrcodeChannel],
  ['sessionInfo', testSessionInfo]
];

(async function () {
  var failed = 0;
  for (var i = 0; i < TESTS.length; i++) {
    try {
      await TESTS[i][1]();
      results.push('PASS ' + TESTS[i][0]);
    } catch (e) {
      failed++;
      results.push('FAIL ' + TESTS[i][0] + ' -> ' + (e && e.message ? e.message : e) +
        '\n     ' + String((e && e.stack) || '').split('\n').slice(1, 4).join('\n     '));
    }
  }
  console.log(results.join('\n'));
  console.log(failed ? '\n' + failed + ' 个用例失败' : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();