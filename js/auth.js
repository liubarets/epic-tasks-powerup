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

  function getToken(t) {
    if (useOAuth2) {
      return Promise.resolve(t.getOAuth2ApiClient().getAccessToken()).catch(function () { return null; });
    }
    return Promise.resolve(t.getRestApi().getToken()).catch(function () { return null; });
  }

  function isAuthorized(t) {
    return getToken(t).then(function (tok) { return !!tok; });
  }

  function authorize(t) {
    if (useOAuth2) return t.getOAuth2ApiClient().authorize({ scopes: C.OAUTH2_SCOPES });
    return t.getRestApi().authorize({ scope: 'read,write', expiration: 'never' });
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
        if (res.status === 401) throw AuthError('Access denied (401). Please reconnect.');
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
