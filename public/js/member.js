// Fichas y carnets con QR: miembros (M00001) y clientes de pase diario (D00001).
import { api } from './api.js';
import {
  store, html, money, fmtDay, fmtDateTime, toast, openModal, statusChip, dueText, waLink, firstName, icon, activePlans,
  plural,
} from './ui.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const isWalkin = (x) => x.kind === 'walkin';
const qrUrl = (x, ext) => `/api/${isWalkin(x) ? 'walkins' : 'members'}/${x.id}/qr.${ext}`;
const badge = (x) => (isWalkin(x) ? 'Pase diario' : x.plan_name);
const metaLine = (x) =>
  isWalkin(x)
    ? `Código ${x.code} · paga por día`
    : `${x.code ? `Código ${x.code} · ` : ''}vence ${fmtDay(x.due_date)}`;

export function carnet(x) {
  return html`<div class="carnet">
    <div class="carnet-head">
      <span class="display" style="font-size: 20px;">${store.config.settings.gym_name}</span>
      <span class="carnet-plan">${badge(x)}</span>
    </div>
    <div class="carnet-qr">
      ${x.id
        ? html`<img src="${qrUrl(x, 'svg')}" alt="Código QR de ${x.name}">`
        : html`<span>El QR se genera al inscribir</span>`}
    </div>
    <div>
      <div class="display carnet-name">${x.name || 'Nombre del miembro'}</div>
      <div class="carnet-meta">${metaLine(x)}</div>
    </div>
  </div>`;
}

export function welcomeText(x) {
  const gym = store.config.settings.gym_name;
  if (isWalkin(x)) {
    return `¡Hola ${firstName(x.name)}! Este es tu código QR de ${gym}. Muéstralo en recepción cada vez que vengas y solo pagas tu pase del día, sin dar tus datos otra vez. Tu código es ${x.code}.`;
  }
  return `¡Hola ${firstName(x.name)}! Te damos la bienvenida a ${gym}. Este es tu carnet: muestra el código QR en recepción cada vez que vengas (o di tu cédula). Tu código es ${x.code} y tu membresía ${x.plan_name.toLowerCase()} vence el ${fmtDay(x.due_date)}.`;
}

export function printCarnet() {
  document.body.classList.add('printing');
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'), { once: true });
  window.print();
}

// ---------- Carnet como imagen para enviar por WhatsApp ----------

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

function fitText(ctx, text, maxWidth, size, weight, family) {
  let s = size;
  do ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && --s > 18);
}

export async function carnetImage(x) {
  const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const BODY = '"IBM Plex Sans", system-ui, sans-serif';
  await Promise.all([
    document.fonts.load(`700 40px "Barlow Condensed"`),
    document.fonts.load(`400 24px "IBM Plex Sans"`),
    document.fonts.load(`600 24px "IBM Plex Sans"`),
  ]).catch(() => {});
  const qr = await loadImage(qrUrl(x, 'png'));

  const W = 640;
  const H = 860;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#F2F2EE';
  ctx.fillRect(0, 0, W, H);

  // Encabezado: gimnasio y tipo de cliente
  ctx.fillStyle = '#121418';
  ctx.textBaseline = 'middle';
  fitText(ctx, store.config.settings.gym_name, 360, 40, 700, DISPLAY);
  ctx.fillText(store.config.settings.gym_name, 48, 70);
  ctx.font = `600 22px ${BODY}`;
  const label = badge(x);
  const pw = ctx.measureText(label).width + 36;
  ctx.beginPath();
  ctx.roundRect(W - 48 - pw, 50, pw, 40, 20);
  ctx.fill();
  ctx.fillStyle = '#C8F04A';
  ctx.fillText(label, W - 48 - pw + 18, 71);

  // QR
  const q = 440;
  const qx = (W - q) / 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(qx - 10, 120, q + 20, q + 20);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, qx, 130, q, q);

  // Nombre y código
  ctx.textAlign = 'center';
  ctx.fillStyle = '#121418';
  fitText(ctx, x.name, W - 96, 56, 700, DISPLAY);
  ctx.fillText(x.name, W / 2, 640);
  ctx.font = `400 26px ${BODY}`;
  ctx.fillStyle = '#3B3F48';
  ctx.fillText(metaLine(x), W / 2, 692);
  ctx.font = `400 22px ${BODY}`;
  ctx.fillStyle = '#5B606B';
  ctx.fillText('Muestra este código en recepción al llegar', W / 2, 760);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// En celular/tablet usa el menú "Compartir" (manda la imagen directo a WhatsApp).
