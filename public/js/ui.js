// Utilidades compartidas por las vistas.

export const store = { config: null };

// ---------- HTML seguro ----------
// html`...` escapa todo valor interpolado salvo otro html`...` o raw().

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Raw(s);

export function esc(v) {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function renderValue(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += renderValue(v) + strings[i + 1];
  });
  return new Raw(out);
}

export function setHTML(el, content) {
  el.innerHTML = renderValue(content);
}

// ---------- Formato ----------

export function money(cents, { decimals = false } = {}) {
  const cur = store.config?.settings.currency ?? '$';
  const value = (cents ?? 0) / 100;
  const opts = decimals || cents % 100
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 };
  return cur + value.toLocaleString('en-US', opts);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const pad = (n) => String(n).padStart(2, '0');

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addMonths(s, n) {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// '2026-10-28' -> '28 oct' (con año si no es el actual)
export function fmtDay(s) {
  if (!s) return '';
  const d = parseDate(s);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function fmtTime(dt) {
  return dt ? dt.slice(11, 16) : '';
}

export function fmtDateTime(dt) {
  if (!dt) return '';
  return `${fmtDay(dt)} · ${fmtTime(dt)}`;
}

export function fmtMonth(ym) {
  const m = Number(ym.slice(5, 7)) - 1;
  return MONTHS[m].charAt(0).toUpperCase() + MONTHS[m].slice(1);
}

export function fmtMonthLong(ym) {
  return MONTHS_LONG[Number(ym.slice(5, 7)) - 1];
}

export function fmtLongToday() {
  const d = new Date();
  const day = DAYS_LONG[d.getDay()];
  return `${day.charAt(0).toUpperCase() + day.slice(1)} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function dueText(status) {
  const n = status.days_left;
  if (n > 1) return `faltan ${n} días`;
  if (n === 1) return 'vence mañana';
  if (n === 0) return 'vence hoy';
  return `venció hace ${plural(-n, 'día', 'días')}`;
}

export function firstName(name) {
  return String(name).trim().split(/\s+/)[0];
}

// ---------- WhatsApp ----------

export function waLink(phone, text) {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.length < 7) return null;
  const cc = store.config?.settings.country_code ?? '58';
  if (d.startsWith('0')) d = cc + d.slice(1);
  else if (!d.startsWith(cc) || d.length <= 10) d = cc + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export function reminderText(member) {
  const gym = store.config?.settings.gym_name ?? 'el gimnasio';
  const who = firstName(member.name);
  const plan = member.plan_name.toLowerCase();
  if (member.status.days_left >= 0) {
    const when = member.status.days_left === 0 ? 'hoy' : `el ${fmtDay(member.due_date)}`;
    return `Hola ${who}, te recordamos que tu membresía ${plan} en ${gym} vence ${when}. Puedes renovarla en recepción. ¡Te esperamos!`;
  }
  return `Hola ${who}, tu membresía ${plan} en ${gym} venció el ${fmtDay(member.due_date)}. Pasa por recepción para renovarla y seguir entrenando. ¡Te esperamos!`;
}

// ---------- Componentes ----------

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 4000);
}

export function openModal(title, content, { onClose } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  setHTML(
    dialog,
    html`<div class="modal-head">
        <h2 class="display h2">${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button>
      </div>
      <div class="modal-body">${content}</div>`
  );
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('close', () => {
    onClose?.();
    dialog.remove();
  });
  dialog.showModal();
  return { el: dialog.querySelector('.modal-body'), close };
}

// Grupo de botones donde solo uno queda presionado.
export function optionGroup(container, onChange) {
  let value = container.querySelector('[aria-pressed="true"]')?.dataset.value ?? null;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn || !container.contains(btn)) return;
    for (const b of container.querySelectorAll('button[data-value]')) b.setAttribute('aria-pressed', String(b === btn));
    value = btn.dataset.value;
    onChange?.(value);
  });
  return {
    get value() {
      return value;
    },
  };
}

export function methodButtons(selected = null) {
  return store.config.methods.map(
    (m) => html`<button type="button" class="opt" data-value="${m}" aria-pressed="${String(m === selected)}">${m}</button>`
  );
}

export function activePlans() {
  return store.config.plans.filter((p) => p.active);
}

export function planNote(plan) {
  const monthly = activePlans().find((p) => p.months === 1);
  if (monthly && plan.months > 1) {
    const saving = monthly.price_cents * plan.months - plan.price_cents;
    if (saving > 0) return `Ahorra ${money(saving)}`;
  }
  return plural(plan.months, 'mes', 'meses');
}

export function statusChip(status) {
  return html`<span class="chip st-${status.key}">${status.label}</span>`;
}

export function kindChip(kind) {
  return kind === 'daypass'
    ? html`<span class="chip k-daypass">Pase diario</span>`
    : html`<span class="chip k-member">Membresía</span>`;
}

const ICONS = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 7v6M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  trend: '<path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  qr: '<path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3"/><rect x="7" y="7" width="4" height="4"/><rect x="13" y="7" width="4" height="4"/><rect x="7" y="13" width="4" height="4"/><path d="M13 13h4v4"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
};

export function icon(name, size = 22, width = 2) {
  return raw(
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
  );
}
