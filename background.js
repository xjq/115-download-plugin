// background.js —— Service Worker：调用 115 离线下载接口
'use strict';

importScripts('shared.js');

var M = self.Magnet115;

var API_SPACE = 'https://115.com/?ct=offline&ac=space';
var API_ADD_TASK = 'https://115.com/web/lixian/?ct=lixian&ac=add_task_url';

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.sync.get({ savepath: '' }, function (s) {
      resolve(s || { savepath: '' });
    });
  });
}

// ---------- 115 登录态（读取浏览器中 115.com 的 Cookie） ----------

async function getCredential() {
  var cookies = await chrome.cookies.getAll({ domain: '115.com' });
  function pick(name) {
    var c = null;
    for (var i = 0; i < cookies.length; i++) {
      if (cookies[i].name === name) { c = cookies[i]; break; }
    }
    return c ? String(c.value) : '';
  }
  var uid = pick('UID');
  var cid = pick('CID');
  var seid = pick('SEID');
  return { uid: uid, cid: cid, seid: seid, loggedIn: Boolean(uid && cid && seid) };
}

// ---------- 115 离线接口 ----------

// 离线接口需要 sign + time，通过已登录会话访问 space 接口获取
async function fetchSign() {
  var resp;
  try {
    resp = await fetch(API_SPACE + '&_=' + Date.now(), {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json, text/plain, */*' },
      cache: 'no-store'
    });
  } catch (e) {
    return { ok: false, error: '网络请求失败：' + (e && e.message ? e.message : e) };
  }
  var text = '';
  try { text = (await resp.text()).trim(); } catch (e) { /* ignore */ }
  if (!text || text.charCodeAt(0) === 60 || /<!doctype|<html/i.test(text)) {
    // 返回 HTML 说明登录态失效
    return { ok: false, needLogin: true };
  }
  var json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  if (json && json.sign && json.time) {
    return { ok: true, sign: String(json.sign), time: String(json.time) };
  }
  if (json && (json.state === false || Number(json.errno) === 99)) {
    return { ok: false, needLogin: true };
  }
  var errno = json && json.errno != null ? 'errno ' + json.errno : '响应异常';
  return { ok: false, error: '无法获取离线接口签名（' + errno + '）' };
}

// 提交单个离线任务（magnet / ed2k / http 链接）
async function addTask(url, savepath) {
  var cred = await getCredential();
  if (!cred.loggedIn) {
    return { ok: false, needLogin: true, error: '未登录 115' };
  }

  var sign = await fetchSign();
  if (!sign.ok) return sign;

  var body = new URLSearchParams();
  body.set('url', url);
  body.set('uid', cred.uid);
  body.set('sign', sign.sign);
  body.set('time', sign.time);
  if (savepath) body.set('savepath', savepath);

  var resp;
  try {
    resp = await fetch(API_ADD_TASK, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
      cache: 'no-store'
    });
  } catch (e) {
    return { ok: false, error: '网络请求失败：' + (e && e.message ? e.message : e) };
  }

  var text = '';
  try { text = (await resp.text()).trim(); } catch (e) { /* ignore */ }
  var json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }

  if (!json) {
    return { ok: false, needLogin: true, error: '115 返回异常（可能登录已过期）' };
  }
  if (json.state === 1 || json.state === true) {
    return { ok: true, name: json.name || '', infoHash: json.info_hash || '' };
  }

  var errno = Number(json.errno);
  var msg = String(json.error_msg || json.errMsg || '');

  if (errno === 911) {
    return { ok: false, needVerify: true, error: msg || '需要安全验证' };
  }
  if (errno === 99 || (json.state === false && !msg)) {
    return { ok: false, needLogin: true, error: msg || '账号未登录或登录已过期' };
  }
  if (msg && /已存在|重复/.test(msg)) {
    return { ok: true, exists: true, name: json.name || '', error: msg };
  }
  return {
    ok: false,
    errno: errno,
    error: msg || ('提交失败（errno ' + errno + '）')
  };
}

