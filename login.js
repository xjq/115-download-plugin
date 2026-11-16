// login.js —— 115 扫码获取 Token / Cookie（纯浏览器端，扩展页面内运行）
// 流程与 tools/qrcode_login.py 一致：
//   1. GET  https://qrcodeapi.115.com/api/1.0/web/1.0/token/           取 uid / time / sign / qrcode
//   2. GET  https://qrcodeapi.115.com/api/1.0/{app}/1.0/qrcode/?uid=   取二维码图片（<img> 直接加载）
//   3. GET  https://qrcodeapi.115.com/get/status/?uid&time&sign        轮询状态
//   4. POST https://passportapi.115.com/app/1.0/{app}/1.0/login/qrcode/ 换取 Cookie
// 出问题时看页面底部的「诊断」区，或扩展详情页「service worker / 检查视图(login.html)」的 Console。
'use strict';

var M = self.Magnet115;
var Q = M.QRCODE;

var POLL_MS = 1000;
var REQUEST_TIMEOUT = 15000;

var state = {
  token: null,
  app: 'web',
  timer: 0,
  running: false,
  result: null,
  lastStatus: null
};

var $ = function (id) { return document.getElementById(id); };

// ---------- 网络 ----------

async function fetchJson(url, init) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT);
  var resp;
  try {
    var opts = init || {};
    opts.credentials = 'omit';
    opts.cache = 'no-store';
    opts.signal = ctrl.signal;
    resp = await fetch(url, opts);
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时');
    throw new Error('网络请求失败：' + (e && e.message ? e.message : e));
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  var text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('接口返回不 JSON（可能被风控拦截）：' + text.slice(0, 80));
  }
}

// ---------- UI 辅助 ----------

function diag(msg) {
  var el = $('diag');
  if (!el) return;
  var t = new Date();
  var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
  el.textContent = hh + '  ' + msg;
  el.hidden = false;
  try { console.log('[115 扫码]', msg); } catch (e) { /* ignore */ }
}

function setDot(cls, text) {
  $('dot').className = 'dot' + (cls ? ' ' + cls : '');
  $('statusText').textContent = text;
}

function showToken(token) {
  $('vUid').textContent = token.uid;
  $('vTime').textContent = String(token.time);
  $('vSign').textContent = token.sign;
  $('vQrcode').textContent = token.qrcode || '';
  $('tokRows').hidden = false;
  var btns = document.querySelectorAll('#tokRows button');
  for (var i = 0; i < btns.length; i++) {
    btns[i].setAttribute('data-copy', [token.uid, token.time, token.sign, token.qrcode][i] || '');
  }
  $('copyToken').disabled = false;
}

function tokenJson() {
  var t = state.token;
  if (!t) return '';
  return JSON.stringify({ uid: t.uid, time: t.time, sign: t.sign, qrcode: t.qrcode }, null, 2);
}

function tokenQuery() {
  // 状态接口所需的 3 个查询参数，顺序与原脚本一致
  var t = state.token;
  return 'uid=' + encodeURIComponent(t.uid) +
    '&time=' + encodeURIComponent(t.time) +
    '&sign=' + encodeURIComponent(t.sign);
}

function qrImageUrl(uid) {
  return Q.image.replace('%s', state.app) + '?uid=' + encodeURIComponent(uid) + '&_=' + Date.now();
}

async function copyText(text, btn) {
  var ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    document.body.removeChild(ta);
  }
  if (btn) {
    var old = btn.textContent;
    btn.textContent = ok ? '已复制' : '复制失败';
    setTimeout(function () { btn.textContent = old; }, 1200);
  }
  return ok;
}

// ---------- 执行记录（自检用） ----------

async function loadImage(uid) {
  return new Promise(function (resolve, reject) {
    var img = $('qrImg');
    img.hidden = false;
    $('qrPlaceholder').hidden = true;
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('二维码图片加载失败（' + img.src + '）')); };
    img.src = qrImageUrl(uid);
  });
}

function decodeQrFromImage(img) {
  if (typeof jsQR !== 'function') throw new Error('jsQR 未加载（lib/jsQR.js 缺失）');
  var canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  if (!canvas.width || !canvas.height) throw new Error('二维码图片尺寸异常');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var code = jsQR(data.data, canvas.width, canvas.height);
  return code ? String(code.data) : '';
}

// ---------- 主流程 ----------

function stopPolling(msg, cls) {
  state.running = false;
  clearTimeout(state.timer);
  state.timer = 0;
  $('cancel').disabled = true;
  $('getToken').disabled = false;
  if (msg) setDot(cls || '', msg);
}