// En la computadora abre el chat con el texto y deja la imagen copiada para pegarla.
export async function sendCarnet(x) {
  const text = welcomeText(x);
  const filename = `carnet-${x.code}.png`;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const probe = new File([''], filename, { type: 'image/png' });
  const canShareFiles = touch && navigator.canShare?.({ files: [probe] });

  // La ventana se abre antes de preparar la imagen para que el navegador no la bloquee.
  const chat = canShareFiles ? null : window.open('about:blank', '_blank');

  let blob;
  try {
    blob = await carnetImage(x);
  } catch {
    chat?.close();
    toast('No se pudo generar la imagen del carnet', 'error');
    return;
  }

  if (canShareFiles) {
    try {
      await navigator.share({ files: [new File([blob], filename, { type: 'image/png' })], text });
    } catch (err) {
      if (err.name !== 'AbortError') toast('No se pudo abrir el menú para compartir', 'error');
    }
    return;
  }

  let copied = false;
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copied = true;
    }
  } catch {
    /* sin permiso para copiar imágenes: queda la descarga */
  }
  download(blob, filename);

  const link = waLink(x.phone, text) ?? `https://wa.me/?text=${encodeURIComponent(text)}`;
  if (chat) {
    chat.opener = null;
    chat.location.href = link;
  } else {
    window.open(link, '_blank', 'noopener');
  }
  toast(
    copied
      ? 'Se abrió WhatsApp. El carnet con el QR está copiado: pégalo en el chat con Ctrl+V y envía.'
      : 'Se abrió WhatsApp y se descargó el carnet con el QR: adjúntalo en el chat y envía.'
  );
}

// ---------- Fichas ----------

