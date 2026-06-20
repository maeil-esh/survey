(function () {
  'use strict';

  var cfg = window.SAFE_TALK_CONFIG || {};

  function fromQuery(name) {
    try { return new URLSearchParams(location.search).get(name) || ''; }
    catch (e) { return ''; }
  }

  var apiFromQuery = fromQuery('api');
  if (apiFromQuery) localStorage.setItem('SAFE_TALK_GAS_API_URL', apiFromQuery);

  function getGasUrl() {
    var v = cfg.GAS_API_URL || localStorage.getItem('SAFE_TALK_GAS_API_URL') || '';
    if (v === 'PASTE_GAS_WEB_APP_EXEC_URL_HERE') return '';
    return v;
  }

  function setGasUrl(url) {
    if (url) localStorage.setItem('SAFE_TALK_GAS_API_URL', url.trim());
  }

  function jsonp(action, params, opts) {
    opts = opts || {};
    params = params || {};

    var base = getGasUrl();
    if (!base) {
      return Promise.reject(new Error('GAS_API_URL이 설정되지 않았습니다. config.js에 GAS /exec URL을 입력하세요.'));
    }

    return new Promise(function (resolve, reject) {
      var cbName = '__safeTalkCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var timer;
      var script = document.createElement('script');

      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = function (res) {
        cleanup();
        resolve(res || {});
      };

      var url = new URL(base);
      url.searchParams.set('action', action);
      url.searchParams.set('callback', cbName);
      url.searchParams.set('_ts', Date.now());
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === undefined || v === null) return;
        url.searchParams.set(k, String(v));
      });

      script.onerror = function () {
        cleanup();
        reject(new Error('GAS API 호출 실패: 배포 권한, /exec URL, 네트워크를 확인하세요.'));
      };
      script.src = url.toString();
      document.head.appendChild(script);

      timer = setTimeout(function () {
        cleanup();
        reject(new Error('GAS API 응답 지연: 잠시 후 다시 시도하세요.'));
      }, opts.timeout || 12000);
    });
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
    clearTimeout(el.__tt);
    el.__tt = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }

  function getClientId() {
    var k = 'SAFE_TALK_CLIENT_ID';
    var v = localStorage.getItem(k);
    if (!v) {
      v = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(k, v);
    }
    return v;
  }

  function votedKey(id) { return 'SAFE_TALK_VOTED_' + id; }
  function voted(id) { return !!id && localStorage.getItem(votedKey(id)) === '1'; }
  function markVoted(id) { if (id) localStorage.setItem(votedKey(id), '1'); }

  function makePageUrl(fileName) {
    var url = new URL(location.href);
    var path = url.pathname;
    var dir = path.substring(0, path.lastIndexOf('/') + 1);
    url.pathname = dir + fileName;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function showSetupIfNeeded(targetId) {
    if (getGasUrl()) return false;
    var target = document.getElementById(targetId || 'setup');
    if (!target) return true;
    target.innerHTML =
      '<div style="background:#fff;border:2px solid #FF6B5B;border-radius:14px;padding:16px;margin:14px 0;color:#1B2A4A;line-height:1.5">' +
      '<b>GAS API URL 설정 필요</b><br>' +
      'GitHub <code>config.js</code>의 <code>GAS_API_URL</code>에 Apps Script 웹앱 <code>/exec</code> URL을 입력해야 동작합니다.<br>' +
      '<input id="setupApiUrl" placeholder="https://script.google.com/macros/s/.../exec" style="width:100%;margin-top:10px;padding:10px;border:1px solid #D7DEE8;border-radius:8px">' +
      '<button id="setupSave" style="margin-top:8px;width:100%;padding:11px;border:0;border-radius:8px;background:#1B2A4A;color:#fff;font-weight:bold">이 브라우저에 임시 저장</button>' +
      '</div>';
    setTimeout(function () {
      var btn = document.getElementById('setupSave');
      if (btn) {
        btn.onclick = function () {
          var input = document.getElementById('setupApiUrl');
          setGasUrl(input && input.value);
          location.reload();
        };
      }
    }, 0);
    return true;
  }

  function getAdminKey() {
    return localStorage.getItem('SAFE_TALK_ADMIN_KEY') || '';
  }

  function setAdminKey(v) {
    localStorage.setItem('SAFE_TALK_ADMIN_KEY', String(v || ''));
  }

  function adminApi(action, params) {
    params = params || {};
    params.adminKey = getAdminKey();
    return jsonp(action, params);
  }

  window.SafeTalk = {
    cfg: cfg,
    api: jsonp,
    adminApi: adminApi,
    esc: esc,
    toast: toast,
    getClientId: getClientId,
    voted: voted,
    markVoted: markVoted,
    votedKey: votedKey,
    makePageUrl: makePageUrl,
    getGasUrl: getGasUrl,
    setGasUrl: setGasUrl,
    getAdminKey: getAdminKey,
    setAdminKey: setAdminKey,
    showSetupIfNeeded: showSetupIfNeeded
  };
})();
