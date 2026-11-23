/**
 * lib/client.js — клиентская половина: вкладка «Канбан».
 *
 * Дизайн — docs/DESIGN-PROPOSALS.md (v1.0): тема наследуется через
 * currentColor/color-mix, слой токенов §2.1, колонка 208 px, режимы деталей
 * 320 / 100 %, карточка с цветной левой гранью, бейджами и кнопками переходов.
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

    // §2.1. Токены. Цвет берётся только из currentColor и color-mix от него:
    // ни белого, ни чёрного, ни CSS-переменных, ни style-тегов (спека §6.1–6.2).
    const HAIRLINE = 'color-mix(in srgb, currentColor 16%, transparent)';
    const HAIRLINE_SOFT = 'color-mix(in srgb, currentColor 10%, transparent)';
    const HAIRLINE_STRONG = 'color-mix(in srgb, currentColor 32%, transparent)';
    const SURFACE_1 = 'color-mix(in srgb, currentColor 3%, transparent)';
    const SURFACE_2 = 'color-mix(in srgb, currentColor 7%, transparent)';
    const SURFACE_3 = 'color-mix(in srgb, currentColor 10%, transparent)';
    const SURFACE_4 = 'color-mix(in srgb, currentColor 12%, transparent)';
    const DOT_RING = '0 0 0 1px color-mix(in srgb, currentColor 26%, transparent)';
    const RING_SELECTED = '0 0 0 2px color-mix(in srgb, currentColor 40%, transparent)';
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const EASE = 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease';
    const EASE_FAST = 'background-color 100ms ease, border-color 100ms ease, box-shadow 100ms ease, opacity 100ms ease';

    const EPIC_COLUMNS = [
      { id: 'draft', label: 'Черновик', color: '#94a3b8' },
      { id: 'agreeing', label: 'Согласование', color: '#f59e0b' },
      { id: 'agreed', label: 'Согласован', color: '#06b6d4' },
      { id: 'decomposed', label: 'Разложен', color: '#8b5cf6' },
      { id: 'in-progress', label: 'В работе', color: '#3b82f6' },
      { id: 'accepted', label: 'Принят', color: '#22c55e' },
      { id: 'done', label: 'Закрыт', color: '#15803d' },
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
    const statusColor = (id) => (COLUMN_BY_ID[id] && COLUMN_BY_ID[id].color) || '#94a3b8';

    const styles = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'inherit', fontSize: 12, lineHeight: 1.45, overscrollBehaviorY: 'contain' },
      header: { display: 'flex', alignItems: 'center', gap: 8, rowGap: 6, padding: '8px 10px', borderBottom: '1px solid ' + HAIRLINE, flex: '0 0 auto', flexWrap: 'wrap' },
      headerTitle: { fontWeight: 600, fontSize: 12.5, lineHeight: 1.3, letterSpacing: '.01em', marginRight: 'auto', whiteSpace: 'nowrap' },
      headerActions: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' },
      button: { border: '1px solid ' + HAIRLINE, background: 'transparent', color: 'inherit', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500, lineHeight: 1, padding: '4px 8px', minHeight: 26, whiteSpace: 'nowrap', transition: EASE, boxSizing: 'border-box' },
      buttonOn: { border: '1px solid ' + HAIRLINE_STRONG, background: SURFACE_4, color: 'inherit', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500, lineHeight: 1, padding: '4px 8px', minHeight: 26, whiteSpace: 'nowrap', transition: EASE, boxSizing: 'border-box' },
      iconButton: { width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', fontSize: 12 },
      banner: { margin: '6px 10px 0', padding: '6px 8px', borderRadius: 8, border: '1px solid ' + HAIRLINE, borderLeftWidth: 3, fontSize: 11, flex: '0 0 auto' },
      note: { background: 'color-mix(in srgb, #f59e0b 12%, transparent)', borderColor: 'color-mix(in srgb, #f59e0b 32%, transparent)', borderLeftColor: 'color-mix(in srgb, #f59e0b 55%, transparent)' },
      ok: { background: 'color-mix(in srgb, #22c55e 12%, transparent)', borderColor: 'color-mix(in srgb, #22c55e 32%, transparent)', borderLeftColor: 'color-mix(in srgb, #22c55e 55%, transparent)' },
      error: { background: 'color-mix(in srgb, #ef4444 12%, transparent)', borderColor: 'color-mix(in srgb, #ef4444 32%, transparent)', borderLeftColor: 'color-mix(in srgb, #ef4444 55%, transparent)' },
      formError: { margin: 0, background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 32%, transparent)', borderLeftWidth: 3, borderLeftColor: 'color-mix(in srgb, #ef4444 55%, transparent)', borderRadius: 8, padding: '5px 8px', fontSize: 10.5 },
      section: { display: 'flex', alignItems: 'baseline', gap: 6, padding: '10px 12px 0', flex: '0 0 auto' },
      sectionTitle: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.66 },
      sectionCount: { marginLeft: 'auto', fontSize: 10, opacity:0.66, fontVariantNumeric: 'tabular-nums' },
      board: { display: 'flex', gap: 8, padding: 8, flex: '0 0 auto', minHeight: 0, alignItems: 'flex-start', overflowX: 'auto', scrollSnapType: 'x proximity', scrollbarWidth: 'thin' },
      column: { flex: '0 0 auto', width:208, display: 'flex', flexDirection: 'column', border: '1px solid ' + HAIRLINE, borderRadius: 10, background: SURFACE_1, overflow: 'hidden', scrollSnapAlign: 'start', transition: EASE },
      columnHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid ' + HAIRLINE_SOFT, fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, letterSpacing: '.06em', textTransform: 'uppercase', flex: '0 0 auto' },
      columnLabel: { opacity: 0.72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      dot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', boxShadow: DOT_RING },
      count: { marginLeft: 'auto', fontSize: 10, opacity:0.66, fontVariantNumeric: 'tabular-nums' },
      columnBody: { display: 'flex', flexDirection: 'column', gap: 6, padding: 6, minHeight: 40, borderRadius: 8, transition: EASE },
      dropTarget: { background: SURFACE_3, borderColor: HAIRLINE_STRONG, boxShadow: 'inset 0 0 0 1px ' + HAIRLINE_STRONG },
      card: { display: 'flex', flexDirection: 'column', gap: 4, padding: '7px 9px', border: '1px solid ' + HAIRLINE, borderRadius: 8, background: SURFACE_2, cursor: 'pointer', transition: EASE },
      cardAccent: { borderLeftWidth: 3, borderLeftStyle: 'solid' },
      cardSelected: { background: SURFACE_4, boxShadow: RING_SELECTED },
      cardDragging: { opacity: 0.5, cursor: 'grabbing' },
      cardTop: { display: 'flex', alignItems: 'center', gap: 5, minHeight: 14 },
      cardId: { fontFamily: MONO, fontSize: 10, lineHeight: 1.3, letterSpacing: '.01em', fontVariantNumeric: 'tabular-nums', opacity:0.66 },
      badge: { fontSize: 10, fontWeight: 500, lineHeight: 1.2, padding: '1px 5px', borderRadius: 999, border: '1px solid ' + HAIRLINE, opacity:0.82, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 88, minWidth: 0 },
      owner: { marginLeft: 'auto', fontSize: 10, fontWeight: 500, lineHeight: 1.2, padding: '1px 5px', borderRadius: 999, border: '1px solid ' + HAIRLINE, opacity:0.82, maxWidth: 78, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      ownerEmpty: { marginLeft: 'auto', fontSize: 10, opacity:0.66 },
      cardTitle: { fontSize: 12, fontWeight: 500, lineHeight: 1.35, wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
      meta: { fontSize: 10.5, lineHeight: 1.35, opacity: 0.72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      metaClamp: { fontSize: 10.5, lineHeight: 1.35, opacity: 0.72, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' },
      cardActions: { display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' },
      cardAction: { border: '1px solid ' + HAIRLINE, background: 'transparent', color: 'inherit', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 500, lineHeight: 1, padding: '3px 7px', minHeight: 24, opacity: 0.92, transition: EASE_FAST, boxSizing: 'border-box' },
      empty: { padding: '10px 8px', opacity:0.66, fontSize: 11, textAlign: 'center', minHeight: 40, boxSizing: 'border-box' },
      form: { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', border: '1px solid ' + HAIRLINE, borderRadius: 10, background: SURFACE_1, margin: '6px 10px 0', flex: '0 0 auto' },
      formTitle: { fontSize: 12, fontWeight: 600, lineHeight: 1.3 },
      row: { display: 'flex', flexDirection: 'column', gap: 3 },
      label: { fontSize: 10, fontWeight: 600, lineHeight: 1.3, letterSpacing: '.06em', textTransform: 'uppercase', opacity:0.66 },
      input: { border: '1px solid ' + HAIRLINE, background: 'transparent', color: 'inherit', borderRadius: 6, padding: '4px 8px', fontSize: 12, lineHeight: 1.4, minHeight: 28, width: '100%', boxSizing: 'border-box', transition: EASE, fontFamily: 'inherit' },
      checks: { display: 'flex', flexWrap: 'wrap', gap: 4 },
      check: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, lineHeight: 1.3, border: '1px solid ' + HAIRLINE, borderRadius: 999, padding: '2px 7px', background: 'transparent', cursor: 'pointer', transition: EASE },
      checkOn: { background: SURFACE_3, borderColor: HAIRLINE_STRONG, opacity: 1 },
      checkbox: { width: 12, height: 12, margin: 0, accentColor: 'currentColor' },
      actions: { display: 'flex', gap: 6, marginTop: 4 },
      hint: { fontSize: 11, opacity: 0.72, padding: '6px 10px', flex: '0 0 auto' },
      main: { display: 'flex', flex: 1, minHeight: 0, minWidth: 0 },
      boardWrap: { flex: 1, minWidth: 0, overflow: 'auto', overscrollBehaviorY: 'contain' },
      detailsPanel: { width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'transparent' },
      detailsPanelWide: { width: 320, flex: '0 0 auto', borderLeft: '1px solid ' + HAIRLINE },
      detailsHead: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderBottom: '1px solid ' + HAIRLINE, flex: '0 0 auto' },
      detailsHeadCol: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
      detailsId: { fontFamily: MONO, fontSize: 10, lineHeight: 1.3, letterSpacing: '.01em', opacity:0.66 },
      detailsTitle: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, flex: 1, minWidth: 0, wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
      detailsScroll: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px 12px', scrollbarWidth: 'thin' },
      detailsGroup: { display: 'grid', gridTemplateColumns: '74px 1fr', gap: '3px 8px', padding: '7px 8px', borderRadius: 8, background: SURFACE_1, border: '1px solid ' + HAIRLINE_SOFT },
      detailsLabel: { fontSize: 9.5, lineHeight: 1.3, letterSpacing: '.06em', textTransform: 'uppercase', opacity:0.66 },
      detailsValue: { fontSize: 11, lineHeight: 1.35, opacity: 0.9, wordBreak: 'break-word', minWidth: 0 },
      statusValue: { display: 'inline-flex', alignItems: 'center', gap: 5 },
      detailsDivider: { borderTop: '1px solid ' + HAIRLINE_SOFT },
      bodyText: { whiteSpace: 'pre-wrap', fontSize: 11.5, lineHeight: 1.55, opacity: 0.88, overflowWrap: 'anywhere' },
      journal: { display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '1px solid ' + HAIRLINE_SOFT, marginLeft: 3, paddingLeft: 8 },
      journalRow: { display: 'flex', flexDirection: 'column', gap: 2, padding: '3px 0' },
      journalHead: { display: 'flex', gap: 6, alignItems: 'baseline' },
      journalTime: { fontFamily: MONO, fontSize: 10, lineHeight: 1.3, letterSpacing: '.01em', fontVariantNumeric: 'tabular-nums', opacity:0.66, whiteSpace: 'nowrap' },
      journalFlow: { display: 'flex', gap: 3, alignItems: 'center', fontSize: 11, opacity: 0.9 },
      journalDot: { width: 6, height: 6, borderRadius: '50%', boxShadow: DOT_RING, flex: '0 0 auto' },
      journalArrow: { opacity:0.66 },
      journalBy: { marginLeft: 'auto', fontSize: 10, lineHeight: 1.3, opacity:0.66, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      detailsEmpty: { fontSize: 10.5, lineHeight: 1.35, opacity:0.66, padding: '2px 0' },
      setupForm: { maxWidth: 480, width: 'calc(100% - 20px)', margin: '10px auto 0' },
    };

    // §4.3: составные ключи — «button + …».
    styles.primary = Object.assign({}, styles.button, { background: SURFACE_4, borderColor: HAIRLINE_STRONG, fontWeight: 600, padding: '5px 10px' });
    styles.textarea = Object.assign({}, styles.input, { minHeight: 72, maxHeight: 200, resize: 'vertical', lineHeight: 1.45 });
    styles.boardWrapHidden = Object.assign({}, styles.boardWrap, { display: 'none' });
    styles.setupForm = Object.assign({}, styles.form, styles.setupForm);

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
    // §4.5: время журнала — только представление, данные не меняются.
    const formatTime = (value) => String(value || '').slice(0, 16).replace('T', ' ');

    const Card = React.memo(function Card(props) {
      const card = props.card;
      const column = COLUMN_BY_ID[card.status] || { color: '#94a3b8' };
      const allowed = Array.isArray(card.allowed) ? card.allowed : [];
      const baseStyle = Object.assign({}, styles.card, styles.cardAccent, props.selected ? styles.cardSelected : null);
      const cardStyle = Object.assign({}, baseStyle, { borderLeftColor: column.color });
      const metaRows = [];
      if (card.blocked_by && card.blocked_by.length) metaRows.push({ key: 'blocked', text: 'ждёт: ' + card.blocked_by.join(', '), title: card.blocked_by.join(', ') });
      if (card.epic) metaRows.push({ key: 'epic', text: 'эпик: ' + (props.epicTitle || '#' + shortId(card.epic)), title: card.epic });
      if (card.role) metaRows.push({ key: 'role', text: 'роль: ' + card.role, title: card.role });
      if (card.evidence && card.evidence.length) metaRows.push({ key: 'ev', text: 'доказательств: ' + card.evidence.length });
      if (card.involved && card.involved.length) {
        const done = card.involved.filter((id) => card.agreed && card.agreed[id]).length;
        metaRows.push({ key: 'agree', text: 'согласны ' + done + '/' + card.involved.length });
      }
      if (card.subtasks && card.subtasks.total) metaRows.push({ key: 'sub', text: 'подзадачи: ' + card.subtasks.done + '/' + card.subtasks.total });
      const children = [
        h('div', { key: 'top', style: styles.cardTop }, [
          h('span', { key: 'id', style: styles.cardId, title: card.id }, '#' + shortId(card.id)),
          card.workspace ? h('span', { key: 'ws', style: styles.badge, title: 'воркспейс ' + card.workspace }, card.workspace) : null,
          card.owner ? h('span', { key: 'owner', style: styles.owner, title: card.owner }, shortOwner(card.owner)) : h('span', { key: 'free', style: styles.ownerEmpty }, 'свободен'),
        ]),
        h('div', { key: 'title', style: styles.cardTitle, title: String(card.title || card.claim || '') }, card.title || card.claim || ''),
      ];
      if (card.result) children.push(h('div', { key: 'result', style: styles.metaClamp, title: String(card.result) }, String(card.result)));
      for (const row of metaRows.slice(0, 2)) children.push(h('div', { key: row.key, style: styles.meta, title: row.title || row.text }, row.text));
      if (allowed.length) children.push(h('div', { key: 'act', style: styles.cardActions }, allowed.map((to) => h('button', {
        key: to, type: 'button', style: styles.cardAction, onClick: (event) => { event.stopPropagation(); props.onAction(card, to); },
        title: 'Перевести ' + card.id + ': ' + label(card.status) + ' → ' + label(to),
      }, '→ ' + label(to)))));
      return h('article', {
        key: card.id, style: cardStyle,
        title: card.id + ' · ' + label(card.status), 'data-kanban-card': card.id,
        role: 'button', tabIndex: 0,
        'aria-expanded': Boolean(props.selected),
        'aria-label': String(card.title || card.claim || card.id),
        draggable: allowed.length > 0,
        onClick: () => { if (props.onSelect) props.onSelect(card.id); },
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            if (props.onSelect) props.onSelect(card.id);
            return;
          }
          const cardNode = event.currentTarget;
          const columnNode = cardNode.closest('[data-kanban-column]');
          if (!columnNode) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const sectionNode = columnNode.closest('[data-kanban-section]');
            if (!sectionNode) return;
            const columns = Array.prototype.slice.call(sectionNode.querySelectorAll('[data-kanban-column]'));
            const index = columns.indexOf(columnNode);
            const step = event.key === 'ArrowRight' ? 1 : -1;
            for (let i = index + step; i >= 0 && i < columns.length; i += step) {
              const target = columns[i].querySelector('[data-kanban-card]');
              if (target) { event.preventDefault(); target.focus(); return; }
            }
            return;
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') return;
          const cards = Array.prototype.slice.call(columnNode.querySelectorAll('[data-kanban-card]'));
          const index = cards.indexOf(cardNode);
          if (index < 0) return;
          let next = index;
          if (event.key === 'ArrowUp') next = index - 1;
          else if (event.key === 'ArrowDown') next = index + 1;
          else if (event.key === 'Home') next = 0;
          else next = cards.length - 1;
          if (next < 0 || next >= cards.length || next === index) return;
          event.preventDefault();
          cards[next].focus();
        },
        onMouseEnter: (event) => {
          const node = event.currentTarget;
          node.style.background = SURFACE_3;
          node.style.borderColor = HAIRLINE_STRONG;
        },
        onMouseLeave: (event) => {
          const node = event.currentTarget;
          node.style.background = baseStyle.background;
          node.style.borderColor = HAIRLINE;
          node.style.boxShadow = baseStyle.boxShadow || 'none';
        },
        onDragStart: (event) => {
          const node = event.currentTarget;
          if (event.dataTransfer) {
            event.dataTransfer.setData('text/plain', card.id);
            event.dataTransfer.effectAllowed = 'move';
          }
          node.style.opacity = String(styles.cardDragging.opacity);
          node.style.cursor = styles.cardDragging.cursor;
          if (props.onDragBegin) props.onDragBegin({ id: card.id, section: props.section, allowed });
        },
        onDragEnd: (event) => {
          const node = event.currentTarget;
          node.style.opacity = '';
          node.style.cursor = '';
          if (props.onDragEnd) props.onDragEnd();
        },
      }, children);
    });

    function cardDetails(props) {
      const details = props.details || {};
      const card = details.card || {};
      const meta = card.meta || {};
      const journalFor = Array.isArray(details.journal) ? details.journal : [];
      const closeRef = React.useRef(null);
      React.useEffect(() => {
        if (closeRef.current && typeof closeRef.current.focus === 'function') closeRef.current.focus();
      }, []);
      const panelStyle = props.wide ? Object.assign({}, styles.detailsPanel, styles.detailsPanelWide) : styles.detailsPanel;
      const title = String(meta.title || meta.id || '');
      const idText = String(meta.id || card.id || '');
      const bodyText = String(card.body || '');
      const metaRows = [
        ['статус', h('span', { key: 'status', style: styles.statusValue }, [
          h('span', { key: 'd', style: Object.assign({}, styles.dot, { background: statusColor(meta.status) }) }),
          h('span', { key: 'l' }, label(meta.status)),
        ])],
        ['воркспейс', meta.workspace || '—'],
        ['owner', meta.owner || '—'],
        ['lease', meta.lease_until || '—'],
        ['evidence', String((meta.evidence && meta.evidence.length) || 0)],
        ['подзадачи', String((meta.subtasks && meta.subtasks.done) || 0) + '/' + String((meta.subtasks && meta.subtasks.total) || 0)],
      ];
      return h('aside', {
        style: panelStyle, role: 'dialog', 'aria-label': 'Детали карточки', tabIndex: -1,
        onKeyDown: (event) => {
          if (event.key === 'Escape') { event.stopPropagation(); props.onClose(); }
        },
      }, [
        h('div', { key: 'head', style: styles.detailsHead }, [
          h('div', { key: 'col', style: styles.detailsHeadCol }, [
            h('div', { key: 'id', style: styles.detailsId, title: idText }, '#' + shortId(idText)),
            h('div', { key: 't', style: styles.detailsTitle, title }, title),
          ]),
          h('button', { key: 'x', ref: closeRef, type: 'button', style: styles.iconButton, onClick: props.onClose, 'aria-label': 'Закрыть детали', title: 'Закрыть детали' }, '✕'),
        ]),
        h('div', { key: 'scroll', style: styles.detailsScroll }, [
          h('div', { key: 'meta', style: styles.detailsGroup }, metaRows.reduce((acc, row) => {
            acc.push(h('div', { key: 'l-' + row[0], style: styles.detailsLabel }, row[0]));
            acc.push(h('div', { key: 'v-' + row[0], style: styles.detailsValue }, row[1]));
            return acc;
          }, [])),
          bodyText ? h('div', { key: 'd1', style: styles.detailsDivider }) : null,
          bodyText ? h('div', { key: 'body', style: styles.bodyText }, bodyText) : null,
          h('div', { key: 'd2', style: styles.detailsDivider }),
          h('div', { key: 'jl', style: styles.sectionTitle }, 'журнал'),
          journalFor.length
            ? h('div', { key: 'je', style: styles.journal }, journalFor.map((event, index) => h('div', {
              key: 'j' + index,
              style: index ? Object.assign({}, styles.journalRow, { borderTop: '1px solid ' + HAIRLINE_SOFT }) : styles.journalRow,
            }, [
              h('div', { key: 'h', style: styles.journalHead }, [
                h('span', { key: 't', style: styles.journalTime }, formatTime(event.at)),
                h('span', { key: 'b', style: styles.journalBy, title: String(event.by || '') }, String(event.by || '')),
              ]),
              h('div', { key: 'f', style: styles.journalFlow }, [
                h('span', { key: 'fd', style: Object.assign({}, styles.journalDot, { background: statusColor(event.from) }) }),
                h('span', { key: 'from' }, label(event.from)),
                h('span', { key: 'a', style: styles.journalArrow }, '→'),
                h('span', { key: 'td', style: Object.assign({}, styles.journalDot, { background: statusColor(event.to) }) }),
                h('span', { key: 'to' }, label(event.to)),
              ]),
            ])))
            : h('div', { key: 'je', style: styles.detailsEmpty }, 'событий нет'),
        ]),
      ]);
    }

    function columnView(column, cards, section, ctx) {
      return h('div', { key: column.id, style: styles.column, 'data-kanban-column': section + ':' + column.id }, [
        h('div', { key: 'h', style: styles.columnHeader }, [
          h('span', { key: 'd', style: Object.assign({}, styles.dot, { background: column.color }) }),
          h('span', { key: 'l', style: styles.columnLabel, title: column.label }, column.label),
          h('span', { key: 'c', style: styles.count }, String(cards.length)),
        ]),
        h('div', {
          key: 'b', style: styles.columnBody,
          onDragOver: (event) => {
            const drag = ctx.dragRef.current;
            if (!drag || drag.section !== section || drag.allowed.indexOf(column.id) === -1) { ctx.resetDrop(); return; }
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            if (ctx.dropRef.current !== event.currentTarget) {
              ctx.resetDrop();
              ctx.dropRef.current = event.currentTarget;
              event.currentTarget.style.background = styles.dropTarget.background;
              event.currentTarget.style.boxShadow = styles.dropTarget.boxShadow;
            }
          },
          onDragLeave: (event) => {
            if (ctx.dropRef.current !== event.currentTarget) return;
            const related = event.relatedTarget;
            if (related && event.currentTarget.contains(related)) return;
            ctx.resetDrop();
          },
          onDrop: (event) => {
            const drag = ctx.dragRef.current;
            const dragged = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
            ctx.resetDrop();
            ctx.dragRef.current = null;
            if (!drag || !dragged || drag.section !== section || drag.id !== dragged || drag.allowed.indexOf(column.id) === -1) return;
            event.preventDefault();
            ctx.onDropTo(section, column.id, dragged);
          },
        }, cards.length ? cards.map((card) => h(Card, {
          key: card.id,
          card,
          section,
          selected: ctx.selectedId === card.id,
          epicTitle: card.epic ? (ctx.epicsById[card.epic] ? ctx.epicsById[card.epic].title : '#' + shortId(card.epic)) : null,
          onAction: ctx.onAction,
          onSelect: ctx.onSelect,
          onDragBegin: ctx.onDragBegin,
          onDragEnd: ctx.onDragEnd,
        })) : h('div', { key: 'empty', style: styles.empty }, '—')),
      ]);
    }

    function choose(value, onChange) {
      return { value, onChange: (event) => onChange(event.target.value) };
    }

    function RealmForm(props) {
      const uid = React.useId();
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
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
        } finally {
          setSaving(false);
        }
      };
      return h('div', { style: styles.setupForm }, [
        h('div', { key: 't', style: styles.formTitle }, 'Настроить реалм'),
        h('div', { key: 'row1', style: styles.row }, [
          h('label', { key: 'l', style: styles.label, htmlFor: uid + '-architect' }, 'Корень архитектора'),
          h('select', { key: 's', id: uid + '-architect', style: styles.input, ...choose(architect, setArchitect) },
            workspaces.map((item) => h('option', { key: item.path, value: item.path }, item.title || item.path))),
        ]),
        h('div', { key: 'l2', style: styles.label }, 'Воркспейсы-исполнители'),
        h('div', { key: 'list', style: styles.checks }, workspaces.filter((item) => item.path !== architect).map((item) => h('label', { key: item.path, style: Object.assign({}, styles.check, selected[item.path] ? styles.checkOn : null) }, [
          h('input', { key: 'i', type: 'checkbox', style: styles.checkbox, checked: Boolean(selected[item.path]), onChange: () => toggle(item.path) }),
          item.title || basename(item.path),
        ]))),
        h('div', { key: 'a', style: styles.actions }, h('button', { type: 'button', style: saving ? styles.buttonOn : styles.primary, onClick: save, disabled: saving }, saving ? 'Сохраняю…' : 'Сохранить реалм')),
        error ? h('div', { key: 'e', style: styles.formError }, 'Ошибка: ' + error) : null,
      ]);
    }

    function EpicForm(props) {
      const uid = React.useId();
      const [title, setTitle] = React.useState('');
      const [involved, setInvolved] = React.useState({});
      const [result, setResult] = React.useState('');
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
            result: String(result).trim(),
            involved: Object.keys(involved).filter((key) => involved[key]),
          });
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
        } finally {
          setSaving(false);
        }
      };
      return h('div', { style: styles.form }, [
        h('div', { key: 't', style: styles.formTitle }, 'Создать эпик'),
        h('div', { key: 'r2', style: styles.row }, [
          h('label', { key: 'l', style: styles.label, htmlFor: uid + '-title' }, 'Название'),
          h('input', { key: 'i', id: uid + '-title', style: styles.input, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? uid + '-error' : undefined, ...choose(title, setTitle) }),
        ]),
        h('div', { key: 'l3', style: styles.label }, 'Участники (involved)'),
        h('div', { key: 'inv', style: styles.checks }, workspaces.map((item) => h('label', { key: item.id, style: Object.assign({}, styles.check, involved[item.id] ? styles.checkOn : null) }, [
          h('input', { key: 'i', type: 'checkbox', style: styles.checkbox, checked: Boolean(involved[item.id]), onChange: () => toggle(item.id) }),
          item.id,
        ]))),
        h('div', { key: 'r4', style: styles.row }, [
          h('label', { key: 'l', style: styles.label, htmlFor: uid + '-result' }, 'Результат'),
          h('textarea', { key: 'i', id: uid + '-result', style: styles.textarea, ...choose(result, setResult) }),
        ]),
        h('div', { key: 'a', style: styles.actions }, h('button', { type: 'button', style: saving ? styles.buttonOn : styles.primary, onClick: save, disabled: saving }, saving ? 'Создаю…' : 'Создать эпик')),
        error ? h('div', { key: 'e', id: uid + '-error', style: styles.formError }, 'Ошибка: ' + error) : null,
      ]);
    }

    function TaskForm(props) {
      const uid = React.useId();
      const epics = Array.isArray(props.epics) ? props.epics : [];
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
      const [epic, setEpic] = React.useState((epics[0] && epics[0].id) || '');
      const [title, setTitle] = React.useState('');
      const [workspace, setWorkspace] = React.useState((workspaces[0] && workspaces[0].id) || '');
      const [spec, setSpec] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const save = async () => {
        if (!epic) { setError('выберите эпик'); return; }
        setSaving(true); setError(null);
        try {
          await props.onSave({ epic, title: String(title).trim(), workspace, spec: String(spec).trim() });
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
        } finally {
          setSaving(false);
        }
      };
      return h('div', { style: styles.form }, [
        h('div', { key: 't', style: styles.formTitle }, 'Создать наряд'),
        h('div', { key: 'r2', style: styles.row }, [
          h('label', { key: 'l', style: styles.label, htmlFor: uid + '-epic' }, 'Эпик'),
          h('select', { key: 's', id: uid + '-epic', style: styles.input, ...choose(epic, setEpic) },
            epics.map((item) => h('option', { key: item.id, value: item.id }, item.title || ('#' + shortId(item.id))))),
        ]),
        h('div', { key: 'r1', style: styles.row }, [
          h('label', { key: 'l', style: styles.label, htmlFor: uid + '-title' }, 'Название'),
          h('input', { key: 'i', id: uid + '-title', style: styles.input, ...choose(title, setTitle) }),
        ]),
        h('div', { key: 'r3', style: styles.row }, [
          h('label', { key: 'l', style: styles.label, htmlFor: uid + '-ws' }, 'Воркспейс'),
          h('select', { key: 's', id: uid + '-ws', style: styles.input, ...choose(workspace, setWorkspace) },
            workspaces.map((item) => h('option', { key: item.id, value: item.id }, item.id))),
        ]),
        h('div', { key: 'r4', style: styles.row }, [
          h('label', { key: 'l', style: styles.label, htmlFor: uid + '-spec' }, 'Спека работы'),
          h('textarea', { key: 'i', id: uid + '-spec', style: styles.textarea, ...choose(spec, setSpec) }),
        ]),
        h('div', { key: 'a', style: styles.actions }, h('button', { type: 'button', style: saving ? styles.buttonOn : styles.primary, onClick: save, disabled: saving }, saving ? 'Создаю…' : 'Создать наряд')),
        error ? h('div', { key: 'e', id: uid + '-error', style: styles.formError }, 'Ошибка: ' + error) : null,
      ]);
    }

    function createView() {
      return function KanbanView() {
        const [state, setState] = React.useState({ loading: true, error: null, board: null, status: null, workspaces: [], realm: null, editing: false, creating: null, note: null });
        const [details, setDetails] = React.useState(null);
        const [viewportWidth, setViewportWidth] = React.useState(0);
        const rootRef = React.useRef(null);
        const detailsIdRef = React.useRef(null);
        const dragRef = React.useRef(null);
        const dropRef = React.useRef(null);

        const resetDrop = React.useCallback(() => {
          const node = dropRef.current;
          if (node) {
            node.style.background = '';
            node.style.boxShadow = '';
          }
          dropRef.current = null;
        }, []);

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
            // P2/D8: последняя доска остаётся, чтобы сеть не стирала контекст.
            setState((prev) => ({ ...prev, loading: false, error: String(e && e.message ? e.message : e) }));
          }
        }, []);
        React.useEffect(() => { load(); }, [load]);

        // §4.5: ширина вкладки решает режим деталей; до первого измерения — узкий.
        React.useEffect(() => {
          const node = rootRef.current;
          if (!node || typeof ResizeObserver === 'undefined') return undefined;
          const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = Math.round(entry && entry.contentRect ? entry.contentRect.width : node.clientWidth);
            setViewportWidth((prev) => (prev === width ? prev : width));
          });
          observer.observe(node);
          return () => observer.disconnect();
        }, []);
        const detailsWide = viewportWidth >= 640;

        const onAction = React.useCallback(async (card, to) => {
          try {
            const result = await postJson('/api/transition', { confirm: true, card: card.id, from: card.status, to, by: 'architect', revision: card.revision });
            await load();
            setState((prev) => ({ ...prev, note: { kind: result.ok ? 'ok' : 'note', text: card.id + ': ' + label(card.status) + ' → ' + label(to) + (result.ok ? '' : ' — ' + (result.reason || result.code)) } }));
            // P1/§4.5: открытые детали перечитываются; исчезнувшая карточка закрывает их.
            const openId = detailsIdRef.current;
            if (openId && openId === card.id) {
              try {
                const data = await getJson('/api/card/' + encodeURIComponent(openId));
                setDetails(data);
              } catch (e) {
                detailsIdRef.current = null;
                setDetails(null);
              }
            }
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
        const onSelect = React.useCallback(async (id) => {
          detailsIdRef.current = id;
          try {
            const data = await getJson('/api/card/' + encodeURIComponent(id));
            if (detailsIdRef.current === id) setDetails(data);
          } catch (e) {
            if (detailsIdRef.current === id) detailsIdRef.current = null;
            setState((prev) => ({ ...prev, note: { kind: 'error', text: String(e && e.message ? e.message : e) } }));
          }
        }, []);
        const onCloseDetails = React.useCallback(() => {
          const openId = detailsIdRef.current;
          detailsIdRef.current = null;
          setDetails(null);
          if (openId && typeof document !== 'undefined') {
            setTimeout(() => {
              const selectorId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(openId) : String(openId).replace(/["\\]/gu, '\\$&');
              const node = document.querySelector('[data-kanban-card="' + selectorId + '"]');
              if (node && typeof node.focus === 'function') node.focus();
            }, 0);
          }
        }, []);
        const onDragBegin = React.useCallback((drag) => { dragRef.current = drag; }, []);
        const onDragEnd = React.useCallback(() => { dragRef.current = null; resetDrop(); }, [resetDrop]);
        const onSaveEpic = React.useCallback(async (input) => { await postJson('/api/epic', { confirm: true, ...input }); await load(); }, [load]);
        const onSaveTask = React.useCallback(async (input) => { await postJson('/api/task', { confirm: true, ...input }); await load(); }, [load]);

        const status = state.status;
        const deps = status && Array.isArray(status.dependencies) ? status.dependencies : [];
        const missing = deps.filter((dep) => dep.installed === false && !dep.optional);
        const configured = Boolean(status && status.realm && status.realm.configured);
        const realmWorkspaces = state.realm && Array.isArray(state.realm.workspaces) ? state.realm.workspaces : [];
        const epics = React.useMemo(() => (state.board && Array.isArray(state.board.epics) ? state.board.epics : []), [state.board]);
        const tasks = React.useMemo(() => (state.board && Array.isArray(state.board.tasks) ? state.board.tasks : []), [state.board]);
        const epicsById = React.useMemo(() => {
          const map = {};
          for (const epic of epics) map[epic.id] = epic;
          return map;
        }, [epics]);
        // §4.5: группировка по статусу — один раз на доску, не на рендер.
        const grouped = React.useMemo(() => {
          const emptyMap = () => {
            const map = Object.create(null);
            for (const column of EPIC_COLUMNS) map[column.id] = [];
            for (const column of TASK_COLUMNS) map[column.id] = [];
            return map;
          };
          const epicMap = emptyMap();
          const taskMap = emptyMap();
          for (const card of epics) { if (epicMap[card.status]) epicMap[card.status].push(card); }
          for (const card of tasks) { if (taskMap[card.status]) taskMap[card.status].push(card); }
          return { epics: epicMap, tasks: taskMap };
        }, [epics, tasks]);
        const onDropTo = (section, columnId, id) => {
          const list = section === 'epics' ? epics : tasks;
          const card = list.find((item) => item.id === id);
          if (card && Array.isArray(card.allowed) && card.allowed.indexOf(columnId) !== -1) onAction(card, columnId);
        };
        const showRealm = !configured || state.editing;
        const selectedId = details && details.card ? details.card.id : null;
        const columnContext = { dragRef, dropRef, resetDrop, onAction, onSelect, onDragBegin, onDragEnd, onDropTo, epicsById, selectedId };

        return h('div', { ref: rootRef, style: styles.root, 'aria-busy': state.loading ? true : undefined }, [
          h('div', { key: 'head', style: styles.header }, [
            h('span', { key: 't', style: styles.headerTitle }, VIEW_LABEL),
            h('div', { key: 'actions', style: styles.headerActions }, [
              h('button', { key: 'reload', type: 'button', style: styles.button, onClick: load, title: 'Перечитать карточки и журнал', 'aria-label': 'Обновить' }, '↻'),
              h('button', { key: 'sweep', type: 'button', style: styles.button, onClick: onSweep, title: 'Прочитать письма обмена, применить переходы, проверить лизы' }, 'Обход'),
              h('button', { key: 'epic', type: 'button', style: state.creating === 'epic' ? styles.buttonOn : styles.button, onClick: () => setState((prev) => ({ ...prev, creating: prev.creating === 'epic' ? null : 'epic' })), title: 'Создать эпик' }, '+ Эпик'),
              h('button', { key: 'task', type: 'button', style: state.creating === 'task' ? styles.buttonOn : styles.button, onClick: () => setState((prev) => ({ ...prev, creating: prev.creating === 'task' ? null : 'task' })), title: 'Создать наряд под эпиком' }, '+ Наряд'),
              h('button', { key: 'cfg', type: 'button', style: state.editing ? styles.buttonOn : styles.button, onClick: () => setState((prev) => ({ ...prev, editing: !prev.editing })), title: 'Настроить реалм' }, 'Реалм'),
            ]),
          ]),
          state.note ? h('div', {
            key: 'note',
            role: state.note.kind === 'error' ? 'alert' : 'status',
            'aria-live': state.note.kind === 'error' ? 'assertive' : 'polite',
            style: Object.assign({}, styles.banner, state.note.kind === 'ok' ? styles.ok : state.note.kind === 'error' ? styles.error : styles.note),
          }, state.note.text) : null,
          missing.length ? h('div', { key: 'deps', role: 'alert', style: Object.assign({}, styles.banner, styles.error) }, 'нет зависимостей: ' + missing.map((dep) => dep.id).join(', ')) : null,
          state.error ? h('div', { key: 'err', role: 'alert', style: Object.assign({}, styles.banner, styles.error) }, 'Ошибка: ' + state.error) : null,
          showRealm ? h(RealmForm, { key: 'realm', workspaces: state.workspaces, onSaved: load }) : null,
          !showRealm && state.creating === 'epic' ? h(EpicForm, { key: 'ef', workspaces: realmWorkspaces, onSave: onSaveEpic }) : null,
          !showRealm && state.creating === 'task' ? h(TaskForm, { key: 'tf', epics, workspaces: realmWorkspaces, onSave: onSaveTask }) : null,
          !showRealm && state.loading ? h('div', { key: 'load', style: styles.hint }, 'Загрузка…') : null,
          !showRealm ? h('div', { key: 'row', style: styles.main }, [
            h('div', { key: 'board', style: details && !detailsWide ? styles.boardWrapHidden : styles.boardWrap }, [
              h('div', { key: 's1', style: styles.section }, [
                h('span', { key: 't', style: styles.sectionTitle }, 'Эпики'),
                h('span', { key: 'c', style: styles.sectionCount }, String(epics.length)),
              ]),
              h('div', { key: 'b1', style: styles.board, 'data-kanban-section': 'epics' }, EPIC_COLUMNS.map((column) => columnView(column, grouped.epics[column.id] || [], 'epics', columnContext))),
              h('div', { key: 's2', style: styles.section }, [
                h('span', { key: 't', style: styles.sectionTitle }, 'Наряды'),
                h('span', { key: 'c', style: styles.sectionCount }, String(tasks.length)),
              ]),
              h('div', { key: 'b2', style: styles.board, 'data-kanban-section': 'tasks' }, TASK_COLUMNS.map((column) => columnView(column, grouped.tasks[column.id] || [], 'tasks', columnContext))),
            ]),
            details ? h(cardDetails, { key: 'details', details, wide: detailsWide, onClose: onCloseDetails }) : null,
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
