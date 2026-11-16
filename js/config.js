// =====================================================================
//  Epic Tasks — конфігурація. Це ЄДИНИЙ файл, який треба відредагувати.
// =====================================================================
window.EPIC_TASKS_CONFIG = {
  // Назва, яку Trello покаже користувачу під час підключення.
  APP_NAME: 'Epic Tasks',

  // ВАРІАНТ А (простіший) — "Trello auth".
  // Power-Up admin → ваш Power-Up → API key → Generate → скопіюйте ключ сюди.
  APP_KEY: 'db911a1285f3dea96b9da17e648a2c35',

  // ВАРІАНТ Б — OAuth 2.0 (якщо в адмінці доступний лише він).
  // Заповніть Client ID — і Power-Up автоматично перейде на OAuth 2.0.
  OAUTH2_CLIENT_ID: '',
  OAUTH2_SCOPES: ['read:board:trello', 'write:board:trello'],
  // Якщо порожньо — береться <адреса хостингу>/auth-redirect.html
  OAUTH2_REDIRECT_URI: '',
};
