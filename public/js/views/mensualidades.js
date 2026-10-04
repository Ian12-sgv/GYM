import { api } from '../api.js';
import { mountRenewPanel } from '../renew.js';
import { openMemberCard } from '../member.js';
import {
  store, html, setHTML, money, fmtDay, fmtDateTime, toast, openModal, statusChip, dueText, waLink, reminderText, fmtMonthLong, todayStr,
} from '../ui.js';

const FILTERS = [
  { key: 'action', label: 'Requieren acción' },
  { key: 'all', label: 'Todas' },
  { key: 'soon', label: 'Por vencer' },
  { key: 'grace', label: 'En gracia' },
  { key: 'late', label: 'Vencidas' },
  { key: 'inactive', label: 'Inactivos' },
];

const TILES = [
  { key: 'ok', label: 'Al día', hint: 'Pueden entrar sin problema', color: 'var(--green)' },
  { key: 'soon', label: 'Por vencer', hint: (s) => `Vencen en ${s.soon_days} días o menos`, color: 'var(--amber)' },
  { key: 'grace', label: 'En gracia', hint: (s) => `Vencidas 1–${s.grace_days} días, aún entran`, color: 'var(--orange)' },
  { key: 'late', label: 'Vencidas', hint: 'No entran hasta renovar', color: 'var(--red)' },
];

