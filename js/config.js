// =====================================================================
//  Teamload — configuration. This is the ONLY file you need to edit.
// =====================================================================
window.EPIC_TASKS_CONFIG = {
  // Name Trello shows to users when they connect.
  APP_NAME: 'Teamload',

  // OPTION A (simpler) — "Trello auth".
  // Power-Up admin → your Power-Up → API key → Generate → paste the key here.
  APP_KEY: 'db911a1285f3dea96b9da17e648a2c35',

  // OPTION B — OAuth 2.0 (if the admin portal only offers this).
  // Fill in the Client ID and the Power-Up switches to OAuth 2.0 automatically.
  OAUTH2_CLIENT_ID: '',
  OAUTH2_SCOPES: ['read:board:trello', 'write:board:trello'],
  // If empty, <hosting URL>/auth-redirect.html is used.
  OAUTH2_REDIRECT_URI: '',
};