// 批量提交（顺序执行，避免触发风控）
async function addTasks(urls) {
  var valid = [];
  var seen = {};
  var list = Array.isArray(urls) ? urls : [];
  for (var i = 0; i < list.length; i++) {
    var info = M.describeLink(list[i]);
    if (!info) continue;
    if (seen[info.key]) continue;
    seen[info.key] = true;
    valid.push(info.url);
  }
  if (!valid.length) {
    return { ok: false, error: '未识别到有效的磁力 / ed2k 链接' };
  }

  var settings = await getSettings();
  var results = [];
  for (var j = 0; j < valid.length; j++) {
    var r = await addTask(valid[j], settings.savepath);
    results.push({ url: valid[j], ok: r.ok, name: r.name, error: r.error, errno: r.errno, needLogin: r.needLogin, needVerify: r.needVerify, exists: r.exists });
    if (j < valid.length - 1) {
      if (r.needLogin || r.needVerify) break; // 登录/验证问题无需继续
      await sleep(500);
    }
  }
  return {
    ok: results.length > 0 && results.every(function (x) { return x.ok; }),
    results: results
  };
}

// ---------- 通知 ----------

function notify(message, title) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: title || '115 磁力离线助手',
      message: String(message).slice(0, 280)
    }, function () { void chrome.runtime.lastError; });
  } catch (e) { /* ignore */ }
}

chrome.notifications.onClicked.addListener(function () {
  chrome.tabs.create({ url: M.URLS.tasks });
});

// ---------- 消息路由 ----------

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    try {
      if (!msg || typeof msg.type !== 'string') {
        sendResponse({ ok: false, error: '未知消息' });
        return;
      }
      switch (msg.type) {
        case 'ADD_TASKS': {
          var res = await addTasks(msg.urls || []);
          sendResponse(res);
          return;
        }
        case 'GET_LOGIN_STATE': {
          var cred = await getCredential();
          sendResponse({ loggedIn: cred.loggedIn, uid: cred.loggedIn ? cred.uid : '' });
          return;
        }
        case 'OPEN_URL': {
          if (typeof msg.url === 'string' && /^https?:\/\//i.test(msg.url)) {
            chrome.tabs.create({ url: msg.url });
          }
          sendResponse({ ok: true });
          return;
        }
        case 'OPEN_OPTIONS': {
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: '未知消息类型：' + msg.type });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();
  return true; // 异步 sendResponse
});

// ---------- 右键菜单 ----------

function setupContextMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: 'm115-selection',
      title: '离线到 115：“%s”',
      contexts: ['selection']
    }, function () { void chrome.runtime.lastError; });

    // 尝试限定只对 magnet/ed2k 链接显示；
    // 若浏览器不接受自定义 scheme 的 targetUrlPatterns，则退化为普通链接菜单
    chrome.contextMenus.create({
      id: 'm115-link',
      title: '离线此链接到 115（磁力/ed2k）',
      contexts: ['link'],
      targetUrlPatterns: ['magnet:*', 'ed2k:*']
    }, function () {
      if (chrome.runtime.lastError) {
        chrome.contextMenus.create({
          id: 'm115-link',
          title: '离线此链接到 115（磁力/ed2k）',
          contexts: ['link']
        }, function () { void chrome.runtime.lastError; });
      }
    });
  });
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

chrome.contextMenus.onClicked.addListener(async function (info) {
  var urls = [];
  if (info.menuItemId === 'm115-link' && info.linkUrl) {
    urls = [info.linkUrl];
  } else if (info.menuItemId === 'm115-selection' && info.selectionText) {
    var found = M.parseLinks(info.selectionText, { allowBareHash: true });
    urls = found.map(function (x) { return x.url; });
  }
  if (!urls.length) {
    notify('未识别到磁力 / ed2k 链接');
    return;
  }

  var res = await addTasks(urls);
  var results = res.results || [];
  var okCount = 0;
  var parts = [];
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.ok) {
      okCount++;
      var name = r.name || '任务';
      parts.push('✓ ' + name);
    } else {
      parts.push('✗ ' + (r.error || '提交失败'));
    }
  }
  var summary;
  if (okCount === results.length && results.length > 0) {
    summary = '已提交 ' + okCount + ' 个离线任务';
  } else if (okCount > 0) {
    summary = '提交 ' + okCount + ' 个，失败 ' + (results.length - okCount) + ' 个';
  } else {
    var first = results[0];
    if (first && first.needLogin) {
      notify('未登录 115，请先登录 115 网页版后重试');
      chrome.tabs.create({ url: M.URLS.login });
      return;
    }
    if (first && first.needVerify) {
      notify('115 需要安全验证，请在打开的页面完成验证后重试');
      chrome.tabs.create({ url: M.captchaUrl() });
      return;
    }
    summary = first ? (first.error || '提交失败') : '提交失败';
  }
  notify(summary + (parts.length ? '\n' + parts.join('\n') : ''));
});