function since(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1)} ${y}`;
}

const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function header(x, chip) {
  return html`<div class="row" style="gap: 14px;">
    <div class="display" style="width: 56px; height: 56px; border-radius: 50%; background: var(--line); display: flex; align-items: center; justify-content: center; font-size: 24px;">${initials(x.name)}</div>
    <div style="flex: 1; min-width: 0;">
      <div class="display" style="font-size: 26px; line-height: 1;">${x.name}</div>
      <div class="small muted" style="margin-top: 4px;">${x.cedula || 'sin cédula'} · ${x.phone || 'sin teléfono'} · ${x.code}</div>
    </div>
    ${chip}
  </div>`;
}

function tiles(items) {
  return html`<div class="tiles" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
    ${items.map(
      ([label, value]) => html`<div style="background: var(--field); border-radius: 10px; padding: 10px 12px;">
        <div class="small muted">${label}</div>
        <div style="font-weight: 600; margin-top: 2px;">${value}</div>
      </div>`
    )}
  </div>`;
}

function paymentsList(payments, describe) {
  return html`<div>
    <div class="card-label" style="margin-bottom: 6px;">Historial de pagos</div>
    ${payments.length
      ? payments.map(
          (p) => html`<div class="list-row">
            <span class="muted tnum" style="width: 120px;">${fmtDateTime(p.created_at)}</span>
            <span class="grow">${describe(p)}</span>
            <span class="small muted">${p.method}</span>
            <strong>${money(p.amount_cents)}</strong>
          </div>`
        )
      : html`<div class="small muted">Sin pagos registrados.</div>`}
  </div>`;
}

function carnetBlock(x, { cedulaRequired, extra = '' }) {
  return html`<div class="row" style="align-items: flex-start; gap: 20px;">
    ${carnet(x)}
    <div class="stack" style="flex: 1; min-width: 220px;">
      <button type="button" class="btn" data-send>${icon('chat', 18, 1.8)} Enviar carnet con QR por WhatsApp</button>
      <button type="button" class="btn" data-print>${icon('print', 18, 1.8)} Imprimir carnet</button>
      ${extra}
      <form class="stack" data-edit style="gap: 10px; margin-top: 8px;">
        <div class="card-label">Corregir datos</div>
        <div class="field"><label for="ed-name">Nombre</label><input id="ed-name" class="input" name="name" value="${x.name}" required></div>
        <div class="field"><label for="ed-ced">Cédula${cedulaRequired ? '' : ' (opcional)'}</label><input id="ed-ced" class="input" name="cedula" value="${x.cedula}" ${cedulaRequired ? 'required' : ''}></div>
        <div class="field"><label for="ed-phone">WhatsApp</label><input id="ed-phone" class="input" name="phone" type="tel" value="${x.phone}"></div>
        <p class="form-error" role="alert" data-error></p>
        <button type="submit" class="btn">Guardar cambios</button>
      </form>
    </div>
  </div>`;
}

function wireCard(modal, x, endpoint, onChange) {
  modal.el.querySelector('[data-print]').addEventListener('click', printCarnet);
  modal.el.querySelector('[data-send]').addEventListener('click', () => sendCarnet(x));
  const form = modal.el.querySelector('[data-edit]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(endpoint, { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
      toast('Datos actualizados');
      modal.close();
      onChange?.();
    } catch (err) {
      form.querySelector('[data-error]').textContent = err.message;
    }
  });
}

async function fetchOrToast(path) {
  try {
    return await api(path);
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}

export async function openMemberCard(id, { onChange } = {}) {
  const m = await fetchOrToast(`/members/${id}`);
  if (!m) return;
  const modal = openModal(
    'Ficha del miembro',
    html`<div class="stack">
      ${header(m, statusChip(m.status))}
      <div class="small soft">${m.plan_name} · vence ${fmtDay(m.due_date)} (${dueText(m.status)})</div>
      ${tiles([
        ['Miembro desde', since(m.start_date)],
        ['Visitas este mes', m.visits_this_month],
        ['Visitas mes pasado', m.visits_last_month],
        ['Pagos a tiempo', `${m.payments_on_time} de ${m.payments_total}`],
      ])}
      ${paymentsList(m.payments, (p) =>
        p.kind === 'membership' ? `${p.plan_name} · ${fmtDay(p.period_start)} → ${fmtDay(p.period_end)}` : 'Pase diario'
      )}
      ${carnetBlock(m, { cedulaRequired: true })}
    </div>`
  );
  wireCard(modal, m, `/members/${m.id}`, onChange);
}

// Enlace a "Nuevo miembro" con sus datos ya escritos.
export function enrollLink(w) {
  const params = new URLSearchParams({ name: w.name, phone: w.phone, cedula: w.cedula, walkin: w.id });
  return `#/nuevo?${params.toString()}`;
}

export function savingsHint(w) {
  const monthly = activePlans().find((p) => p.months === 1);
  if (!monthly || w.visits_this_month < 3) return '';
  const spent = money(w.spent_this_month_cents);
  return w.spent_this_month_cents >= monthly.price_cents
    ? `Este mes ya gastó ${spent} en pases: con la mensualidad (${money(monthly.price_cents)}) le sale más barato.`
    : `Vino ${plural(w.visits_this_month, 'vez', 'veces')} este mes (${spent}). La mensualidad cuesta ${money(monthly.price_cents)}.`;
}

export async function openWalkinCard(id, { onChange } = {}) {
  const w = await fetchOrToast(`/walkins/${id}`);
  if (!w) return;
  const hint = savingsHint(w);
  const modal = openModal(
    'Cliente de pase diario',
    html`<div class="stack">
      ${header(w, html`<span class="chip k-daypass">Pase diario</span>`)}
      ${tiles([
        ['Cliente desde', since(w.created_at)],
        ['Visitas este mes', w.visits_this_month],
        ['Visitas mes pasado', w.visits_last_month],
        ['Pagado este mes', money(w.spent_this_month_cents)],
      ])}
      ${hint ? html`<div class="hint">${icon('trend', 18, 1.8)}<span>${hint}</span></div>` : ''}
      ${paymentsList(w.payments, () => 'Pase diario')}
      ${carnetBlock(w, {
        cedulaRequired: false,
        extra: html`<a class="btn primary" href="${enrollLink(w)}" data-enroll>Inscribir como miembro</a>`,
      })}
    </div>`
  );
  modal.el.querySelector('[data-enroll]').addEventListener('click', () => modal.close());
  wireCard(modal, w, `/walkins/${w.id}`, onChange);
}