export async function render(root, params) {
  let filter = params.get('filtro') ?? 'action';
  let firstLoad = true;
  let query = '';
  let members = [];
  let billing = null;

  setHTML(
    root,
    html`<div class="stack" style="gap: 18px;">
      <div class="tiles" id="tiles"></div>
      <section class="card stack">
        <div class="row">
          <div class="pill-filters" role="group" aria-label="Filtrar por estado" id="filters"></div>
        </div>
        <p class="small muted" id="filter-hint" style="margin: -4px 0 0;"></p>
        <div class="row">
          <label for="search" class="sr-only">Buscar miembro</label>
          <input id="search" class="input" type="search" placeholder="Buscar por nombre, cédula o código" style="flex: 1; min-width: 200px; max-width: 420px; height: 44px;">
          <button type="button" class="btn primary" id="bulk" style="margin-left: auto;">Recordar por WhatsApp</button>
        </div>
        <div class="table-wrap" id="table"></div>
      </section>
    </div>`
  );

  const tilesEl = root.querySelector('#tiles');
  const filtersEl = root.querySelector('#filters');
  const tableEl = root.querySelector('#table');
  const bulkBtn = root.querySelector('#bulk');

  function renderTiles() {
    const s = store.config.settings;
    const month = fmtMonthLong(todayStr());
    const pct = billing.expected_cents ? Math.round((billing.collected_cents / billing.expected_cents) * 100) : 0;
    setHTML(
      tilesEl,
      html`${TILES.map(
        (t) => html`<button type="button" class="card tight" data-filter="${t.key}" style="text-align: left; border: 0; color: inherit;">
          <div class="row small soft" style="gap: 8px; font-weight: 500;"><span class="dot" style="background: ${t.color};"></span>${t.label}</div>
          <div class="display big">${billing.counts[t.key]}</div>
          <div class="small muted">${typeof t.hint === 'function' ? t.hint(s) : t.hint}</div>
        </button>`
      )}
      <section class="card tight stack" style="gap: 8px; grid-column: span 2; justify-content: space-between;">
        <div class="card-label">Mensualidades cobradas en ${month}</div>
        <div class="row" style="align-items: baseline; gap: 8px;">
          <span class="display big">${money(billing.collected_cents)}</span>
          <span class="muted">de ${money(billing.expected_cents)} esperados</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width: ${pct}%;"></div></div>
      </section>`
    );
    tilesEl.querySelectorAll('[data-filter]').forEach((b) =>
      b.addEventListener('click', () => setFilter(b.dataset.filter === 'ok' ? 'all' : b.dataset.filter))
    );
  }

  function filterCount(key) {
    if (key === 'action') return billing.action;
    if (key === 'all') return billing.all;
    return billing.counts[key];
  }

  function renderFilters() {
    root.querySelector('#filter-hint').textContent =
      filter === 'action' ? 'Requieren acción = por vencer, en gracia o vencidas: a quienes hay que recordarles o cobrarles.' : '';
    setHTML(
      filtersEl,
      FILTERS.map(
        (f) => html`<button type="button" class="opt" data-value="${f.key}" aria-pressed="${String(f.key === filter)}">${f.label} · ${filterCount(f.key)}</button>`
      )
    );
  }
  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (b) setFilter(b.dataset.value);
  });

  function remindable() {
    return members.filter((m) => m.status.key !== 'ok' && waLink(m.phone, ''));
  }

  function renderTable() {
    const targets = remindable();
    bulkBtn.textContent = `Recordar por WhatsApp (${targets.length})`;
    bulkBtn.disabled = targets.length === 0;
    if (!members.length) {
      const empty = query
        ? 'Nadie coincide con la búsqueda.'
        : filter === 'action'
          ? 'Nadie requiere acción: todos los miembros están al día.'
          : filter === 'all'
            ? 'Todavía no hay miembros. Inscríbelos en la pestaña "Nuevo miembro".'
            : 'No hay miembros en este estado.';
      setHTML(tableEl, html`<div class="empty">${empty}</div>`);
      return;
    }
    setHTML(
      tableEl,
      html`<table class="table">
        <thead><tr>
          <th>Miembro</th><th>Plan</th><th>Vence</th><th>Estado</th><th>Último aviso</th><th>Acciones</th>
        </tr></thead>
        <tbody>
          ${members.map(
            (m) => html`<tr>
              <td>
                <button type="button" class="link-btn" data-open="${m.id}">${m.name}</button>
                <div class="small muted">${m.cedula} · ${m.code}</div>
              </td>
              <td class="soft">${m.plan_name}</td>
              <td class="soft tnum">${fmtDay(m.due_date)}<div class="small muted">${dueText(m.status)}</div></td>
              <td>${statusChip(m.status)}</td>
              <td class="small muted">${m.last_reminder_at ? fmtDateTime(m.last_reminder_at) : '—'}</td>
              <td><span class="actions">
                ${m.status.key !== 'ok' && waLink(m.phone, '')
                  ? html`<button type="button" class="btn sm" data-remind="${m.id}">Recordar</button>`
                  : ''}
                <button type="button" class="btn sm light" data-renew="${m.id}">Cobrar</button>
              </span></td>
            </tr>`
          )}
        </tbody>
      </table>`
    );
  }

  const byId = (id) => members.find((m) => m.id === Number(id));

  tableEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open], [data-remind], [data-renew]');
    if (!t) return;
    if (t.dataset.open) openMemberCard(Number(t.dataset.open), { onChange: load });
    if (t.dataset.remind) remind(byId(t.dataset.remind));
    if (t.dataset.renew) renewModal(byId(t.dataset.renew));
  });

  // window.open debe ir directo en el clic para que el navegador no lo bloquee.
  async function remind(m) {
    window.open(waLink(m.phone, reminderText(m)), '_blank', 'noopener');
    try {
      await api(`/members/${m.id}/remind`, { method: 'POST' });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renewModal(m) {
    const modal = openModal('Renovar membresía', html`<div data-panel></div>`);
    mountRenewPanel(modal.el.querySelector('[data-panel]'), m, {
      title: '',
      askCheckin: true,
      onCancel: () => modal.close(),
      onDone: ({ member }) => {
        modal.close();
        toast(`Renovado: ${member.name} hasta el ${fmtDay(member.due_date)}`);
        load();
      },
    });
  }

  bulkBtn.addEventListener('click', () => {
    const targets = remindable();
    const modal = openModal(
      `Recordar a ${targets.length}`,
      html`<p class="small muted" style="margin-top: 0;">WhatsApp no permite enviar a varios a la vez desde un enlace: toca cada botón y envía el mensaje que ya va escrito.</p>
        ${targets.map(
          (m) => html`<div class="list-row">
            <span class="grow"><strong>${m.name}</strong> <span class="muted">· ${dueText(m.status)}</span></span>
            ${statusChip(m.status)}
            <button type="button" class="btn sm" data-bulk="${m.id}">Abrir WhatsApp</button>
          </div>`
        )}`,
      { onClose: load }
    );
    modal.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bulk]');
      if (!b) return;
      const m = byId(b.dataset.bulk);
      window.open(waLink(m.phone, reminderText(m)), '_blank', 'noopener');
      api(`/members/${m.id}/remind`, { method: 'POST' }).catch(() => {});
      b.textContent = 'Abierto';
      b.disabled = true;
    });
  });

  let searchTimer;
  root.querySelector('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = e.target.value.trim();
      loadMembers();
    }, 200);
  });

  function setFilter(key) {
    filter = key;
    renderFilters();
    loadMembers();
  }

  let loadSeq = 0;
  async function loadMembers() {
    const seq = ++loadSeq;
    const list = await api(`/members?status=${filter}&q=${encodeURIComponent(query)}`);
    if (seq !== loadSeq) return;
    members = list;
    renderTable();
  }

  async function load() {
    try {
      billing = await api('/billing');
      if (firstLoad && !params.get('filtro') && billing.action === 0) filter = 'all';
      firstLoad = false;
      renderTiles();
      renderFilters();
      await loadMembers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  await load();
  return () => clearTimeout(searchTimer);
}
