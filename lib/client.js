/**
 * lib/client.js — клиентская половина: вкладка «Канбан».
 *
 * Классический браузерный модуль (без JSX и сборщика): DSH отдаёт lib/client.js
 * через загрузчик модулей. Данные — только карточки и журнал (PROTOCOL §16).
 * Регистрируется как conversation.view; обход обмена — POST /kanban/api/sweep
 * по кнопке (с подтверждением).
 */
window.__ModuleLoader__.load({
  id: 'dsh-kanban-board',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const React = require('react');
    const h = React.createElement;

    const BASE = '/kanban';
    const VIEW_ID = 'kanban';
    const VIEW_LABEL = 'Канбан';
    const ORDER = 50;

    const TASK_COLUMNS = ['proposed', 'agreed', 'in-progress', 'integration', 'accepted', 'blocked', 'rework', 'needs-decision'];
    const EPIC_COLUMNS = ['draft', 'agreeing', 'agreed', 'decomposed', 'in-progress', 'accepted', 'done', 'blocked', 'needs-decision'];
    const LABELS = {
      proposed: 'Предложен', agreed: 'Согласован', 'in-progress': 'В работе', integration: 'На стыке',
      accepted: 'Принят', blocked: 'Заблокирован', rework: 'Доработка', 'needs-decision': 'Нужно решение',
      draft: 'Черновик', agreeing: 'Согласование', agreed_epic: 'Согласован', decomposed: 'Разложен',
      done: 'Закрыт',
    };
    const label = (status) => LABELS[status] || status;

    async function getJson(pathname) {
      const response = await fetch(BASE + pathname, { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error((data && (data.error || data.code)) || ('HTTP ' + response.status));
      return data;
    }
    async function postJson(pathname, body) {
      const response = await fetch(BASE + pathname, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error((data && (data.error || data.code)) || ('HTTP ' + response.status));
      return data;
    }

    function cardView(card) {
      const rows = [];
      if (card.workspace) rows.push(h('div', { key: 'ws', className: 'kanban-card__row' }, 'воркспейс: ' + card.workspace));
      if (card.owner) rows.push(h('div', { key: 'owner', className: 'kanban-card__row' }, 'взят: ' + card.owner));
      if (card.lease_until) rows.push(h('div', { key: 'lease', className: 'kanban-card__row' }, 'лиз до ' + card.lease_until));
      if (card.evidence && card.evidence.length) rows.push(h('div', { key: 'ev', className: 'kanban-card__row' }, 'доказательств: ' + card.evidence.length));
      if (card.subtasks && card.subtasks.total) rows.push(h('div', { key: 'sub', className: 'kanban-card__row' }, 'подзадачи: ' + card.subtasks.done + '/' + card.subtasks.total));
      return h('div', { key: card.id, className: 'kanban-card', title: card.claim || card.title || card.id }, [
        h('div', { key: 'id', className: 'kanban-card__id' }, card.id),
        h('div', { key: 'title', className: 'kanban-card__title' }, card.title || card.claim || ''),
        ...rows,
      ]);
    }

    function columns(statuses, cards) {
      const known = new Set(statuses);
      const buckets = statuses.map((status) => ({ status, items: cards.filter((card) => card.status === status) }));
      for (const card of cards) if (!known.has(card.status)) buckets.push({ status: card.status, items: [card] });
      return h('div', { className: 'kanban-columns' }, buckets.map((bucket) => h('div', { key: bucket.status, className: 'kanban-column' }, [
        h('div', { key: 'h', className: 'kanban-column__title' }, label(bucket.status) + ' (' + bucket.items.length + ')'),
        ...bucket.items.map(cardView),
      ])));
    }

    function createView() {
      return function KanbanView() {
        const [state, setState] = React.useState({ loading: true, error: null, board: null, status: null });
        const load = React.useCallback(async () => {
          setState((prev) => ({ ...prev, loading: true, error: null }));
          try {
            const status = await getJson('/api/status');
            let board = null;
            if (status.realm && status.realm.configured) board = await getJson('/api/board');
            setState({ loading: false, error: null, board, status });
          } catch (error) {
            setState({ loading: false, error: String(error && error.message ? error.message : error), board: null, status: null });
          }
        }, []);
        React.useEffect(() => { load(); }, [load]);
        const onSweep = React.useCallback(async () => {
          try {
            const result = await postJson('/api/sweep', { confirm: true });
            await load();
            const applied = result && result.outbox ? result.outbox.applied : 0;
            const rejected = result && result.outbox ? result.outbox.rejected : 0;
            setState((prev) => ({ ...prev, note: 'обход: применено ' + applied + ', отклонено ' + rejected }));
          } catch (error) {
            setState((prev) => ({ ...prev, note: 'обход: ' + String(error && error.message ? error.message : error) }));
          }
        }, [load]);

        const status = state.status;
        const deps = status && Array.isArray(status.dependencies) ? status.dependencies : [];
        const missing = deps.filter((dep) => dep.installed === false && !dep.optional);
        return h('div', { className: 'kanban-view' }, [
          h('div', { key: 'head', className: 'kanban-view__head' }, [
            h('h2', { key: 't', className: 'kanban-view__title' }, VIEW_LABEL),
            h('button', { key: 'reload', type: 'button', className: 'kanban-btn', onClick: load, title: 'Перечитать карточки и журнал' }, 'Обновить'),
            h('button', { key: 'sweep', type: 'button', className: 'kanban-btn', onClick: onSweep, title: 'Прочитать новые письма из папок обмена, применить переходы и проверить лизы' }, 'Обход обмена'),
          ]),
          state.note ? h('div', { key: 'note', className: 'kanban-view__note' }, state.note) : null,
          status ? h('div', { key: 'realm', className: 'kanban-view__realm' }, [
            h('div', { key: 'r' }, 'реалм: ' + (status.realm && status.realm.configured ? status.realm.path : 'не настроен' + (status.realm && status.realm.error ? ' (' + status.realm.error + ')' : ''))),
            h('div', { key: 'b' }, 'доска: ' + (status.boardDir || '—')),
            missing.length ? h('div', { key: 'd', className: 'kanban-view__warn' }, 'нет зависимостей: ' + missing.map((dep) => dep.id).join(', ')) : null,
          ]) : null,
          state.loading ? h('div', { key: 'loading' }, 'Загрузка…') : null,
          state.error ? h('div', { key: 'error', className: 'kanban-view__error' }, 'Ошибка: ' + state.error) : null,
          state.board ? h('div', { key: 'board' }, [
            h('h3', { key: 'eh', className: 'kanban-section' }, 'Эпики'),
            columns(EPIC_COLUMNS, state.board.epics || []),
            h('h3', { key: 'th', className: 'kanban-section' }, 'Наряды'),
            columns(TASK_COLUMNS, state.board.tasks || []),
          ]) : null,
          !state.loading && !state.error && status && status.realm && !status.realm.configured
            ? h('div', { key: 'empty', className: 'kanban-view__empty' }, 'Реалм не настроен: укажите путь к JSON-конфигу реалма в cordis.patch.yml плагина (config.realm).')
            : null,
        ]);
      };
    }

    function apply(rawContext) {
      const ctx = rawContext;
      const View = createView();
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register({ name: 'conversation.view', id: VIEW_ID, order: ORDER, label: () => VIEW_LABEL }, View));
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
