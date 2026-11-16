// shared.js —— 磁力 / ed2k 链接解析与规范化
// 同时作为 content script 与 service worker 的公共模块：
//  - content_scripts: ["shared.js", "content.js"]
//  - background.js:   importScripts('shared.js')

(function (global) {
  'use strict';

  var HEX40_RE = /^[a-f0-9]{40}$/i;
  var BASE32_RE = /^[a-z2-7]{32}$/i;
  var MAGNET_TEXT_RE = /magnet:\?xt=urn:btih:[a-z0-9]{32,40}[^<>"'\s`]*/gi;
  var ED2K_TEXT_RE = /ed2k:\/\/\|file\|[^|<>"'\s]*\|\d+\|[0-9a-f]{32}\|[^|<>"'\s]*\|/gi;

  var URLS = {
    tasks: 'https://115.com/?cid=0&offset=0&tab=download&mode=wangpan',
    login: 'https://115.com/?ct=login',
    home: 'https://115.com/'
  };

  function captchaUrl() {
    return 'https://captchaapi.115.com/?ac=security_code&type=web&client=pc' +
      '&cb=Close' + Math.floor(1000 + Math.random() * 9000) + '_' + Date.now();
  }

  function trimUrlTail(u) {
    // 去掉文本中可能粘在链接末尾的标点 / 引号
    return String(u).replace(/[\s.,;:!?)\]}'"\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u201d\u2019\u300b\u3009]+$/g, '');
  }

  function btihOf(magnet) {
    var m = /xt=urn:btih:([a-z0-9]{32,40})/i.exec(String(magnet));
    if (!m) return '';
    var h = m[1].toLowerCase();
    if (!HEX40_RE.test(h) && !BASE32_RE.test(h)) return '';
    return h;
  }

  // 规范化 magnet URI；输入也可以是 40 位十六进制哈希（裸哈希）
  function normalizeMagnet(raw) {
    if (!raw) return null;
    var s = trimUrlTail(String(raw).trim());
    if (!s) return null;
    if (!/^magnet:/i.test(s)) {
      var bare = s.toLowerCase();
      if (HEX40_RE.test(bare) || BASE32_RE.test(bare)) {
        return 'magnet:?xt=urn:btih:' + bare;
      }
      return null;
    }
    try {
      var u = new URL(s);
      var hash = btihOf('xt=' + (u.searchParams.get('xt') || ''));
      if (!hash) return null;
      var parts = ['xt=urn:btih:' + hash];
      var dn = u.searchParams.get('dn');
      if (dn) parts.push('dn=' + encodeURIComponent(dn));
      var trs = u.searchParams.getAll('tr');
      for (var i = 0; i < trs.length; i++) parts.push('tr=' + encodeURIComponent(trs[i]));
      return 'magnet:?' + parts.join('&');
    } catch (e) {
      return null;
    }
  }

  function normalizeEd2k(raw) {
    if (!raw) return null;
    var s = trimUrlTail(String(raw).trim());
    if (!/^ed2k:\/\//i.test(s)) return null;
    if (!/^ed2k:\/\/\|file\|[^|]*\|\d+\|[0-9a-f]{32}\|/i.test(s)) return null;
    return s;
  }

  function linkKey(url) {
    var h = btihOf(url);
    if (h) return 'btih:' + h;
    return 'url:' + String(url).toLowerCase();
  }

  function magnetName(url) {
    try {
      var u = new URL(url);
      var dn = u.searchParams.get('dn');
      if (dn) return dn;
    } catch (e) { /* ignore */ }
    var h = btihOf(url);
    return h ? 'btih:' + h.slice(0, 12) + '…' : '磁力链接';
  }

  function ed2kName(url) {
    var m = /^ed2k:\/\/\|file\|([^|]*)\|/i.exec(String(url));
    if (m && m[1]) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    return 'ED2K 链接';
  }

  function shortHash(url) {
    var h = btihOf(url);
    if (!h) return '';
    return 'btih:' + h.slice(0, 10) + (h.length > 10 ? '…' : '');
  }

  // 返回 { type, url, key, name, sub }；无法识别返回 null
  function describeLink(raw) {
    if (!raw) return null;
    var magnet = normalizeMagnet(raw);
    if (magnet) {
      return {
        type: 'magnet',
        url: magnet,
        key: linkKey(magnet),
        name: magnetName(magnet),
        sub: shortHash(magnet)
      };
    }
    var ed2k = normalizeEd2k(raw);
    if (ed2k) {
      return {
        type: 'ed2k',
        url: ed2k,
        key: linkKey(ed2k),
        name: ed2kName(ed2k),
        sub: 'ed2k'
      };
    }
    return null;
  }

  // 从任意文本中提取链接列表
  // opts.allowBareHash: 允许 40 位十六进制裸哈希（仅建议用于用户明确选中的文本）
  // opts.ed2k: 是否识别 ed2k 链接
  function parseLinks(text, opts) {
    var options = opts || {};
    var out = [];
    var seen = {};
    function push(raw) {
      var info = describeLink(raw);
      if (!info) return;
      if (options.ed2k === false && info.type === 'ed2k') return;
      if (seen[info.key]) return;
      seen[info.key] = true;
      out.push(info);
    }
    var s = String(text || '');
    if (!s) return out;
    var re;
    var m;
    re = new RegExp(MAGNET_TEXT_RE.source, 'gi');
    while ((m = re.exec(s)) !== null) push(m[0]);
    if (options.ed2k !== false) {
      re = new RegExp(ED2K_TEXT_RE.source, 'gi');
      while ((m = re.exec(s)) !== null) push(m[0]);
    }
    if (options.allowBareHash) {
      re = /\b[a-f0-9]{40}\b/gi;
      while ((m = re.exec(s)) !== null) push(m[0]);
    }
    return out;
  }

  global.Magnet115 = {
    URLS: URLS,
    captchaUrl: captchaUrl,
    normalizeMagnet: normalizeMagnet,
    normalizeEd2k: normalizeEd2k,
    describeLink: describeLink,
    parseLinks: parseLinks,
    linkKey: linkKey,
    btihOf: btihOf
  };
})(typeof self !== 'undefined' ? self : globalThis);
