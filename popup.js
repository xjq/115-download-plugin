// popup.js —— 工具栏弹窗
'use strict';

var $ = function (id) { return document.getElementById(id); };

function setLoginState(state) {
  var dot = $('dot');
  var text = $('statusText');
  var uid = $('uidText');
  if (state && state.loggedIn) {
    dot.className = 'dot ok';
    text.textContent = '已登录 115';
    uid.textContent = 'UID：' + state.uid;
  } else {
    dot.className = 'dot err';
    text.textContent = '未登录 115（点击“打开 115 网盘”登录）';
    uid.textContent = '';
  }
}

document.addEventListener('DOMContentLoaded', function () {
  chrome.runtime.sendMessage({ type: 'GET_LOGIN_STATE' }, function (resp) {
    if (chrome.runtime.lastError) { setLoginState(null); return; }
    setLoginState(resp);
  });

  $('openTasks').addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://115.com/?cid=0&offset=0&tab=download&mode=wangpan' });
  });
  $('open115').addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://115.com/' });
  });
  $('openSettings').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });
  $('openLogin').addEventListener('click', function () {
    var url = chrome.runtime.getURL('login.html');
    var tip = $('tip');
    // 先自己建标签页：不依赖 Service Worker 消息往返，点了一定有反应
    chrome.tabs.create({ url: url }, function () {
      if (chrome.runtime.lastError) {
        tip.textContent = '打开失败：' + chrome.runtime.lastError.message;
        return;
      }
      window.close();
    });
  });

  $('rescan').addEventListener('click', async function () {
    var out = $('scanResult');
    out.textContent = '扫描中…';
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs && tabs[0];
      if (!tab || tab.id == null) throw new Error('no tab');
      var res = await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' });
      if (res && res.count > 0) {
        out.textContent = '检测到 ' + res.count + ' 条链接';
      } else {
        out.textContent = '未检测到磁力链';
      }
    } catch (e) {
      out.textContent = '当前页面不可扫描';
    }
  });
});
