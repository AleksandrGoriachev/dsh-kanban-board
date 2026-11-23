/**
 * lib/realm-helpers.js — чистые резолверы формы реалма.
 *
 * ESM без React: только разбор данных, поэтому модуль можно импортировать
 * Node-проверкой. Клиентская половина (lib/client.js) — классический бандл,
 * где require резолвит лишь таблицу модулей загрузчика, а не соседний файл:
 * те же две функции зарегистрированы там под id './realm-helpers.js'.
 */

/** Есть ли в сохранённом реалме воркспейс с таким корнем. */
export function realmHasWorkspace(realm, rootPath) {
  if (!realm || !Array.isArray(realm.workspaces)) return false;
  return realm.workspaces.some((w) => w && w.root === rootPath);
}

/** Корень текущего воркспейса: запись, в чьих sessionIds есть сессия панели. */
export function currentWorkspaceRoot(items, sessionId) {
  if (!Array.isArray(items) || !sessionId) return '';
  const found = items.find((it) => it && Array.isArray(it.sessionIds) && it.sessionIds.indexOf(sessionId) >= 0);
  return found && found.root ? found.root : '';
}
