// Auth + REST helper. Supports legacy "Trello auth" (API key + token) and OAuth 2.0.
(function (root) {
  'use strict';
  var C = root.EPIC_TASKS_CONFIG;
  var useOAuth2 = !!C.OAUTH2_CLIENT_ID;

  function redirectUri() {
    if (C.OAUTH2_REDIRECT_URI) return C.OAUTH2_REDIRECT_URI;
    return new URL('auth-redirect.html', root.location.origin + root.location.pathname).href;
  }

  function iframeOptions() {
    var o = { appName: C.APP_NAME };
    if (useOAuth2) {
      o.clientId = C.OAUTH2_CLIENT_ID;
      o.redirectUri = redirectUri();
    } else {
      o.appKey = C.APP_KEY;
    }
    return o;
  }

  // The token is asked from Trello (a message to the parent page) once and kept for a few minutes: every
  // REST call needs it, and an epic makes several at once. A missing token is not kept, so connecting
  // takes effect at once; a 401 drops the kept one.
  var kept = null;
  var KEEP_MS = 5 * 60 * 1000;
  function fetchToken(t) {
    if (useOAuth2) {
      return Promise.resolve(t.getOAuth2ApiClient().getAccessToken()).catch(function () { return null; });
    }
    return Promise.resolve(t.getRestApi().getToken()).catch(function () { return null; });
  }
  function getToken(t) {
    if (kept && Date.now() - kept.at < KEEP_MS) return kept.p;
    var p = fetchToken(t);
    var k = kept = { at: Date.now(), p: p };
    p.then(function (tok) { if (!tok && kept === k) kept = null; });
    return p;
  }
  function forgetToken() { kept = null; }

  function isAuthorized(t) {
    return getToken(t).then(function (tok) { return !!tok; });
  }

  function authorize(t) {
    forgetToken();
    var p = useOAuth2 ? t.getOAuth2ApiClient().authorize({ scopes: C.OAUTH2_SCOPES })
      : t.getRestApi().authorize({ scope: 'read,write', expiration: 'never' });
    return Promise.resolve(p).then(function (v) { forgetToken(); return v; });
  }

  function AuthError(msg) { var e = new Error(msg); e.isAuthError = true; return e; }

  // params go to the query string; body (optional) is sent as JSON (custom fields need it).
  function request(t, method, path, params, body) {
    return getToken(t).then(function (token) {
      if (!token) throw AuthError('Connect to Trello first.');
      var base = useOAuth2 ? 'https://trello.com/1' : 'https://api.trello.com/1';
      var url = new URL(base + path);
      var headers = {};
      if (useOAuth2) {
        headers.Authorization = 'Bearer ' + token;
      } else {
        url.searchParams.set('key', C.APP_KEY);
        url.searchParams.set('token', token);
      }
      Object.keys(params || {}).forEach(function (k) {
        var v = params[k];
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
      var init = { method: method, headers: headers };
      if (body !== undefined && body !== null) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      return fetch(url.toString(), init).then(function (res) {
        if (res.status === 401) { forgetToken(); throw AuthError('Access denied (401). Please reconnect.'); }
        if (!res.ok) {
          return res.text().then(function (txt) {
            throw new Error('Trello API ' + res.status + ': ' + (txt || res.statusText));
          });
        }
        return res.status === 204 ? null : res.json();
      });
    });
  }

  root.EpicAuth = {
    useOAuth2: useOAuth2,
    iframeOptions: iframeOptions,
    isAuthorized: isAuthorized,
    authorize: authorize,
    request: request,
  };
})(this);
