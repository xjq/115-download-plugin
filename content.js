// content.js —— 页面磁力链检测 + 浮动按钮 UI
(function () {
  'use strict';
  if (window.__M115_CONTENT__) return;
  window.__M115_CONTENT__ = true;

  var M = self.Magnet115;
  var URLS = M.URLS;

  var DEFAULT_SETTINGS = { showFab: true, detectText: true, detectEd2k: true };
  var settings = { showFab: true, detectText: true, detectEd2k: true };
  var links = new Map();     // key -> {type,url,key,name,sub}
  var itemState = new Map(); // key -> {status:'idle'|'busy'|'ok'|'err', message:''}

  // ============ 检测 ============

  function addLink(raw) {
    var info = M.describeLink(raw);
    if (!info) return false;
    if (info.type === 'ed2k' && !settings.detectEd2k) return false;
    if (links.has(info.key)) return false;
    links.set(info.key, info);
    return true;
  }

  function scanAnchors() {
    var added = 0;
    var nodes = document.querySelectorAll('a[href]');
    for (var i = 0; i < nodes.length; i++) {
      var href = (nodes[i].getAttribute('href') || '').trim();
      if (/^(magnet:|ed2k:)/i.test(href) && addLink(href)) added++;
    }
    return added;
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, INPUT: 1, SVG: 1, IFRAME: 1, OBJECT: 1, CANVAS: 1, AUDIO: 1, VIDEO: 1 };

  function scanTextNodes() {
    if (!settings.detectText || !document.body) return 0;
    var texts = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p || SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
        var v = node.nodeValue || '';
        if (v.length < 8) return NodeFilter.FILTER_REJECT;
        if (/magnet:\?xt=urn:btih:/i.test(v)) return NodeFilter.FILTER_ACCEPT;
        if (settings.detectEd2k && /ed2k:\/\/\|file\|/i.test(v)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_REJECT;
      }
    });
    var node;
    while ((node = walker.nextNode())) texts.push(node.nodeValue);
    var added = 0;
    for (var i = 0; i < texts.length; i++) {
      var found = M.parseLinks(texts[i], { ed2k: settings.detectEd2k });
      for (var j = 0; j < found.length; j++) {
        if (addLink(found[j].url)) added++;
      }
    }
    return added;
  }

  function scanAll() {
    var added = scanAnchors();
    added += scanTextNodes();
    if (added > 0) refreshUI();
    return links.size;
  }

  // ============ UI（Shadow DOM，避免被页面样式污染） ============

  var host = null;
  var shadow = null;
  var els = null;
  var toastTimer = null;
  var toastLinkUrl = '';
  var busy = false;

  var STYLE = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }',
    '.root { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }',
    '.root[hidden] { display: none; }',
    '.fab { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px 0 14px; border: none; border-radius: 22px; background: linear-gradient(135deg, #2BD06B, #0FA958); color: #fff; font-size: 14px; font-weight: 600; box-shadow: 0 6px 20px rgba(15,169,88,.45); cursor: pointer; user-select: none; transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }',
    '.fab:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(15,169,88,.5); }',
    '.fab:active { transform: translateY(0) scale(.97); }',
    '.fab svg { width: 18px; height: 18px; flex: none; }',
    '.fab .badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: #fff; color: #0FA958; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }',
    '.fab.busy { filter: grayscale(.35) brightness(.92); pointer-events: none; }',
    '.panel { width: min(390px, calc(100vw - 48px)); max-height: min(60vh, 500px); display: flex; flex-direction: column; background: #fff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.25); overflow: hidden; color: #1f2937; }',
    '.panel[hidden] { display: none; }',
    '.p-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: linear-gradient(135deg, #2BD06B, #0FA958); color: #fff; flex: none; }',
    '.p-title { font-size: 14px; font-weight: 600; }',
    '.p-close { background: transparent; border: none; color: #fff; font-size: 18px; line-height: 1; padding: 2px 8px; border-radius: 6px; cursor: pointer; }',
    '.p-close:hover { background: rgba(255,255,255,.22); }',
    '.p-list { list-style: none; overflow-y: auto; padding: 6px; flex: 1; }',
    '.p-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; }',
    '.p-item:hover { background: #f0fdf4; }',
    '.p-main { flex: 1; min-width: 0; }',
    '.p-name { font-size: 13px; font-weight: 500; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.p-sub { font-size: 11px; color: #9ca3af; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, Consolas, monospace; }',
    '.p-actions { display: flex; align-items: center; gap: 6px; flex: none; }',
    '.btn { border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; transition: all .15s ease; }',
    '.btn:hover { border-color: #0FA958; color: #0FA958; }',
    '.btn.primary { background: #0FA958; border-color: #0FA958; color: #fff; }',
    '.btn.primary:hover { background: #0c8f4c; }',
    '.btn:disabled { opacity: .6; cursor: default; }',
    '.btn.small { padding: 4px 10px; }',
    '.btn.done { background: #ecfdf5; border-color: #a7f3d0; color: #059669; }',
    '.btn.fail { background: #fef2f2; border-color: #fecaca; color: #dc2626; }',
    '.btn.busy { background: #f9fafb; border-color: #e5e7eb; color: #6b7280; }',
    '.icon-btn { border: none; background: transparent; color: #9ca3af; cursor: pointer; font-size: 14px; padding: 4px 7px; border-radius: 6px; }',
    '.icon-btn:hover { background: #e5e7eb; color: #374151; }',
    '.p-foot { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #f3f4f6; flex: none; }',
    '.p-empty { padding: 18px 10px; text-align: center; color: #9ca3af; font-size: 13px; }',
    '.toast { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: min(540px, calc(100vw - 40px)); padding: 10px 14px; border-radius: 12px; background: #111827; color: #f9fafb; font-size: 13px; box-shadow: 0 10px 30px rgba(0,0,0,.35); z-index: 2147483647; }',
    '.toast[hidden] { display: none; }',
    '.toast.ok { background: #065f46; }',
    '.toast.err { background: #7f1d1d; }',
    '.t-msg { flex: 1; min-width: 0; }',
    '.t-link { background: rgba(255,255,255,.16); color: #fff; border: none; border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; flex: none; }',
    '.t-link:hover { background: rgba(255,255,255,.3); }',
    '.t-close { background: transparent; border: none; color: rgba(255,255,255,.65); cursor: pointer; font-size: 16px; padding: 0 4px; flex: none; }'
  ].join('\n');

  var FAB_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4v7a6 6 0 0 0 12 0V4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M6 4v3M18 4v3" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M12 13v5m0 0-2.2-2.2M12 18l2.2-2.2" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var UI_HTML =
    '<div class="root" hidden>' +
      '<div class="panel" hidden>' +
        '<div class="p-head"><span class="p-title">检测到 <span class="count">0</span> 条链接</span><button class="p-close" data-act="close" title="收起">×</button></div>' +
        '<ul class="p-list"></ul>' +
        '<div class="p-foot">' +
          '<button class="btn primary" data-act="all">全部离线</button>' +
          '<button class="btn" data-act="tasks">任务列表</button>' +
          '<button class="btn" data-act="settings">设置</button>' +
        '</div>' +
      '</div>' +
      '<button class="fab" title="一键离线到 115 网盘">' + FAB_SVG + '<span>115 离线</span><span class="badge">0</span></button>' +
      '<div class="toast" hidden><span class="t-msg"></span><button class="t-link" hidden></button><button class="t-close" data-act="toast-close">×</button></div>' +
    '</div>';

  function ensureUI() {
    if (host && shadow && els) return true;
    if (!document.documentElement) return false;
    host = document.createElement('div');
    host.setAttribute('data-magnet115', 'host');
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    var styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    shadow.appendChild(styleEl);
    var wrap = document.createElement('div');
    wrap.innerHTML = UI_HTML;
    shadow.appendChild(wrap.firstElementChild);
    document.documentElement.appendChild(host);
    bindUI();
    return true;
  }

  function bindUI() {
    els = {
      root: shadow.querySelector('.root'),
      fab: shadow.querySelector('.fab'),
      badge: shadow.querySelector('.badge'),
      panel: shadow.querySelector('.panel'),
      count: shadow.querySelector('.count'),
      list: shadow.querySelector('.p-list'),
      toast: shadow.querySelector('.toast'),
      toastMsg: shadow.querySelector('.t-msg'),
      toastLink: shadow.querySelector('.t-link')
    };
    els.fab.addEventListener('click', onFabClick);
    els.root.addEventListener('click', onRootClick);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els && els.panel && !els.panel.hidden) {
        els.panel.hidden = true;
      }
    });
  }

  function hideUI() {
    if (!els) return;
    els.root.hidden = true;
    els.panel.hidden = true;
    hideToast();
  }

  function refreshUI(openPanel) {
    if (!settings.showFab || links.size === 0) {
      hideUI();
      return;
    }
    if (!ensureUI()) return;
    els.root.hidden = false;
    els.badge.textContent = String(links.size);
    els.count.textContent = String(links.size);
    renderList();
    if (openPanel) els.panel.hidden = false;
  }

  function renderList() {
    if (!els) return;
    els.list.innerHTML = '';
    links.forEach(function (info) {
      var st = itemState.get(info.key) || { status: 'idle', message: '' };
      var li = document.createElement('li');
      li.className = 'p-item';
      li.dataset.key = info.key;
      li.setAttribute('title', info.url);

      var main = document.createElement('div');
      main.className = 'p-main';
      var name = document.createElement('div');
      name.className = 'p-name';
      name.textContent = info.name;
      var sub = document.createElement('div');
      sub.className = 'p-sub';
      sub.textContent = info.sub;
      main.appendChild(name);
      main.appendChild(sub);

      var actions = document.createElement('div');
      actions.className = 'p-actions';
      var btn = document.createElement('button');
      btn.className = 'btn small primary';
      btn.dataset.act = 'one';
      if (st.status === 'busy') {
        btn.classList.remove('primary'); btn.classList.add('busy');
        btn.textContent = '提交中…';
        btn.disabled = true;
      } else if (st.status === 'ok') {
        btn.classList.remove('primary'); btn.classList.add('done');
        btn.textContent = st.message === '任务已存在' ? '已存在' : '✓ 已添加';
        btn.disabled = true;
        if (st.message) btn.title = st.message;
      } else if (st.status === 'err') {
        btn.classList.remove('primary'); btn.classList.add('fail');
        btn.textContent = '✗ 失败';
        btn.title = st.message || '提交失败';
      } else {
        btn.textContent = '离线';
      }
      var copy = document.createElement('button');
      copy.className = 'icon-btn';
      copy.dataset.act = 'copy';
      copy.title = '复制链接';
      copy.textContent = '⧉';
      actions.appendChild(btn);
      actions.appendChild(copy);

      li.appendChild(main);
      li.appendChild(actions);
      els.list.appendChild(li);
    });
  }

  // ============ 交互 ============

  function onFabClick() {
    if (busy) return;
    if (links.size === 1) {
      var only = null;
      links.forEach(function (v) { only = v; });
      submitLinks([only.url]);
    } else {
      els.panel.hidden = !els.panel.hidden;
      if (!els.panel.hidden) renderList();
    }
  }

  function onRootClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn || !els || !els.root.contains(btn)) return;
    var act = btn.getAttribute('data-act');
    var item = btn.closest('.p-item');
    var key = item ? item.getAttribute('data-key') : '';
    if (act === 'close') {
      els.panel.hidden = true;
    } else if (act === 'one') {
      var info = links.get(key);
      if (info) submitLinks([info.url]);
    } else if (act === 'copy') {
      var ci = links.get(key);
      if (ci) copyText(ci.url, btn);
    } else if (act === 'all') {
      var urls = [];
      links.forEach(function (v) { urls.push(v.url); });
      submitLinks(urls);
    } else if (act === 'tasks') {
      sendOpenUrl(URLS.tasks);
    } else if (act === 'settings') {
      try { chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }, function () { void chrome.runtime.lastError; }); } catch (err) { /* ignore */ }
    } else if (act === 'toast-close') {
      hideToast();
    } else if (act === 'toast-link') {
      if (toastLinkUrl) sendOpenUrl(toastLinkUrl);
    }
  }

  function sendOpenUrl(url) {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_URL', url: url }, function () { void chrome.runtime.lastError; });
    } catch (err) { /* ignore */ }
  }

  function setItemState(key, status, message) {
    itemState.set(key, { status: status, message: message || '' });
  }

  function errorText(r) {
    if (!r) return '';
    if (r.needLogin) return '未登录 115';
    if (r.needVerify) return '需要安全验证';
    return r.error || ('提交失败' + (r.errno != null ? '（errno ' + r.errno + '）' : ''));
  }

  function setFabBusy(v) {
    if (!els) return;
    if (v) els.fab.classList.add('busy');
    else els.fab.classList.remove('busy');
  }

  function submitLinks(urls) {
    if (busy) return;
    busy = true;
    setFabBusy(true);
    var keys = {};
    for (var i = 0; i < urls.length; i++) {
      var info = M.describeLink(urls[i]);
      if (info) { setItemState(info.key, 'busy', ''); keys[info.key] = true; }
    }
    renderList();

    var p;
    try {
      p = chrome.runtime.sendMessage({ type: 'ADD_TASKS', urls: urls });
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(function (resp) {
      busy = false;
      setFabBusy(false);
      handleResult(resp, urls);
    }, function () {
      busy = false;
      setFabBusy(false);
      for (var k in keys) setItemState(k, 'err', '扩展通信失败，请刷新页面后重试');
      renderList();
      showToast('扩展已重新加载，请刷新页面后重试', 'err');
    });
  }

  function handleResult(resp, urls) {
    if (!resp || typeof resp !== 'object') {
      showToast('提交失败：扩展返回异常', 'err');
      return;
    }
    var results = resp.results || [];
    var okCount = 0;
    var failCount = 0;
    var first = null;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var info = M.describeLink(r.url);
      if (info) {
        if (r.ok) {
          okCount++;
          setItemState(info.key, 'ok', r.exists ? '任务已存在' : (r.name || '已添加'));
        } else {
          failCount++;
          setItemState(info.key, 'err', errorText(r));
          if (!first) first = r;
        }
      }
    }
    // addTasks 可能在遇到登录/验证问题时提前中断，未返回的 URL 恢复初始状态
    if (results.length < urls.length) {
      for (var j = 0; j < urls.length; j++) {
        var info2 = M.describeLink(urls[j]);
        if (!info2) continue;
        var returned = false;
        for (var k = 0; k < results.length; k++) {
          if (M.linkKey(results[k].url) === info2.key) { returned = true; break; }
        }
        if (!returned) setItemState(info2.key, 'idle', '');
      }
    }
    renderList();

    if (!resp.ok && resp.error && !results.length) {
      showToast(resp.error, 'err');
      return;
    }
    if (okCount && !failCount) {
      showToast('已提交 ' + okCount + ' 个离线任务', 'ok', { label: '查看任务', url: URLS.tasks });
    } else if (okCount) {
      showToast('已提交 ' + okCount + ' 个，失败 ' + failCount + ' 个', 'err', { label: '查看任务', url: URLS.tasks });
    } else if (first) {
      if (first.needLogin) {
        showToast('未登录 115，请先登录后重试', 'err', { label: '去登录', url: URLS.login });
      } else if (first.needVerify) {
        showToast('115 需要安全验证，完成后重试即可', 'err', { label: '去验证', url: M.captchaUrl() });
      } else {
        showToast(errorText(first), 'err');
      }
    }
  }

  function showToast(message, type, link) {
    if (!els) return;
    els.toastMsg.textContent = message;
    els.toast.className = 'toast' + (type ? ' ' + type : '');
    if (link && link.url) {
      toastLinkUrl = link.url;
      els.toastLink.textContent = link.label || '打开';
      els.toastLink.hidden = false;
    } else {
      toastLinkUrl = '';
      els.toastLink.hidden = true;
    }
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, type === 'err' ? 8000 : 6000);
  }

  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (els) els.toast.hidden = true;
  }

  function copyText(text, btn) {
    var done = function (ok) {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = ok ? '✓' : '✗';
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        done(ok);
      } catch (e) { done(false); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  // ============ 设置 / 消息 ============

  function loadSettings(cb) {
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, function (s) {
        Object.assign(settings, DEFAULT_SETTINGS, s || {});
        if (cb) cb();
        refreshUI();
      });
    } catch (e) { /* ignore */ }
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      var changed = false;
      for (var k in DEFAULT_SETTINGS) {
        if (changes[k]) { settings[k] = changes[k].newValue; changed = true; }
      }
      if (!changed) return;
      if (!settings.detectEd2k) {
        links.forEach(function (v, key) {
          if (v.type === 'ed2k') links.delete(key);
        });
      }
      refreshUI();
    });
  } catch (e) { /* ignore */ }

  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'RESCAN') {
        var before = links.size;
        scanAll();
        refreshUI(true);
        sendResponse({ count: links.size, added: links.size - before });
      }
    });
  } catch (e) { /* ignore */ }

  // ============ 启动 ============

  var moTimer = null;
  function observeMutations() {
    if (typeof MutationObserver !== 'function' || !document.documentElement) return;
    var mo = new MutationObserver(function () {
      if (moTimer) return;
      moTimer = setTimeout(function () {
        moTimer = null;
        if (document.hidden) return;
        scanAll();
      }, 800);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scanAll();
    });
  }

  function init() {
    loadSettings();
    scanAll();
    setTimeout(scanAll, 1200);
    setTimeout(scanAll, 3500);
    setTimeout(scanAll, 8000);
    observeMutations();
    if (/115-show/.test(location.hash || '')) {
      // #115-show：自动打开面板（便于测试 / 快捷打开）
      setTimeout(function () {
        if (links.size > 0) refreshUI(true);
      }, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
