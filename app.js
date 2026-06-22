(function () {
  'use strict';

  var cfg = window.SAFE_TALK_CONFIG || {};
  var FALLBACK_BUILD_VERSION = '20260622-gas-delay-2';
  var memoryStore = {};
  var pendingRequests = {};

  var DEFAULT_TIMEOUT_MS = 30000;
  var POLL_TIMEOUT_MS = 18000;
  var WRITE_TIMEOUT_MS = 45000;

  function getBuildVersion() {
    return String(window.SAFE_TALK_BUILD_VERSION || cfg.BUILD_VERSION || FALLBACK_BUILD_VERSION);
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key) || ''; }
    catch (e) { return memoryStore[key] || ''; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, String(value == null ? '' : value)); }
    catch (e) { memoryStore[key] = String(value == null ? '' : value); }
  }

  function storageRemove(key) {
    try { window.localStorage.removeItem(key); }
    catch (e) { delete memoryStore[key]; }
  }

  function fromQuery(name) {
    var query = String(window.location.search || '').replace(/^\?/, '');
    if (!query) return '';
    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split('=');
      var key = decodeURIComponent((pair[0] || '').replace(/\+/g, ' '));
      if (key === name) {
        return decodeURIComponent((pair.slice(1).join('=') || '').replace(/\+/g, ' '));
      }
    }
    return '';
  }

  function appendParam(url, key, value) {
    var hash = '';
    var hashIndex = url.indexOf('#');
    if (hashIndex >= 0) {
      hash = url.slice(hashIndex);
      url = url.slice(0, hashIndex);
    }
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + encodeURIComponent(key) + '=' + encodeURIComponent(value == null ? '' : String(value)) + hash;
  }

  function buildUrl(base, params) {
    var url = String(base || '');
    var keys = Object.keys(params || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = params[k];
      if (v === undefined || v === null) continue;
      url = appendParam(url, k, v);
    }
    return url;
  }

  var apiFromQuery = fromQuery('api');
  if (apiFromQuery) storageSet('SAFE_TALK_GAS_API_URL', apiFromQuery);

  function getGasUrl() {
    var v = cfg.GAS_API_URL || storageGet('SAFE_TALK_GAS_API_URL') || '';
    if (v === 'PASTE_GAS_WEB_APP_EXEC_URL_HERE') return '';
    return String(v || '').trim();
  }

  function setGasUrl(url) {
    if (url) storageSet('SAFE_TALK_GAS_API_URL', String(url).trim());
  }

  function simpleHash(input) {
    var str = String(input || '');
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(36);
  }

  function randomId(prefix) {
    return String(prefix || 'r') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  }

  function isPollAction(action) {
    return action === 'getRevealState' || action === 'getDisplayState';
  }

  function isWriteAction(action) {
    return action === 'submitOpinion' ||
      action === 'castVote' ||
      action === 'adoptOpinion' ||
      action === 'dismissOpinion' ||
      action === 'addCustomCurated' ||
      action === 'moveCurated' ||
      action === 'deleteCurated' ||
      action === 'setCurrentReveal' ||
      action === 'nextReveal' ||
      action === 'prevReveal' ||
      action === 'toggleVoting' ||
      action === 'resetTallies' ||
      action === 'resetAll';
  }

  function stableStringify(obj) {
    obj = obj || {};
    var keys = Object.keys(obj).sort();
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'callback' || k === '_ts' || k === '_v') continue;
      out.push(k + '=' + String(obj[k]));
    }
    return out.join('&');
  }

  function normalizeError(err) {
    var msg = String((err && err.message) ? err.message : (err || ''));
    if (msg.indexOf('응답 지연') >= 0) return 'GAS 서버 응답이 지연되고 있습니다. 자동 갱신은 계속됩니다.';
    if (msg.indexOf('호출 실패') >= 0) return 'GAS 연결에 실패했습니다. 배포 URL과 권한을 확인하세요.';
    return msg || '처리 중 오류가 발생했습니다.';
  }

  function prepareParams(action, params, opts) {
    params = params || {};
    opts = opts || {};

    var out = {};
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null) return;
      out[k] = String(v);
    });

    if (action === 'submitOpinion') {
      var text = String(out.text || '').trim();
      var category = String(out.category || 'serious');
      var source = String(out.source || 'live');
      var contentKey = 'SAFE_TALK_PENDING_SUBMIT_' + simpleHash(source + '|' + category + '|' + text);
      var requestId = out.requestId || storageGet(contentKey);
      if (!requestId) {
        requestId = randomId('op');
        storageSet(contentKey, requestId);
      }
      out.requestId = requestId;
      opts.__submitContentKey = contentKey;
    }

    return out;
  }

  function getTimeout(action, opts) {
    if (opts && opts.timeout) return opts.timeout;
    if (isPollAction(action)) return POLL_TIMEOUT_MS;
    if (isWriteAction(action)) return WRITE_TIMEOUT_MS;
    return DEFAULT_TIMEOUT_MS;
  }

  function getDedupeKey(action, params, opts) {
    if (opts && opts.noDedupe) return '';
    if (isPollAction(action)) return 'poll::' + action + '::' + stableStringify(params);
    return '';
  }

  function jsonp(action, params, opts) {
    opts = opts || {};
    params = prepareParams(action, params || {}, opts);

    var base = getGasUrl();
    if (!base) {
      return Promise.reject(new Error('GAS_API_URL이 설정되지 않았습니다. config.js에 GAS /exec URL을 입력하세요.'));
    }

    var dedupeKey = getDedupeKey(action, params, opts);
    if (dedupeKey && pendingRequests[dedupeKey]) {
      return pendingRequests[dedupeKey];
    }

    var promise = new Promise(function (resolve, reject) {
      var cbName = '__safeTalkCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var timer;
      var finished = false;
      var script = document.createElement('script');

      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = function (res) {
        if (finished) return;
        finished = true;
        cleanup();
        if (action === 'submitOpinion' && res && res.ok && opts.__submitContentKey) {
          storageRemove(opts.__submitContentKey);
        }
        resolve(res || {});
      };

      var apiParams = {
        action: action,
        callback: cbName,
        _ts: Date.now(),
        _v: getBuildVersion()
      };
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === undefined || v === null) return;
        apiParams[k] = String(v);
      });

      script.onerror = function () {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error('GAS API 호출 실패: 배포 권한, /exec URL, 네트워크를 확인하세요.'));
      };
      script.async = true;
      script.src = buildUrl(base, apiParams);
      document.head.appendChild(script);

      timer = setTimeout(function () {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error('GAS API 응답 지연: 잠시 후 다시 시도하세요.'));
      }, getTimeout(action, opts));
    });

    if (dedupeKey) {
      pendingRequests[dedupeKey] = promise;
      promise.then(function () { delete pendingRequests[dedupeKey]; })
        .catch(function () { delete pendingRequests[dedupeKey]; });
    }

    return promise;
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function toast(msg, id) {
    var el = document.getElementById(id || 'toast');
    if (!el) {
      alert(msg);
      return;
    }
    el.textContent = msg;
    el.classList.add('on');
    el.classList.add('show');
    clearTimeout(el.__tt);
    el.__tt = setTimeout(function () {
      el.classList.remove('on');
      el.classList.remove('show');
    }, 2400);
  }

  function getClientId() {
    var k = 'SAFE_TALK_CLIENT_ID';
    var v = storageGet(k);
    if (!v) {
      v = randomId('c');
      storageSet(k, v);
    }
    return v;
  }

  function votedKey(id) { return 'SAFE_TALK_VOTED_' + id; }
  function voted(id) { return !!id && storageGet(votedKey(id)) === '1'; }
  function markVoted(id) { if (id) storageSet(votedKey(id), '1'); }
  function clearVoted(id) { if (id) storageRemove(votedKey(id)); }

  function makePageUrl(fileName) {
    var href = String(window.location.href || '');
    var noHash = href.split('#')[0];
    var noQuery = noHash.split('?')[0];
    var slash = noQuery.lastIndexOf('/');
    var base = (slash >= 0 ? noQuery.substring(0, slash + 1) : '') + fileName;
    var query = { v: getBuildVersion() };
    var api = fromQuery('api');
    if (api && !cfg.GAS_API_URL) query.api = api;
    return buildUrl(base, query);
  }

  function showSetupIfNeeded(targetId) {
    if (getGasUrl()) return false;
    var target = document.getElementById(targetId || 'setup');
    if (!target) return true;
    target.innerHTML =
      '<div style="background:#fff;border:2px solid #FF6B5B;border-radius:14px;padding:16px;margin:14px 0;color:#1B2A4A;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere">' +
      '<b>GAS API URL 설정 필요</b><br>' +
      'GitHub <code>config.js</code>의 <code>GAS_API_URL</code>에 Apps Script 웹앱 <code>/exec</code> URL을 입력해야 동작합니다.<br>' +
      '<input id="setupApiUrl" placeholder="https://script.google.com/macros/s/.../exec" style="width:100%;margin-top:10px;padding:12px;border:1px solid #D7DEE8;border-radius:8px;font-size:16px">' +
      '<button id="setupSave" style="margin-top:8px;width:100%;min-height:44px;padding:11px;border:0;border-radius:8px;background:#1B2A4A;color:#fff;font-weight:bold;font-family:inherit">이 브라우저에 임시 저장</button>' +
      '</div>';
    setTimeout(function () {
      var btn = document.getElementById('setupSave');
      if (btn) {
        btn.onclick = function () {
          var input = document.getElementById('setupApiUrl');
          setGasUrl(input && input.value);
          var base = window.location.href.split('#')[0].split('?')[0];
          window.location.replace(appendParam(base, 'v', getBuildVersion()));
        };
      }
    }, 0);
    return true;
  }

  function getAdminKey() {
    return storageGet('SAFE_TALK_ADMIN_KEY') || '';
  }

  function setAdminKey(v) {
    storageSet('SAFE_TALK_ADMIN_KEY', String(v || ''));
  }

  function adminApi(action, params, opts) {
    params = params || {};
    params.adminKey = getAdminKey();
    return jsonp(action, params, opts);
  }

  window.SafeTalk = {
    cfg: cfg,
    buildVersion: getBuildVersion(),
    api: jsonp,
    adminApi: adminApi,
    esc: esc,
    toast: toast,
    normalizeError: normalizeError,
    getClientId: getClientId,
    voted: voted,
    markVoted: markVoted,
    clearVoted: clearVoted,
    votedKey: votedKey,
    makePageUrl: makePageUrl,
    getGasUrl: getGasUrl,
    setGasUrl: setGasUrl,
    getAdminKey: getAdminKey,
    setAdminKey: setAdminKey,
    showSetupIfNeeded: showSetupIfNeeded,
    storageGet: storageGet,
    storageSet: storageSet,
    storageRemove: storageRemove,
    buildUrl: buildUrl
  };
})();
