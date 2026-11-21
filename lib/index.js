/**
 * lib/index.js — host-половина плагина dsh-kanban-board.
 *
 * Регистрирует префикс /kanban на веб-сервере DSH (доска/журнал/обход) и
 * проверяет/ставит зависимости (например structure — dsh-project-graph) через
 * службу pluginManager до открытия панели.
 */
import * as board from './board.js';
import { createKanbanRuntime, ensureDependencies, registerKanbanWeb } from './api.js';

export * from './board.js';
export * from './letters.js';
export * from './motor.js';
export * from './realm.js';

export const name = 'dsh-kanban-board';

/** Фабрика мотора: чисто-императивные операции §9 над каталогом доски. */
export function createMotor({ boardDir } = {}) {
  if (typeof boardDir !== 'string' || !boardDir.trim()) throw new Error('createMotor: нужен boardDir');
  return {
    boardDir,
    apply: (request) => board.apply(boardDir, request),
    sweep: (options) => board.sweep(boardDir, options),
    replay: (options) => board.replay(boardDir, options),
    readJournal: () => board.readJournal(boardDir),
    listCards: (kind) => board.listCards(boardDir, kind),
    loadCard: (id) => board.loadCard(boardDir, id),
  };
}

function pluginManagerOf(ctx) {
  try {
    if (ctx && typeof ctx.get === 'function') return ctx.get('pluginManager');
  } catch {
    /* service not injected */
  }
  return null;
}

/** Зарегистрированные воркспейсы DSH — источник выбора в меню реалма. */
function workspaceRowsOf(ctx) {
  let registry = null;
  try { if (ctx && typeof ctx.get === 'function') registry = ctx.get('workspaceRegistry'); } catch { /* ignore */ }
  if (!registry) { try { registry = ctx && ctx.workspaceRegistry; } catch { /* ignore */ } }
  if (!registry || typeof registry.list !== 'function') return [];
  try {
    return registry.list()
      .map((item) => ({ path: String((item && item.path) || ''), title: String((item && item.title) || '') }))
      .filter((item) => item.path);
  } catch {
    return [];
  }
}

export function apply(ctx, config = {}) {
  const runtime = createKanbanRuntime(config, {
    getPluginManager: () => pluginManagerOf(ctx),
    listWorkspaces: () => workspaceRowsOf(ctx),
  });
  /* Предварительная проверка зависимостей: недостающие ставятся через pluginManager. */
  try { ensureDependencies(runtime).catch(() => { /* причина видна в /kanban/api/status */ }); } catch { /* ignore */ }
  try {
    if (ctx && typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (webCtx) => registerKanbanWeb(webCtx, runtime));
    }
  } catch {
    /* маршрут не зарегистрирован — панель недоступна, но плагин не падает */
  }
  return runtime;
}
