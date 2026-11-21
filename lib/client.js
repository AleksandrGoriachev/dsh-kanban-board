/**
 * lib/client.js — клиентская половина: вкладка «Канбан».
 *
 * Дизайн взят из репозитория VictorKozachek/dsh-kanban (lib/client.js): тема
 * наследуется через currentColor/color-mix, колонки с точкой цвета и счётчиком,
 * карточка с цветной левой гранью, бейджами и кнопками действий.
 * Данные — только карточки и журнал доски (PROTOCOL §4–§5, §16).
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
    const HAIRLINE = 'color-mix(in srgb, currentColor 12%, transparent)';

    const EPIC_COLUMNS = [
      { id: 'draft', label: 'Черновик', color: '#94a3b8' },
      { id: 'agreeing', label: 'Согласование', color: '#f59e0b' },
      { id: 'agreed', label: 'Согласован', color: '#06b6d4' },
      { id: 'decomposed', label: 'Разложен', color: '#8b5cf6' },
      { id: 'in-progress', label: 'В работе', color: '#3b82f6' },
      { id: 'accepted', label: 'Принят', color: '#22c55e' },
      { id: 'done', label: 'Закрыт', color: '#16a34a' },
      { id: 'blocked', label: 'Заблокирован', color: '#ef4444' },
      { id: 'needs-decision', label: 'Нужно решение', color: '#eab308' },
    ];
    const TASK_COLUMNS = [
      { id: 'proposed', label: 'Предложен', color: '#94a3b8' },
      { id: 'agreed', label: 'Согласован', color: '#06b6d4' },
      { id: 'in-progress', label: 'В работе', color: '#3b82f6' },
      { id: 'integration', label: 'На стыке', color: '#f59e0b' },
      { id: 'accepted', label: 'Принят', color: '#22c55e' },
      { id: 'rework', label: 'Доработка', color: '#f97316' },
      { id: 'blocked', label: 'Заблокирован', color: '#ef4444' },
      { id: 'needs-decision', label: 'Нужно решение', color: '#eab308' },
    ];
    const COLUMN_BY_ID = {};
    const LABELS = {};
    for (const column of EPIC_COLUMNS.concat(TASK_COLUMNS)) {
      COLUMN_BY_ID[column.id] = column;
      LABELS[column.id] = column.label;
    }
    const label = (id) => LABELS[id] || id;

    const styles = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'inherit', fontSize: 12, lineHeight: 1.45 },
      header: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid ' + HAIRLINE, flex: '0 0 auto', flexWrap: 'wrap' },
      headerTitle: { fontWeight: 600, fontSize: 12, letterSpacing: '.02em', marginRight: 2 },
      button: { border: '1px solid ' + HAIRLINE, background: 'transparent', color: 'inherit', borderRadius: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '4px 7px' },
      buttonOn: { border: '1px solid ' + HAIRLINE, background: 'color-mix(in srgb, currentColor 10%, transparent)', color: 'inherit', borderRadius: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '4px 7px' },
      banner: { margin: '6px 10px 0', padding: '5px 8px', borderRadius: 6, fontSize: 11 },
      note: { background: 'color-mix(in srgb, #f59e0b 14%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)' },
      ok: { background: 'color-mix(in srgb, #22c55e 14%, transparent)', border: '1px solid color-mix(in srgb, #22c55e 35%, transparent)' },
      error: { background: 'color-mix(in srgb, #ef4444 14%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)' },
      section: { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.5, padding: '10px 12px 0', flex: '0 0 auto' },
      board: { display: 'flex', gap: 8, padding: 8, flex: '0 0 auto', minHeight: 0, alignItems: 'flex-start', overflowX: 'auto' },
      column: { flex: '0 0 auto', width: 232, display: 'flex', flexDirection: 'column', border: '1px solid ' + HAIRLINE, borderRadius: 10, background: 'color-mix(in srgb, currentColor 4%, transparent)', overflow: 'hidden' },
      columnHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid ' + HAIRLINE, fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', opacity: 0.85, flex: '0 0 auto' },
      dot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
      count: { marginLeft: 'auto', opacity: 0.6, fontVariantNumeric: 'tabular-nums' },
      columnBody: { display: 'flex', flexDirection: 'column', gap: 6, padding: 6, minHeight: 40 },
      card: { display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', border: '1px solid ' + HAIRLINE, borderLeftWidth: 3, borderLeftStyle: 'solid', borderRadius: 8, background: 'color-mix(in srgb, currentColor 5%, transparent)' },
      cardTop: { display: 'flex', alignItems: 'center', gap: 6 },
      cardId: { opacity: 0.6, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
      badge: { fontSize: 10, padding: '1px 5px', borderRadius: 999, border: '1px solid ' + HAIRLINE, opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 },
      owner: { marginLeft: 'auto', fontSize: 10, padding: '1px 5px', borderRadius: 999, border: '1px solid ' + HAIRLINE, opacity: 0.9, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      ownerEmpty: { marginLeft: 'auto', fontSize: 10, opacity: 0.45 },
      cardTitle: { fontSize: 12, fontWeight: 500, wordBreak: 'break-word' },
      meta: { fontSize: 10, opacity: 0.6, wordBreak: 'break-all' },
      cardActions: { display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' },
      cardAction: { border: '1px solid ' + HAIRLINE, background: 'transparent', color: 'inherit', borderRadius: 6, cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: '3px 6px', opacity: 0.85 },
      empty: { padding: '10px 8px', opacity: 0.5, fontSize: 11, textAlign: 'center' },
      form: { display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px', borderBottom: '1px solid ' + HAIRLINE },
      formTitle: { fontSize: 12, fontWeight: 600 },
      row: { display: 'flex', flexDirection: 'column', gap: 2 },
      label: { fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.5 },
      input: { border: '1px solid ' + HAIRLINE, background: 'transparent', color: 'inherit', borderRadius: 6, padding: '4px 7px', fontSize: 12, width: '100%', boxSizing: 'border-box' },
      select: { border: '1px solid ' + HAIRLINE, background: 'transparent', color: 'inherit', borderRadius: 6, padding: '4px 7px', fontSize: 12, width: '100%', boxSizing: 'border-box' },
      checks: { display: 'flex', flexWrap: 'wrap', gap: 4 },
      check: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, border: '1px solid ' + HAIRLINE, borderRadius: 6, padding: '2px 6px' },
      actions: { display: 'flex', gap: 6, marginTop: 2 },
      hint: { fontSize: 11, opacity: 0.7, padding: '6px 10px' },
    };

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

    const basename = (value) => String(value || '').split(/[\\/]/u).filter(Boolean).pop() || String(value || '');
    const shortId = (value) => { const text = String(value || ''); return text.length > 8 ? text.slice(0, 8) : text; };
    const shortOwner = (value) => {
      const text = String(value || '');
      return text.length > 14 ? text.slice(0, 12) + '…' : text;
    };

    function cardView(card, onAction, epicsById) {
      const column = COLUMN_BY_ID[card.status] || { color: '#94a3b8' };
      const epic = card.epic && epicsById ? epicsById[card.epic] : null;
      const children = [
        h('div', { key: 'top', style: styles.cardTop }, [
          h('span', { key: 'id', style: styles.cardId, title: card.id }, '#' + shortId(card.id)),
          card.workspace ? h('span', { key: 'ws', style: styles.badge, title: 'воркспейс ' + card.workspace }, card.workspace) : null,
          card.owner ? h('span', { key: 'owner', style: styles.owner, title: card.owner }, shortOwner(card.owner)) : h('span', { key: 'free', style: styles.ownerEmpty }, 'свободен'),
        ]),
        h('div', { key: 'title', style: styles.cardTitle }, card.title || card.claim || ''),
      ];
      if (card.involved && card.involved.length) {
        const done = card.involved.filter((id) => card.agreed && card.agreed[id]).length;
        children.push(h('div', { key: 'agree', style: styles.meta }, 'согласны ' + done + '/' + card.involved.length));
      }
      if (card.epic) children.push(h('div', { key: 'epic', style: styles.meta, title: card.epic }, 'эпик: ' + (epic ? epic.title : '#' + shortId(card.epic))));
      if (card.role) children.push(h('div', { key: 'role', style: styles.meta }, 'роль: ' + card.role));
      if (card.lease_until) children.push(h('div', { key: 'lease', style: styles.meta }, 'лиз до ' + card.lease_until));
      if (card.evidence && card.evidence.length) children.push(h('div', { key: 'ev', style: styles.meta }, 'доказательств: ' + card.evidence.length));
      if (card.blocked_by && card.blocked_by.length) children.push(h('div', { key: 'blocked', style: styles.meta }, 'ждёт: ' + card.blocked_by.join(', ')));
      if (card.subtasks && card.subtasks.total) children.push(h('div', { key: 'sub', style: styles.meta }, 'подзадачи: ' + card.subtasks.done + '/' + card.subtasks.total));
      const allowed = Array.isArray(card.allowed) ? card.allowed : [];
      if (allowed.length) children.push(h('div', { key: 'act', style: styles.cardActions }, allowed.map((to) => h('button', {
        key: to, type: 'button', style: styles.cardAction, onClick: () => onAction(card, to),
        title: 'Перевести ' + card.id + ': ' + label(card.status) + ' → ' + label(to),
      }, '→ ' + label(to)))));
      return h('article', {
        key: card.id, style: Object.assign({}, styles.card, { borderLeftColor: column.color }),
        title: card.id + ' · ' + label(card.status), 'data-kanban-card': card.id,
      }, children);
    }

    function columnView(column, cards, onAction, epicsById) {
      return h('div', { key: column.id, style: styles.column }, [
        h('div', { key: 'h', style: styles.columnHeader }, [
          h('span', { key: 'd', style: Object.assign({}, styles.dot, { background: column.color }) }),
          h('span', { key: 'l' }, column.label),
          h('span', { key: 'c', style: styles.count }, String(cards.length)),
        ]),
        h('div', { key: 'b', style: styles.columnBody }, cards.length ? cards.map((card) => cardView(card, onAction, epicsById)) : h('div', { key: 'empty', style: styles.empty }, '—')),
      ]);
    }

    function choose(value, onChange) {
      return { value, onChange: (event) => onChange(event.target.value) };
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
      const toggle = (path) => setSelected((prev) => ({ ...prev, [path]: !prev[path] }));
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
        } catch (e) { setError(String(e && e.message ? e.message : e)); setSaving(false); }
      };
      return h('div', { style: styles.form }, [
        h('div', { key: 't', style: styles.formTitle }, 'Настроить реалм'),
        h('div', { key: 'row1', style: styles.row }, [
          h('span', { key: 'l', style: styles.label }, 'Корень архитектора'),
          h('select', { key: 's', style: styles.select, ...choose(architect, setArchitect) },
            workspaces.map((item) => h('option', { key: item.path, value: item.path }, item.title || item.path))),
        ]),
        h('span', { key: 'l2', style: styles.label }, 'Воркспейсы-исполнители'),
        h('div', { key: 'list', style: styles.checks }, workspaces.filter((item) => item.path !== architect).map((item) => h('label', { key: item.path, style: styles.check }, [
          h('input', { key: 'i', type: 'checkbox', checked: Boolean(selected[item.path]), onChange: () => toggle(item.path) }),
          item.title || basename(item.path),
        ]))),
        h('div', { key: 'a', style: styles.actions }, h('button', { type: 'button', style: saving ? styles.buttonOn : styles.button, onClick: save, disabled: saving }, saving ? 'Сохраняю…' : 'Сохранить реалм')),
        error ? h('div', { key: 'e', style: Object.assign({}, styles.banner, styles.error) }, 'Ошибка: ' + error) : null,
      ]);
    }

    function EpicForm(props) {
      const [title, setTitle] = React.useState('');
      const [involved, setInvolved] = React.useState({});
      const [contracts, setContracts] = React.useState('');
      const [scenario, setScenario] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      const toggle = (ws) => setInvolved((prev) => ({ ...prev, [ws]: !prev[ws] }));
      const save = async () => {
        if (!String(title).trim()) { setError('укажите название'); return; }
        setSaving(true); setError(null);
        try {
          await props.onSave({
            title: String(title).trim(),
            involved: Object.keys(involved).filter((key) => involved[key]),
            contracts: contracts.split(',').map((s) => s.trim()).filter(Boolean),
            scenario,
          });
        } catch (e) { setError(String(e && e.message ? e.message : e)); setSaving(false); }
      };
      return h('div', { style: styles.form }, [
        h('div', { key: 't', style: styles.formTitle }, 'Создать эпик'),
        h('div', { key: 'r2', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Название'), h('input', { key: 'i', style: styles.input, ...choose(title, setTitle) })]),
        h('span', { key: 'l3', style: styles.label }, 'Участники (involved)'),
        h('div', { key: 'inv', style: styles.checks }, workspaces.map((item) => h('label', { key: item.id, style: styles.check }, [
          h('input', { key: 'i', type: 'checkbox', checked: Boolean(involved[item.id]), onChange: () => toggle(item.id) }),
          item.id,
        ]))),
        h('div', { key: 'r4', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Контракты (через запятую)'), h('input', { key: 'i', style: styles.input, ...choose(contracts, setContracts) })]),
        h('div', { key: 'r5', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Эталонная серия'), h('input', { key: 'i', style: styles.input, ...choose(scenario, setScenario) })]),
        h('div', { key: 'a', style: styles.actions }, h('button', { type: 'button', style: saving ? styles.buttonOn : styles.button, onClick: save, disabled: saving }, saving ? 'Создаю…' : 'Создать эпик')),
        error ? h('div', { key: 'e', style: Object.assign({}, styles.banner, styles.error) }, 'Ошибка: ' + error) : null,
      ]);
    }

    function TaskForm(props) {
      const epics = Array.isArray(props.epics) ? props.epics : [];
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      const [epic, setEpic] = React.useState((epics[0] && epics[0].id) || '');
      const [title, setTitle] = React.useState('');
      const [workspace, setWorkspace] = React.useState((workspaces[0] && workspaces[0].id) || '');
      const [role, setRole] = React.useState('');
      const [contracts, setContracts] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const save = async () => {
        if (!epic) { setError('выберите эпик'); return; }
        setSaving(true); setError(null);
        try {
          await props.onSave({ epic, title: String(title).trim(), workspace, role: role || null, contracts: contracts.split(',').map((s) => s.trim()).filter(Boolean) });
        } catch (e) { setError(String(e && e.message ? e.message : e)); setSaving(false); }
      };
      return h('div', { style: styles.form }, [
        h('div', { key: 't', style: styles.formTitle }, 'Создать наряд'),
        h('div', { key: 'r2', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Эпик'), h('select', { key: 's', style: styles.select, ...choose(epic, setEpic) },
          epics.map((item) => h('option', { key: item.id, value: item.id }, item.title || ('#' + shortId(item.id)))))]),
        h('div', { key: 'r1', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Название'), h('input', { key: 'i', style: styles.input, ...choose(title, setTitle) })]),
        h('div', { key: 'r3', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Воркспейс'), h('select', { key: 's', style: styles.select, ...choose(workspace, setWorkspace) },
          workspaces.map((item) => h('option', { key: item.id, value: item.id }, item.id)))]),
        h('div', { key: 'r4', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Роль (необязательно)'), h('input', { key: 'i', style: styles.input, ...choose(role, setRole) })]),
        h('div', { key: 'r5', style: styles.row }, [h('span', { key: 'l', style: styles.label }, 'Контракты (через запятую)'), h('input', { key: 'i', style: styles.input, ...choose(contracts, setContracts) })]),
        h('div', { key: 'a', style: styles.actions }, h('button', { type: 'button', style: saving ? styles.buttonOn : styles.button, onClick: save, disabled: saving }, saving ? 'Создаю…' : 'Создать наряд')),
        error ? h('div', { key: 'e', style: Object.assign({}, styles.banner, styles.error) }, 'Ошибка: ' + error) : null,
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
            setState((prev) => ({ ...prev, note: { kind: result.ok ? 'ok' : 'note', text: card.id + ': ' + label(card.status) + ' → ' + label(to) + (result.ok ? '' : ' — ' + (result.reason || result.code)) } }));
          } catch (e) {
            setState((prev) => ({ ...prev, note: { kind: 'error', text: card.id + ': ' + String(e && e.message ? e.message : e) } }));
          }
        }, [load]);
        const onSweep = React.useCallback(async () => {
          try {
            const result = await postJson('/api/sweep', { confirm: true });
            await load();
            const applied = result && result.outbox ? result.outbox.applied : 0;
            const rejected = result && result.outbox ? result.outbox.rejected : 0;
            setState((prev) => ({ ...prev, note: { kind: 'ok', text: 'обход: применено ' + applied + ', отклонено ' + rejected } }));
          } catch (e) {
            setState((prev) => ({ ...prev, note: { kind: 'error', text: 'обход: ' + String(e && e.message ? e.message : e) } }));
          }
        }, [load]);
        const onSaveEpic = React.useCallback(async (input) => { await postJson('/api/epic', { confirm: true, ...input }); await load(); }, [load]);
        const onSaveTask = React.useCallback(async (input) => { await postJson('/api/task', { confirm: true, ...input }); await load(); }, [load]);

        const status = state.status;
        const deps = status && Array.isArray(status.dependencies) ? status.dependencies : [];
        const missing = deps.filter((dep) => dep.installed === false && !dep.optional);
        const configured = Boolean(status && status.realm && status.realm.configured);
        const realmWorkspaces = state.realm && Array.isArray(state.realm.workspaces) ? state.realm.workspaces : [];
        const board = state.board || { epics: [], tasks: [] };
        const epics = Array.isArray(board.epics) ? board.epics : [];
        const tasks = Array.isArray(board.tasks) ? board.tasks : [];
        const epicsById = {};
        for (const epic of epics) epicsById[epic.id] = epic;
        const showRealm = !configured || state.editing;

        return h('div', { style: styles.root }, [
          h('div', { key: 'head', style: styles.header }, [
            h('span', { key: 't', style: styles.headerTitle }, VIEW_LABEL),
            h('button', { key: 'reload', type: 'button', style: styles.button, onClick: load, title: 'Перечитать карточки и журнал' }, '↻'),
            h('button', { key: 'sweep', type: 'button', style: styles.button, onClick: onSweep, title: 'Прочитать письма обмена, применить переходы, проверить лизы' }, 'Обход'),
            h('button', { key: 'epic', type: 'button', style: state.creating === 'epic' ? styles.buttonOn : styles.button, onClick: () => setState((prev) => ({ ...prev, creating: prev.creating === 'epic' ? null : 'epic' })), title: 'Создать эпик' }, '+ Эпик'),
            h('button', { key: 'task', type: 'button', style: state.creating === 'task' ? styles.buttonOn : styles.button, onClick: () => setState((prev) => ({ ...prev, creating: prev.creating === 'task' ? null : 'task' })), title: 'Создать наряд под эпиком' }, '+ Наряд'),
            h('button', { key: 'cfg', type: 'button', style: state.editing ? styles.buttonOn : styles.button, onClick: () => setState((prev) => ({ ...prev, editing: !prev.editing })), title: 'Настроить реалм' }, 'Реалм'),
          ]),
          state.note ? h('div', { key: 'note', style: Object.assign({}, styles.banner, state.note.kind === 'ok' ? styles.ok : state.note.kind === 'error' ? styles.error : styles.note) }, state.note.text) : null,
          missing.length ? h('div', { key: 'deps', style: Object.assign({}, styles.banner, styles.error) }, 'нет зависимостей: ' + missing.map((dep) => dep.id).join(', ')) : null,
          state.error ? h('div', { key: 'err', style: Object.assign({}, styles.banner, styles.error) }, 'Ошибка: ' + state.error) : null,
          showRealm ? h(RealmForm, { key: 'realm', workspaces: state.workspaces, onSaved: load }) : null,
          !showRealm && state.creating === 'epic' ? h(EpicForm, { key: 'ef', workspaces: realmWorkspaces, onSave: onSaveEpic }) : null,
          !showRealm && state.creating === 'task' ? h(TaskForm, { key: 'tf', epics, workspaces: realmWorkspaces, onSave: onSaveTask }) : null,
          !showRealm && state.loading ? h('div', { key: 'load', style: styles.hint }, 'Загрузка…') : null,
          !showRealm ? h('div', { key: 's1', style: styles.section }, 'Эпики') : null,
          !showRealm ? h('div', { key: 'b1', style: styles.board }, EPIC_COLUMNS.map((column) => columnView(column, epics.filter((card) => card.status === column.id), onAction, epicsById))) : null,
          !showRealm ? h('div', { key: 's2', style: styles.section }, 'Наряды') : null,
          !showRealm ? h('div', { key: 'b2', style: styles.board }, TASK_COLUMNS.map((column) => columnView(column, tasks.filter((card) => card.status === column.id), onAction, epicsById))) : null,
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
