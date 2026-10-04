// Clientes de pase diario registrados: quién viene, cuánto gasta y a quién ofrecerle la mensualidad.
import { api } from '../api.js';
import { openWalkinCard, sendCarnet, enrollLink } from '../member.js';
import { html, setHTML, money, fmtDateTime, toast, activePlans } from '../ui.js';

export async function render(root) {
  let query = '';
  let list = [];

  setHTML(
    root,
    html`<div class="stack" style="gap: 18px;">
      <div>
        <h1 class="display h1">Clientes de pase diario</h1>
        <p class="subtitle">Tienen su propio QR: al escanearlo solo se cobra el día, sin volver a anotar sus datos.</p>
      </div>
      <div class="tiles" id="wk-tiles"></div>
      <section class="card stack">
        <div class="row">
          <label for="wk-search" class="sr-only">Buscar cliente</label>
          <input id="wk-search" class="input" type="search" placeholder="Buscar por nombre, cédula, teléfono o código" style="flex: 1; min-width: 200px; max-width: 420px; height: 44px;">
        </div>
        <div class="table-wrap" id="wk-table"></div>
      </section>
    </div>`
  );

  const tilesEl = root.querySelector('#wk-tiles');
  const tableEl = root.querySelector('#wk-table');
  const monthly = activePlans().find((p) => p.months === 1);
  const wouldSave = (w) => monthly && w.spent_this_month_cents >= monthly.price_cents;

  function renderTiles(all) {
    const active = all.filter((w) => w.visits_this_month > 0);
    const spent = all.reduce((s, w) => s + w.spent_this_month_cents, 0);
    const candidates = all.filter(wouldSave).length;
    setHTML(
      tilesEl,
      html`<section class="card tight">
          <div class="card-label">Registrados</div>
          <div class="display big">${all.length}</div>
          <div class="small muted">${active.length} vinieron este mes</div>
        </section>
        <section class="card tight">
          <div class="card-label">Pagado este mes por ellos</div>
          <div class="display big">${money(spent)}</div>
          <div class="small muted">En pases diarios</div>
        </section>
        <section class="card tight">
          <div class="card-label">Les conviene la mensualidad</div>
          <div class="display big">${candidates}</div>
          <div class="small muted">${monthly ? `Ya gastaron ${money(monthly.price_cents)} o más este mes` : 'Crea un plan mensual en Ajustes'}</div>
        </section>`
    );
  }

  function renderTable() {
    if (!list.length) {
      setHTML(
        tableEl,
        html`<div class="empty">${query
          ? 'Nadie coincide con la búsqueda.'
          : 'Aún no hay clientes registrados. Se registran solos al cobrar un pase diario con la casilla "Guardar sus datos" marcada.'}</div>`
      );
      return;
    }
    setHTML(
      tableEl,
      html`<table class="table">
        <thead><tr>
          <th>Cliente</th><th>Visitas este mes</th><th>Pagado este mes</th><th>Última visita</th><th>Acciones</th>
        </tr></thead>
        <tbody>
          ${list.map(
            (w) => html`<tr>
              <td>
                <button type="button" class="link-btn" data-open="${w.id}">${w.name}</button>
                <div class="small muted">${[w.code, w.cedula, w.phone].filter(Boolean).join(' · ')}</div>
              </td>
              <td class="tnum">${w.visits_this_month}</td>
              <td class="tnum">${money(w.spent_this_month_cents)}
                ${wouldSave(w) ? html`<div class="small" style="color: var(--orange);">Le conviene la mensualidad</div>` : ''}</td>
              <td class="small muted">${w.last_visit ? fmtDateTime(w.last_visit) : '—'}</td>
              <td><span class="actions">
                <button type="button" class="btn sm" data-send="${w.id}">Enviar QR</button>
                <a class="btn sm light" href="${enrollLink(w)}">Inscribir</a>
              </span></td>
            </tr>`
          )}
        </tbody>
      </table>`
    );
  }

  tableEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open], [data-send]');
    if (!t) return;
    if (t.dataset.open) openWalkinCard(Number(t.dataset.open), { onChange: load });
    if (t.dataset.send) sendCarnet(list.find((w) => w.id === Number(t.dataset.send)));
  });

  let searchTimer;
  root.querySelector('#wk-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = e.target.value.trim();
      load();
    }, 200);
  });

  let seq = 0;
  async function load() {
    const mine = ++seq;
    try {
      const [all, filtered] = await Promise.all([
        api('/walkins'),
        query ? api(`/walkins?q=${encodeURIComponent(query)}`) : null,
      ]);
      if (mine !== seq) return;
      renderTiles(all);
      list = filtered ?? all;
      renderTable();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  await load();
  return () => clearTimeout(searchTimer);
}
