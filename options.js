// options.js —— 设置页
'use strict';

var $ = function (id) { return document.getElementById(id); };
var KEYS = ['showFab', 'detectText', 'detectEd2k', 'savepath'];

var saveTipTimer = null;
function flashSaved() {
  var tip = $('saveTip');
  tip.classList.add('show');
  if (saveTipTimer) clearTimeout(saveTipTimer);
  saveTipTimer = setTimeout(function () { tip.classList.remove('show'); }, 1400);
}

document.addEventListener('DOMContentLoaded', function () {
  chrome.storage.sync.get({ showFab: true, detectText: true, detectEd2k: true, savepath: '' }, function (s) {
    for (var i = 0; i < KEYS.length; i++) {
      var key = KEYS[i];
      var el = $(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = Boolean(s[key]);
      else el.value = s[key] || '';
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_LOGIN_STATE' }, function (resp) {
    if (chrome.runtime.lastError) resp = null;
    var dot = $('dot');
    var text = $('statusText');
    if (resp && resp.loggedIn) {
      dot.className = 'dot ok';
      text.textContent = '已登录 115';
      $('uidText').textContent = 'UID：' + resp.uid;
    } else {
      dot.className = 'dot err';
      text.textContent = '未登录 115（点击下方按钮打开 115 登录）';
      $('uidText').textContent = '';
    }
  });

  $('open115').addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://115.com/?ct=login' });
  });

  for (var i = 0; i < KEYS.length; i++) {
    (function (key) {
      var el = $(key);
      if (!el) return;
      el.addEventListener('change', function () {
        var item = {};
        item[key] = el.type === 'checkbox' ? el.checked : el.value.trim();
        chrome.storage.sync.set(item, flashSaved);
      });
    })(KEYS[i]);
  }
});