async function getToken() {
  diag('开始获取 token …');
  stopPolling('正在获取二维码 …', 'on');
  $('getToken').disabled = true;
  $('login').disabled = true;
  $('result').hidden = true;
  state.result = null;
  state.token = null;
  $('tokRows').hidden = true;
  $('copyToken').disabled = true;
  $('qrImg').hidden = true;
  $('qrPlaceholder').hidden = false;
  try {
    var resp = await fetchJson(Q.token);
    diag('token 已返回：' + JSON.stringify(resp).slice(0, 160));
    var data = resp && resp.data;
    // 实测 mac/linux/windows/tv 通道的 token 不带 qrcode 字段，那是正常的，扫码走图片通道
    if (!data || !data.uid || !data.sign) {
      throw new Error('获取 token 失败：' + JSON.stringify(resp).slice(0, 120));
    }
    state.token = {
      uid: String(data.uid),
      time: data.time,
      sign: String(data.sign),
      qrcode: data.qrcode ? String(data.qrcode) : ''
    };
    showToken(state.token);
    await loadImage(state.token.uid);
    diag('二维码图片已加载，uid=' + state.token.uid);
    setDot('ok', '二维码已生成，请用 115 App 扫码（约 2 分钟内有效）');
    $('login').disabled = false;
    stopPolling();
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    diag('获取二维码失败：' + msg);
    stopPolling('获取二维码失败：' + msg, 'err');
    $('getToken').disabled = false;
  }
}

function schedulePoll() {
  if (!state.running) return;
  state.timer = setTimeout(pollOnce, POLL_MS);
}

async function pollOnce() {
  if (!state.running) return;
  var resp;
  try {
    resp = await fetchJson(Q.status + '?' + tokenQuery());
  } catch (e) {
    // 网络抖动：保持轮询，等二维码过期由状态码兜底
    diag('状态查询失败：' + (e && e.message ? e.message : e));
    setDot('on', '状态查询失败，重试中 …（' + (e && e.message ? e.message : e) + '）');
    schedulePoll();
    return;
  }
  var data = (resp && resp.data) || {};
  var status = data.status;
  if (status !== state.lastStatus) {
    state.lastStatus = status;
    diag('二维码状态：' + status);
  }
  if (status === 0) {
    setDot('ok', '二维码已生成，等待扫码 …');
    schedulePoll();
  } else if (status === 1) {
    setDot('on', '已扫码，请在手机上确认登录');
    schedulePoll();
  } else if (status === 2) {
    stopPolling('已确认，正在兑换 Cookie …', 'on');
    await exchange();
  } else if (status === -1) {
    stopPolling('二维码已过期，请重新获取', 'err');
    $('login').disabled = true;
  } else if (status === -2) {
    stopPolling('手机端取消了登录，请重新扫码', 'err');
    $('login').disabled = true;
  } else {
    stopPolling('扫码流程异常：' + JSON.stringify(resp).slice(0, 120), 'err');
  }
}

function startPolling() {
  if (!state.token) return;
  state.running = true;
  $('cancel').disabled = false;
  $('login').disabled = true;
  $('getToken').disabled = true;
  setDot('on', '等待扫码 …');
  pollOnce();
}

async function exchange() {
  var app = state.app;
  var body = 'app=' + encodeURIComponent(app) + '&account=' + encodeURIComponent(state.token.uid);
  var url = Q.result.replace('%s', app);
  diag('正在兑换 Cookie：POST ' + url);
  var resp;
  try {
    resp = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    });
  } catch (e) {
    diag('兑换失败：' + (e && e.message ? e.message : e));
    stopPolling('兑换 Cookie 失败：' + (e && e.message ? e.message : e), 'err');
    return;
  }
  var cookie = resp && resp.data && resp.data.cookie;
  if (!cookie || typeof cookie !== 'object') {
    diag('兑换响应异常：' + JSON.stringify(resp).slice(0, 200));
    stopPolling('兑换 Cookie 失败：' + JSON.stringify(resp).slice(0, 160), 'err');
    return;
  }
  diag('兑换成功：app=' + app + '，拿到 ' + Object.keys(cookie).length + ' 个 cookie 字段');
  state.result = resp;
  stopPolling('登录成功，已获取 Cookie', 'ok');
  $('login').disabled = true;
  $('getToken').disabled = false;
  renderResult(resp);
  await describeCurrentSession(cookie);
}

