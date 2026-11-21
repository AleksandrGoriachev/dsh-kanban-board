/**
 * lib/client.js — клиентская половина: вкладка «Канбан».
 *
 * Классический браузерный модуль (без JSX и сборщика). Реалм настраивается
 * ЧЕРЕЗ МЕНЮ. Доска: создание эпика и наряда, кнопки допустимых переходов
 * архитектора (PROTOCOL §5), обход обмена, данные — только из карточек и журнала.
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
      if (!response.ok) throw new Error((data && (data.error || data.code || data.reason)) || ('HTTP ' + response.status));
      return data;
    }

    function cardView(card, onAction) {
      const rows = [];
      if (card.workspace) rows.push(h('div', { key: 'ws', className: 'kanban-card__row' }, 'воркспейс: ' + card.workspace));
      if (card.owner) rows.push(h('div', { key: 'owner', className: 'kanban-card__row' }, 'взят: ' + card.owner));
      if (card.lease_until) rows.push(h('div', { key: 'lease', className: 'kanban-card__row' }, 'лиз до ' + card.lease_until));
      if (card.evidence && card.evidence.length) rows.push(h('div', { key: 'ev', className: 'kanban-card__row' }, 'доказательств: ' + card.evidence.length));
      if (card.subtasks && card.subtasks.total) rows.push(h('div', { key: 'sub', className: 'kanban-card__row' }, 'подзадачи: ' + card.subtasks.done + '/' + card.subtasks.total));
      const allowed = Array.isArray(card.allowed) ? card.allowed : [];
      const actions = allowed.length
        ? h('div', { key: 'act', className: 'kanban-card__actions' }, allowed.map((to) => h('button', {
          key: to, type: 'button', className: 'kanban-btn kanban-btn--small', onClick: () => onAction(card, to),
          title: 'Перевести ' + card.id + ': ' + label(card.status) + ' → ' + label(to),
        }, '→ ' + label(to))))
        : null;
      return h('div', { key: card.id, className: 'kanban-card', title: card.claim || card.title || card.id }, [
        h('div', { key: 'id', className: 'kanban-card__id' }, card.id),
        h('div', { key: 'title', className: 'kanban-card__title' }, card.title || card.claim || ''),
        ...rows,
        actions,
      ]);
    }

    function columns(statuses, cards, onAction) {
      const known = new Set(statuses);
      const buckets = statuses.map((status) => ({ status, items: cards.filter((card) => card.status === status) }));
      for (const card of cards) if (!known.has(card.status)) buckets.push({ status: card.status, items: [card] });
      return h('div', { className: 'kanban-columns' }, buckets.map((bucket) => h('div', { key: bucket.status, className: 'kanban-column' }, [
        h('div', { key: 'h', className: 'kanban-column__title' }, label(bucket.status) + ' (' + bucket.items.length + ')'),
        ...bucket.items.map((card) => cardView(card, onAction)),
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
          'Выберите корень архитектора и воркспейсы-исполнители из зарегистрированных в DSH. Папка обмена по умолчанию — <корень>/coordination. Сохраняет плагин сам.'),
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

    function EpicForm(props) {
      const [id, setId] = React.useState('');
      const [title, setTitle] = React.useState('');
      const [involved, setInvolved] = React.useState({});
      const [contracts, setContracts] = React.useState('');
      const [scenario, setScenario] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      const toggle = (wsId) => setInvolved((prev) => ({ ...prev, [wsId]: !prev[wsId] }));
      const save = async () => {
        setSaving(true);
        setError(null);
        try {
          await props.onSave({
            id, title,
            involved: Object.keys(involved).filter((key) => involved[key]),
            contracts: contracts.split(',').map((s) => s.trim()).filter(Boolean),
            scenario,
          });
        } catch (e) { setError(String(e && e.message ? e.message : e)); setSaving(false); }
      };
      return h('div', { className: 'kanban-form' }, [
        h('h3', { key: 't', className: 'kanban-section' }, 'Создать эпик'),
        h('label', { key: 'il', className: 'kanban-realm__label' }, 'id (например E1)'),
        h('input', { key: 'i', className: 'kanban-input', value: id, onChange: (e) => setId(e.target.value) }),
        h('label', { key: 'tl', className: 'kanban-realm__label' }, 'Название'),
        h('input', { key: 'ti', className: 'kanban-input', value: title, onChange: (e) => setTitle(e.target.value) }),
        h('div', { key: 'wl', className: 'kanban-realm__label' }, 'Участники (involved)'),
        h('div', { key: 'list', className: 'kanban-realm__list' }, workspaces.map((item) => h('label', { key: item.id, className: 'kanban-realm__item' }, [
          h('input', { key: 'i', type: 'checkbox', checked: Boolean(involved[item.id]), onChange: () => toggle(item.id) }),
          ' ' + item.id,
        ]))),
        h('label', { key: 'cl', className: 'kanban-realm__label' }, 'Контракты (через запятую)'),
        h('input', { key: 'ci', className: 'kanban-input', value: contracts, onChange: (e) => setContracts(e.target.value) }),
        h('label', { key: 'sl', className: 'kanban-realm__label' }, 'Эталонная серия (scenario)'),
        h('input', { key: 'si', className: 'kanban-input', value: scenario, onChange: (e) => setScenario(e.target.value) }),
        h('button', { key: 'save', type: 'button', className: 'kanban-btn', onClick: save, disabled: saving }, saving ? 'Создаю…' : 'Создать эпик'),
        error ? h('div', { key: 'err', className: 'kanban-view__error' }, 'Ошибка: ' + error) : null,
      ]);
    }

    function TaskForm(props) {
      const epics = Array.isArray(props.epics) ? props.epics : [];
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      const [id, setId] = React.useState('');
      const [epic, setEpic] = React.useState((epics[0] && epics[0].id) || '');
      const [workspace, setWorkspace] = React.useState((workspaces[0] && workspaces[0].id) || '');
      const [role, setRole] = React.useState('');
      const [contracts, setContracts] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const save = async () => {
        setSaving(true);
        setError(null);
        try {
          await props.onSave({ id, epic, workspace, role: role || null, contracts: contracts.split(',').map((s) => s.trim()).filter(Boolean) });
        } catch (e) { setError(String(e && e.message ? e.message : e)); setSaving(false); }
      };
      return h('div', { className: 'kanban-form' }, [
        h('h3', { key: 't', className: 'kanban-section' }, 'Создать наряд'),
        h('label', { key: 'il', className: 'kanban-realm__label' }, 'id (например E1-1)'),
        h('input', { key: 'i', className: 'kanban-input', value: id, onChange: (e) => setId(e.target.value) }),
        h('label', { key: 'el', className: 'kanban-realm__label' }, 'Эпик'),
        h('select', { key: 'es', className: 'kanban-realm__select', value: epic, onChange: (e) => setEpic(e.target.value) },
          epics.map((item) => h('option', { key: item.id, value: item.id }, item.id + ' — ' + (item.title || '')))),
        h('label', { key: 'wl', className: 'kanban-realm__label' }, 'Воркспейс'),
        h('select', { key: 'ws', className: 'kanban-realm__select', value: workspace, onChange: (e) => setWorkspace(e.target.value) },
          workspaces.map((item) => h('option', { key: item.id, value: item.id }, item.id))),
        h('label', { key: 'rl', className: 'kanban-realm__label' }, 'Роль (необязательно)'),
        h('input', { key: 'ri', className: 'kanban-input', value: role, onChange: (e) => setRole(e.target.value) }),
        h('label', { key: 'cl', className: 'kanban-realm__label' }, 'Контракты (через запятую)'),
        h('input', { key: 'ci', className: 'kanban-input', value: contracts, onChange: (e) => setContracts(e.target.value) }),
        h('button', { key: 'save', type: 'button', className: 'kanban-btn', onClick: save, disabled: saving }, saving ? 'Создаю…' : 'Создать наряд'),
        error ? h('div', { key: 'err', className: 'kanban-view__error' }, 'Ошибка: ' + error) : null,
      ]);
    }

    function createView() {
      return function KanbanView() {
        const [state, setState] = React.useState({ loading: true, error: null, board: null, status: null, workspaces: [], realm: null, editing: false, creating: null, note: null });
        const load = React.useCallback(async () => {
          setState((prev) => ({ ...prev, loading: true, error: null }));
          try {
            const results = await Promise.all([
              getJson('/api/status'),
              getJson('/api/workspaces').catch(() => ({ workspaces: [] })),
              getJson('/api/realm').catch(() => ({ realm: null })),
            ]);
            const status = results[0];
            let board = null;
            if (status.realm && status.realm.configured) board = await getJson('/api/board');
            setState((prev) => ({ loading: false, error: null, board, status, workspaces: results[1].workspaces || [], realm: results[2].realm || null, editing: prev.editing, creating: null, note: prev.note }));
          } catch (e) {
            setState({ loading: false, error: String(e && e.message ? e.message : e), board: null, status: null, workspaces: [], realm: null, editing: false, creating: null, note: null });
          }
        }, []);
        React.useEffect(() => { load(); }, [load]);
        const onAction = React.useCallback(async (card, to) => {
          try {
            const result = await postJson('/api/transition', { confirm: true, card: card.id, from: card.status, to, by: 'architect', revision: card.revision });
            await load();
            setState((prev) => ({ ...prev, note: card.id + ': ' + label(card.status) + ' → ' + label(to) + (result.ok ? '' : ' — ' + (result.reason || result.code)) }));
          } catch (e) {
            setState((prev) => ({ ...prev, note: card.id + ': ' + String(e && e.message ? e.message : e) }));
          }
        }, [load]);
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
        const onSaveEpic = React.useCallback(async (input) => {
          await postJson('/api/epic', { confirm: true, ...input });
          await load();
        }, [load]);
        const onSaveTask = React.useCallback(async (input) => {
          await postJson('/api/task', { confirm: true, ...input });
          await load();
        }, [load]);

        const status = state.status;
        const deps = status && Array.isArray(status.dependencies) ? status.dependencies : [];
        const missing = deps.filter((dep) => dep.installed === false && !dep.optional);
        const configured = Boolean(status && status.realm && status.realm.configured);
        const showForm = !configured || state.editing;
        const realmWorkspaces = state.realm && Array.isArray(state.realm.workspaces) ? state.realm.workspaces : [];
        const epics = state.board && Array.isArray(state.board.epics) ? state.board.epics : [];
        return h('div', { className: 'kanban-view' }, [
          h('div', { key: 'head', className: 'kanban-view__head' }, [
            h('h2', { key: 't', className: 'kanban-view__title' }, VIEW_LABEL),
            h('button', { key: 'reload', type: 'button', className: 'kanban-btn', onClick: load, title: 'Перечитать карточки и журнал' }, 'Обновить'),
            h('button', { key: 'sweep', type: 'button', className: 'kanban-btn', onClick: onSweep, title: 'Прочитать новые письма из папок обмена, применить переходы и проверить лизы' }, 'Обход обмена'),
            h('button', { key: 'epic', type: 'button', className: 'kanban-btn', onClick: () => setState((prev) => ({ ...prev, creating: prev.creating === 'epic' ? null : 'epic' })), title: 'Создать эпик' }, 'Создать эпик'),
            h('button', { key: 'task', type: 'button', className: 'kanban-btn', onClick: () => setState((prev) => ({ ...prev, creating: prev.creating === 'task' ? null : 'task' })), title: 'Создать наряд под эпиком' }, 'Создать наряд'),
            h('button', { key: 'cfg', type: 'button', className: 'kanban-btn', onClick: () => setState((prev) => ({ ...prev, editing: !prev.editing })), title: 'Настроить реалм' }, state.editing ? 'Скрыть настройку' : 'Настроить реалм'),
          ]),
          state.note ? h('div', { key: 'note', className: 'kanban-view__note' }, state.note) : null,
          missing.length ? h('div', { key: 'deps', className: 'kanban-view__warn' }, 'нет зависимостей: ' + missing.map((dep) => dep.id).join(', ')) : null,
          state.loading ? h('div', { key: 'loading' }, 'Загрузка…') : null,
          state.error ? h('div', { key: 'error', className: 'kanban-view__error' }, 'Ошибка: ' + state.error) : null,
          showForm ? h(RealmForm, { key: 'realm', workspaces: state.workspaces, onSaved: load }) : null,
          !showForm && state.creating === 'epic' ? h(EpicForm, { key: 'ef', workspaces: realmWorkspaces, onSave: onSaveEpic }) : null,
          !showForm && state.creating === 'task' ? h(TaskForm, { key: 'tf', epics, workspaces: realmWorkspaces, onSave: onSaveTask }) : null,
          !showForm && state.board ? h('div', { key: 'board' }, [
            h('h3', { key: 'eh', className: 'kanban-section' }, 'Эпики'),
            columns(EPIC_COLUMNS, epics, onAction),
            h('h3', { key: 'th', className: 'kanban-section' }, 'Наряды'),
            columns(TASK_COLUMNS, state.board.tasks || [], onAction),
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
