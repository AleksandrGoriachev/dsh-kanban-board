/**
 * lib/client.js — клиентская половина: вкладка «Канбан».
 *
 * Классический браузерный модуль (без JSX и сборщика). Реалм настраивается
 * ЧЕРЕЗ МЕНЮ: список зарегистрированных в DSH воркспейсов, выбор корня
 * архитектора и воркспейсов, сохранение (плагин пишет конфиг сам).
 * Данные доски — только карточки и журнал (PROTOCOL §16).
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
      draft: 'Черновик', agreeing: 'Согласование', decomposed: 'Разложен', done: 'Закрыт',
    };
    const label = (status) => LABELS[status] || status;
    const basename = (value) => String(value || '').split(/[\\/]/u).filter(Boolean).pop() || String(value || '');

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

    function RealmForm(props) {
      const [architect, setArchitect] = React.useState('');
      const [selected, setSelected] = React.useState({});
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      React.useEffect(() => {
        if (!architect && workspaces.length > 0) setArchitect(workspaces[0].path);
      }, [workspaces, architect]);
      const toggle = (p) => setSelected((prev) => ({ ...prev, [p]: !prev[p] }));
      const save = async () => {
        if (!architect) { setError('выберите корень архитектора'); return; }
        setSaving(true);
        setError(null);
        try {
          const list = workspaces
            .filter((item) => item.path !== architect && selected[item.path])
            .map((item) => ({ id: item.title || basename(item.path), root: item.path }));
          await postJson('/api/realm', { confirm: true, architect: { root: architect }, workspaces: list });
          if (typeof props.onSaved === 'function') await props.onSaved();
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
          setSaving(false);
        }
      };
      return h('div', { className: 'kanban-realm' }, [
        h('h2', { key: 't', className: 'kanban-realm__title' }, 'Настроить реалм'),
        h('p', { key: 'p', className: 'kanban-realm__hint' },
          'Реалм — набор воркспейсов. Выберите корень архитектора и воркспейсы-исполнители из зарегистрированных в DSH. Папка обмена по умолчанию — <корень>/coordination. Сохраняет плагин сам, руками JSON править не нужно.'),
        workspaces.length === 0
          ? h('div', { key: 'none', className: 'kanban-view__warn' }, 'Зарегистрированных воркспейсов нет: добавьте их в DSH.')
          : h('div', { key: 'form' }, [
            h('label', { key: 'al', className: 'kanban-realm__label' }, 'Корень архитектора'),
            h('select', { key: 'as', className: 'kanban-realm__select', value: architect, onChange: (e) => setArchitect(e.target.value) },
              workspaces.map((item) => h('option', { key: item.path, value: item.path }, item.title || item.path))),
            h('div', { key: 'wl', className: 'kanban-realm__label' }, 'Воркспейсы-исполнители'),
            h('div', { key: 'list', className: 'kanban-realm__list' }, workspaces
              .filter((item) => item.path !== architect)
              .map((item) => h('label', { key: item.path, className: 'kanban-realm__item' }, [
                h('input', { key: 'i', type: 'checkbox', checked: Boolean(selected[item.path]), onChange: () => toggle(item.path) }),
                ' ' + (item.title || basename(item.path)),
              ]))),
            h('button', { key: 'save', type: 'button', className: 'kanban-btn', onClick: save, disabled: saving,
              title: 'Сохранить реалм: плагин запишет конфиг сам' }, saving ? 'Сохраняю…' : 'Сохранить реалм'),
          ]),
        error ? h('div', { key: 'err', className: 'kanban-view__error' }, 'Ошибка: ' + error) : null,
      ]);
    }

    function createView() {
      return function KanbanView() {
        const [state, setState] = React.useState({ loading: true, error: null, board: null, status: null, workspaces: [], editing: false, note: null });
        const load = React.useCallback(async () => {
          setState((prev) => ({ ...prev, loading: true, error: null }));
          try {
            const results = await Promise.all([
              getJson('/api/status'),
              getJson('/api/workspaces').catch(() => ({ workspaces: [] })),
            ]);
            const status = results[0];
            let board = null;
            if (status.realm && status.realm.configured) board = await getJson('/api/board');
            setState((prev) => ({ loading: false, error: null, board, status, workspaces: results[1].workspaces || [], editing: false, note: prev.note }));
          } catch (e) {
            setState({ loading: false, error: String(e && e.message ? e.message : e), board: null, status: null, workspaces: [], editing: false, note: null });
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
          } catch (e) {
            setState((prev) => ({ ...prev, note: 'обход: ' + String(e && e.message ? e.message : e) }));
          }
        }, [load]);

        const status = state.status;
        const deps = status && Array.isArray(status.dependencies) ? status.dependencies : [];
        const missing = deps.filter((dep) => dep.installed === false && !dep.optional);
        const configured = Boolean(status && status.realm && status.realm.configured);
        const showForm = !configured || state.editing;
        return h('div', { className: 'kanban-view' }, [
          h('div', { key: 'head', className: 'kanban-view__head' }, [
            h('h2', { key: 't', className: 'kanban-view__title' }, VIEW_LABEL),
            h('button', { key: 'reload', type: 'button', className: 'kanban-btn', onClick: load, title: 'Перечитать карточки и журнал' }, 'Обновить'),
            h('button', { key: 'sweep', type: 'button', className: 'kanban-btn', onClick: onSweep, title: 'Прочитать новые письма из папок обмена, применить переходы и проверить лизы' }, 'Обход обмена'),
            h('button', { key: 'cfg', type: 'button', className: 'kanban-btn', onClick: () => setState((prev) => ({ ...prev, editing: !prev.editing })), title: 'Настроить реалм: выбрать корень архитектора и воркспейсы' }, state.editing ? 'Скрыть настройку' : 'Настроить реалм'),
          ]),
          state.note ? h('div', { key: 'note', className: 'kanban-view__note' }, state.note) : null,
          missing.length ? h('div', { key: 'deps', className: 'kanban-view__warn' }, 'нет зависимостей: ' + missing.map((dep) => dep.id).join(', ')) : null,
          state.loading ? h('div', { key: 'loading' }, 'Загрузка…') : null,
          state.error ? h('div', { key: 'error', className: 'kanban-view__error' }, 'Ошибка: ' + state.error) : null,
          showForm ? h(RealmForm, { key: 'realm', workspaces: state.workspaces, onSaved: load }) : null,
          !showForm && state.board ? h('div', { key: 'board' }, [
            h('h3', { key: 'eh', className: 'kanban-section' }, 'Эпики'),
            columns(EPIC_COLUMNS, state.board.epics || []),
            h('h3', { key: 'th', className: 'kanban-section' }, 'Наряды'),
            columns(TASK_COLUMNS, state.board.tasks || []),
          ]) : null,
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