// 兑换回来的 Cookie 里没有设备名；用浏览器里现有的登录态问一下 115 当前算哪个端，
// 让用户能确认「这次拿到的 cookie 到底是哪种设备」
async function describeCurrentSession(cookie) {
  try {
    var resp = await fetchJson('https://115.com/?ct=login&ac=index', {
      credentials: 'include',
      headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    var d = (resp && resp.data) || {};
    var fields = [];
    ['ssoent', 'login_type', 'device', 'device_name', 'platform'].forEach(function (k) {
      if (d[k] !== undefined && d[k] !== '') fields.push(k + '=' + d[k]);
    });
    if (fields.length) {
      var info = '115 当前认的端信息：' + fields.join('，') + '（兑换用的设备类型：' + M.appName(state.app) + '）';
      $('sessionInfo').textContent = info;
      $('sessionInfo').hidden = false;
      diag(info);
    } else {
      diag('端信息接口没有返回设备字段：' + JSON.stringify(resp).slice(0, 160));
    }
  } catch (e) {
    // 只是辅助信息，取不到就算了
    diag('端信息查询失败：' + (e && e.message ? e.message : e));
  }
}

function cookieString(cookie) {
  return Object.keys(cookie).map(function (k) { return k + '=' + cookie[k]; }).join('; ');
}

function renderResult(resp) {
  var cookie = resp.data.cookie;
  var list = $('cookieList');
  list.textContent = '';
  Object.keys(cookie).forEach(function (k) {
    var kk = document.createElement('span');
    kk.className = 'k';
    kk.textContent = k;
    var vv = document.createElement('span');
    vv.className = 'v';
    vv.textContent = String(cookie[k]);
    list.appendChild(kk);
    list.appendChild(vv);
  });
  $('resultTitle').textContent = '登录成功（' + M.appName(state.app) + '）';
  $('result').hidden = false;
}

async function selfCheck() {
  if (!state.token) return;
  var btn = $('selfCheck');
  btn.disabled = true;
  try {
    var img = $('qrImg');
    if (!img.complete || !img.naturalWidth) img = await loadImage(state.token.uid);
    var text = decodeQrFromImage(img);
    if (!text) {
      setDot('err', '自检失败：jsQR 解不出二维码（图片太小或渲染异常）');
    } else if (M.scanPayloadMatches(text, state.token.uid)) {
      setDot('ok', '自检通过：二维码内容 = ' + text);
    } else {
      setDot('err', '自检失败：二维码内容与 uid 不符（' + text + '）');
    }
  } catch (e) {
    setDot('err', '自检失败：' + (e && e.message ? e.message : e));
  } finally {
    btn.disabled = false;
  }
}

function initAppSelect() {
  var sel = $('appSel');
  M.APP_SLOTS.forEach(function (slot) {
    var opt = document.createElement('option');
    opt.value = slot;
    opt.textContent = slot + '（' + M.appName(slot) + '）';
    sel.appendChild(opt);
  });
  // 默认 web，与脚本一致；当前已登录 web 时提醒会被踢下线
  sel.value = 'web';
  function refreshHint() {
    state.app = sel.value;
    $('appHint').textContent = '扫码需要某个二维码通道的 token（web/android/ios 等六个），你选的「' +
      M.appName(state.app) + '」决定兑换出来的 Cookie 被 115 标成哪种设备。';
    var noQr = M.QRCODE_TOKEN_APPS.indexOf(state.app) < 0;
    $('kickWarn').hidden = !noQr;
    $('kickWarn').innerHTML = noQr
      ? '「' + M.appName(state.app) + '」通道的 token 接口不返回二维码链接，仍然可以扫码；' +
        '注意扫码会把这个类型的旧设备踢下线（选「网页版」会让当前电脑的 115 网页登录失效）。'
      : '注意：用同一设备类型扫码，会把该类型已登录的设备踢下线（例如选「网页版」会让当前电脑的 115 网页登录失效）。';
  }
  sel.addEventListener('change', function () {
    refreshHint();
    if (state.token) getToken();
  });
  refreshHint();
}

document.addEventListener('DOMContentLoaded', function () {
  initAppSelect();
  diag('页面已就绪：jsQR ' + (typeof jsQR === 'function' ? '已加载' : '未加载') +
    '，设备 ' + M.appName(state.app));

  $('getToken').addEventListener('click', getToken);
  $('login').addEventListener('click', startPolling);
  $('cancel').addEventListener('click', function () {
    stopPolling('已取消轮询（二维码本身仍然有效）');
    $('login').disabled = false;
  });
  $('selfCheck').addEventListener('click', selfCheck);
  $('copyToken').addEventListener('click', function () { copyText(tokenJson(), $('copyToken')); });

  var copyBtns = document.querySelectorAll('#tokRows button');
  for (var i = 0; i < copyBtns.length; i++) {
    copyBtns[i].addEventListener('click', function (ev) {
      copyText(ev.currentTarget.getAttribute('data-copy') || '', ev.currentTarget);
    });
  }

  $('copyCookie').addEventListener('click', function () {
    if (state.result) copyText(cookieString(state.result.data.cookie), $('copyCookie'));
  });
  $('copyJson').addEventListener('click', function () {
    if (state.result) copyText(JSON.stringify(state.result, null, 2), $('copyJson'));
  });
  $('downloadJson').addEventListener('click', function () {
    if (!state.result) return;
    var blob = new Blob([JSON.stringify(state.result, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '115-cookie-' + state.app + '-' + Date.now() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });

  // 离开页面即停止轮询
  window.addEventListener('unload', function () { state.running = false; clearTimeout(state.timer); });
});