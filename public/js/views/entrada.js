import { api } from '../api.js';
import { mountRenewPanel } from '../renew.js';
import { openMemberCard, openWalkinCard, sendCarnet, savingsHint, enrollLink } from '../member.js';
import {
  store, html, setHTML, money, fmtDay, fmtTime, icon, toast, openModal, optionGroup, methodButtons,
  kindChip, dueText, plural, activePlans,
} from '../ui.js';

const REFRESH_MS = 30_000;

export async function render(root) {
  const daypassPrice = store.config.settings.daypass_price_cents;

  setHTML(
    root,
    html`<div class="grid-2">
      <div class="col">
        <section class="card stack" aria-labelledby="checkin-title">
          <div>
            <h1 class="display h1" id="checkin-title">Registrar entrada</h1>
            <p class="subtitle">Escanea el QR del carnet del cliente o escribe su cédula</p>
          </div>
          <form class="checkin-row" id="checkin-form" autocomplete="off">
            <button type="button" class="qr-box" id="scan-btn">
              <span style="color: var(--accent);">${icon('qr', 54, 1.6)}</span>
              <span>Escanear con<br>la cámara</span>
            </button>
            <div class="checkin-fields">
              <label for="q" class="small muted" style="font-weight: 500;">Cédula, teléfono o código del carnet</label>
              <input id="q" class="input lg" type="text" placeholder="V-12.345.678 o M00001" autofocus>
              <button type="submit" class="btn primary lg" id="checkin-btn">Registrar entrada</button>
            </div>
          </form>
          <div id="result" aria-live="polite"></div>
        </section>
        <section class="card" id="action-card"></section>
      </div>
      <div class="col" id="today-col"><div class="loading">Cargando…</div></div>
    </div>`
  );

  const form = root.querySelector('#checkin-form');
  const input = root.querySelector('#q');
  const resultEl = root.querySelector('#result');
  const actionCard = root.querySelector('#action-card');
  const todayCol = root.querySelector('#today-col');
  const checkinBtn = root.querySelector('#checkin-btn');

  const focusInput = () => input.focus();

  // ---------- Resultado del escaneo ----------

  function showResult(tone, { label, name, text, chips = [], actions = [] }) {
    const iconName = { ok: 'check', soon: 'clock', grace: 'clock', bad: 'alert', info: 'user', daypass: 'qr' }[tone];
    setHTML(
      resultEl,
      html`<div class="result tone-${tone} ${tone === 'bad' ? 'boxed bad' : ''}">
        <div class="result-icon">${icon(iconName, 26, 2.4)}</div>
        <div class="result-body">
          <div class="result-head">
            <span class="result-label">${label}</span>
            ${name ? html`<span class="display result-name">${name}</span>` : ''}
          </div>
          ${text ? html`<div class="result-text">${text}</div>` : ''}
          ${chips.length ? html`<div class="chips">${chips}</div>` : ''}
          ${actions.length
            ? html`<div class="row">${actions.map(
                (a, i) => html`<button type="button" class="btn sm ${i === 0 ? 'light' : ''}" data-action="${i}">${a.label}</button>`
              )}</div>`
            : ''}
        </div>
      </div>`
    );
    resultEl.querySelectorAll('[data-action]').forEach((b) =>
      b.addEventListener('click', () => actions[Number(b.dataset.action)].run())
    );
  }

  function memberChips(m) {
    const chips = [
      html`<span class="chip plain">Código ${m.code}</span>`,
      html`<span class="chip k-member">${m.plan_name}</span>`,
      html`<span class="chip plain">Vence ${fmtDay(m.due_date)} · ${dueText(m.status)}</span>`,
    ];
    if (m.visits_this_month) chips.push(html`<span class="chip plain">${m.visits_this_month}ª visita este mes</span>`);
    return chips;
  }

  function showAllowed(m, duplicate) {
    const renewAction = { label: 'Renovar ahora', run: () => showRenew(m) };
    const base = { name: m.name, chips: memberChips(m) };
    if (duplicate) {
      showResult('info', { ...base, label: 'Ya había entrado hace un momento', actions: [carnetAction(m)] });
    } else if (m.status.key === 'soon') {
      showResult('soon', { ...base, label: 'Acceso permitido · vence pronto', actions: [renewAction, carnetAction(m)] });
    } else if (m.status.key === 'grace') {
      const left = store.config.settings.grace_days + m.status.days_left;
      showResult('grace', {
        ...base,
        label: 'Acceso permitido · en periodo de gracia',
        text: `Venció el ${fmtDay(m.due_date)}. ${left > 0 ? `Le ${left === 1 ? 'queda' : 'quedan'} ${plural(left, 'día', 'días')} de gracia para renovar.` : 'Hoy es su último día de gracia.'}`,
        actions: [renewAction, carnetAction(m)],
      });
    } else {
      showResult('ok', { ...base, label: 'Acceso permitido', actions: [carnetAction(m)] });
    }
  }

  function carnetAction(m) {
    return { label: 'Ver ficha y carnet QR', run: () => openMemberCard(m.id, { onChange: refreshToday }) };
  }

  function showDenied(m) {
    const s = store.config.settings;
    const ago = plural(-m.status.days_left, 'día', 'días');
    showResult('bad', {
      label: m.status.key === 'inactive' ? 'Membresía inactiva' : 'Membresía vencida',
      name: m.name,
      text:
        m.status.key === 'inactive'
          ? `${m.plan_name} · venció el ${fmtDay(m.due_date)} (hace ${ago}). Si renueva, el nuevo periodo empieza hoy.`
          : `${m.plan_name} · venció el ${fmtDay(m.due_date)} (hace ${ago}). Pasaron los ${s.grace_days} días de gracia: debe renovar para entrar.`,
      actions: [carnetAction(m)],
    });
  }

  function showNotFound(query) {
    showResult('info', {
      label: 'No encontrado',
      text: `No hay ningún cliente con "${query}". ¿Es la primera vez que viene?`,
      actions: [
        {
          label: 'Cobrar pase diario',
          run: () => {
            const d = query.replace(/\D/g, '');
            showDayPass(d.length >= 5 && d.length <= 9 ? { cedula: query } : {}).then(() =>
              actionCard.querySelector('#dp-name')?.focus()
            );
          },
        },
        {
          label: 'Inscribir como miembro',
          run: () => {
            location.hash = `#/nuevo?cedula=${encodeURIComponent(query)}`;
          },
        },
      ],
    });
  }

  // ---------- Clientes de pase diario con QR ----------

  function walkinChips(w) {
    return [
      html`<span class="chip plain">Código ${w.code}</span>`,
      kindChip('daypass'),
      html`<span class="chip plain">${plural(w.visits_this_month, 'visita', 'visitas')} este mes</span>`,
    ];
  }

  function walkinActions(w) {
    const actions = [{ label: 'Ver ficha y carnet QR', run: () => openWalkinCard(w.id, { onChange: refreshToday }) }];
    if (savingsHint(w)) actions.push({ label: 'Inscribir como miembro', run: () => (location.hash = enrollLink(w)) });
    return actions;
  }

  function showWalkin(w) {
    showResult('daypass', {
      label: w.paid_today_at ? `Ya pagó su pase de hoy (${fmtTime(w.paid_today_at)})` : 'Cliente de pase diario',
      name: w.name,
      text: savingsHint(w),
      chips: walkinChips(w),
      actions: walkinActions(w),
    });
    showWalkinCharge(w);
  }

  // Panel para cobrarle a un cliente ya registrado: solo se elige el método de pago.
  function showWalkinCharge(w) {
    if (w.paid_today_at) {
      setHTML(
        actionCard,
        html`<div class="stack">
          <h2 class="display h2">Volvió hoy <span class="muted">· ${w.name}</span></h2>
          <p class="small soft" style="margin: 0;">Ya pagó su pase del día a las ${fmtTime(w.paid_today_at)}. No hay que cobrarle otra vez.</p>
          <div class="row" style="justify-content: flex-end;">
            <button type="button" class="btn lg" data-cancel style="font-weight: 400;">Cancelar</button>
            <button type="button" class="btn primary lg" data-reentry>Registrar entrada sin cobrar</button>
          </div>
        </div>`
      );
      actionCard.querySelector('[data-cancel]').addEventListener('click', () => {
        showDayPass();
        focusInput();
      });
      actionCard.querySelector('[data-reentry]').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const updated = await api(`/walkins/${w.id}/reentry`, { method: 'POST' });
          toast(`Entrada registrada: ${w.name} (ya había pagado hoy)`);
          showResult('ok', { label: 'Entrada registrada sin cobrar', name: w.name, chips: walkinChips(updated) });
          showDayPass();
          refreshToday();
          focusInput();
        } catch (err) {
          toast(err.message, 'error');
          e.target.disabled = false;
        }
      });
      return;
    }

    setHTML(
      actionCard,
      html`<div class="stack">
        <h2 class="display h2">Pase diario <span class="muted">· ${w.name} · ${w.code}</span></h2>
        <div class="opts orange" role="group" aria-label="Método de pago" data-methods>${methodButtons()}</div>
        <p class="form-error" role="alert" data-error></p>
        <div class="pay-row">
          <div>
            <div class="small muted">Total</div>
            <div class="display total">${money(daypassPrice, { decimals: true })}</div>
          </div>
          <div class="row">
            <button type="button" class="btn lg" data-cancel style="font-weight: 400;">Otro cliente</button>
            <button type="button" class="btn orange lg" data-charge>Cobrar y registrar entrada</button>
          </div>
        </div>
      </div>`
    );
    const errorEl = actionCard.querySelector('[data-error]');
    const method = optionGroup(actionCard.querySelector('[data-methods]'), () => (errorEl.textContent = ''));
    actionCard.querySelector('[data-cancel]').addEventListener('click', () => {
      showDayPass();
      focusInput();
    });
    const chargeBtn = actionCard.querySelector('[data-charge]');
    chargeBtn.addEventListener('click', async () => {
      if (!method.value) {
        errorEl.textContent = 'Elige el método de pago';
        return;
      }
      chargeBtn.disabled = true;
      try {
        const r = await api('/daypass', { method: 'POST', body: { walkin_id: w.id, method: method.value } });
        toast(`Entrada registrada: ${w.name} · ${money(r.amount_cents)} (${method.value})`);
        showResult('ok', {
          label: 'Pase diario cobrado',
          name: w.name,
          text: savingsHint(r.walkin),
          chips: walkinChips(r.walkin),
          actions: walkinActions(r.walkin),
        });
        showDayPass();
        refreshToday();
        focusInput();
      } catch (err) {
        errorEl.textContent = err.message;
        chargeBtn.disabled = false;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return focusInput();
    checkinBtn.disabled = true;
    try {
      const r = await api('/checkin', { method: 'POST', body: { query } });
      input.value = '';
      if (r.result === 'allowed') {
        showAllowed(r.member, r.duplicate);
        showDayPass();
        refreshToday();
      } else if (r.result === 'denied') {
        showDenied(r.member);
        showRenew(r.member);
      } else if (r.result === 'walkin') {
        showWalkin(r.walkin);
      } else {
        showNotFound(query);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      checkinBtn.disabled = false;
      focusInput();
    }
  });

  // ---------- Panel inferior: pase diario o renovación ----------

  function showRenew(member) {
    mountRenewPanel(actionCard, member, {
      onDone: ({ member: m }) => {
        toast(`Renovado: ${m.name} hasta el ${fmtDay(m.due_date)}. Entrada registrada.`);
        showAllowed(m, false);
        showDayPass();
        refreshToday();
        focusInput();
      },
      onDayPass: () => showDayPass({ name: member.name, phone: member.phone, member_id: member.id }),
      onCancel: () => {
        showDayPass();
        focusInput();
      },
    });
  }

  // Pase diario para alguien sin QR: primera vez (se guardan sus datos) o un miembro vencido.
  async function showDayPass(prefill = {}) {
    const forMember = Boolean(prefill.member_id);
    setHTML(
      actionCard,
      html`<form class="stack" id="dp-form" autocomplete="off">
        <h2 class="display h2">Pase diario <span class="muted">· ${forMember ? 'miembro con membresía vencida' : 'cliente nuevo o sin QR'}</span></h2>
        <div class="two">
          <div class="field">
            <label for="dp-name">Nombre</label>
            <input id="dp-name" class="input" type="text" required value="${prefill.name ?? ''}">
          </div>
          ${forMember
            ? ''
            : html`<div class="field">
                <label for="dp-ced">Cédula (opcional)</label>
                <input id="dp-ced" class="input" type="text" placeholder="V-12.345.678" value="${prefill.cedula ?? ''}">
              </div>`}
          <div class="field">
            <label for="dp-phone">Teléfono (opcional)</label>
            <input id="dp-phone" class="input" type="tel" placeholder="0414-000-0000" value="${prefill.phone ?? ''}">
          </div>
        </div>
        ${forMember
          ? ''
          : html`<label class="check"><input type="checkbox" id="dp-save" checked> Guardar sus datos y darle un QR para la próxima vez</label>`}
        <div class="hint" id="dp-hint"></div>
        <div class="opts orange" role="group" aria-label="Método de pago" id="dp-methods">${methodButtons()}</div>
        <p class="form-error" role="alert" id="dp-error"></p>
        <div class="pay-row">
          <div>
            <div class="small muted">Total</div>
            <div class="display total">${money(daypassPrice, { decimals: true })}</div>
          </div>
          <div class="row">
            ${forMember ? html`<button type="button" class="btn lg" id="dp-cancel" style="font-weight: 400;">Cancelar</button>` : ''}
            <button type="submit" class="btn orange lg" id="dp-submit">Cobrar y registrar entrada</button>
          </div>
        </div>
      </form>`
    );

    const dpForm = actionCard.querySelector('#dp-form');
    const nameEl = actionCard.querySelector('#dp-name');
    const cedEl = actionCard.querySelector('#dp-ced');
    const phoneEl = actionCard.querySelector('#dp-phone');
    const saveEl = actionCard.querySelector('#dp-save');
    const hintEl = actionCard.querySelector('#dp-hint');
    const errorEl = actionCard.querySelector('#dp-error');
    const submitBtn = actionCard.querySelector('#dp-submit');
    const method = optionGroup(actionCard.querySelector('#dp-methods'), () => (errorEl.textContent = ''));
    actionCard.querySelector('#dp-cancel')?.addEventListener('click', () => showDayPass());

    // Al escribir cédula o teléfono, avisa si la persona ya está registrada.
    async function checkExisting(value) {
      if (forMember || !value.trim()) return;
      try {
        const r = await api(`/lookup?q=${encodeURIComponent(value)}`);
        if (r.type === 'walkin') {
          setHTML(
            hintEl,
            html`${icon('user', 18, 1.8)}<span>Ya está registrado: <strong>${r.walkin.name}</strong> (${r.walkin.code}).
              <button type="button" class="btn sm light" data-use style="margin-left: 6px;">Usar sus datos</button></span>`
          );
          hintEl.querySelector('[data-use]').addEventListener('click', () => showWalkin(r.walkin));
        } else if (r.type === 'member') {
          setHTML(
            hintEl,
            html`${icon('user', 18, 1.8)}<span>Es miembro con membresía: <strong>${r.member.name}</strong> (${r.member.code}).
              <button type="button" class="btn sm light" data-member style="margin-left: 6px;">Registrar como miembro</button></span>`
          );
          hintEl.querySelector('[data-member]').addEventListener('click', () => {
            input.value = r.member.code;
            form.requestSubmit();
          });
        } else if (phoneEl.value) {
          const h = await api(`/daypass/history?phone=${encodeURIComponent(phoneEl.value)}`);
          setHTML(hintEl, frequencyHint(h, nameEl.value, phoneEl.value));
        } else {
          setHTML(hintEl, '');
        }
      } catch {
        setHTML(hintEl, '');
      }
    }
    cedEl?.addEventListener('change', () => checkExisting(cedEl.value));
    phoneEl.addEventListener('change', () => checkExisting(phoneEl.value));
    if (cedEl?.value) checkExisting(cedEl.value);

    dpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!method.value) {
        errorEl.textContent = 'Elige el método de pago';
        return;
      }
      submitBtn.disabled = true;
      try {
        const name = nameEl.value.trim();
        const r = await api('/daypass', {
          method: 'POST',
          body: {
            name,
            cedula: cedEl?.value ?? '',
            phone: phoneEl.value,
            method: method.value,
            member_id: prefill.member_id,
            save: saveEl?.checked ?? false,
          },
        });
        toast(`Entrada registrada: ${name} · ${money(r.amount_cents)} (${method.value})`);
        if (r.walkin) {
          showResult('ok', {
            label: 'Pase diario cobrado · cliente registrado',
            name,
            text: 'Envíale su QR: la próxima vez solo lo escaneas y cobras.',
            chips: walkinChips(r.walkin),
            actions: [
              { label: 'Enviar su QR por WhatsApp', run: () => sendCarnet(r.walkin) },
              { label: 'Ver ficha y carnet QR', run: () => openWalkinCard(r.walkin.id, { onChange: refreshToday }) },
            ],
          });
        } else {
          showResult('ok', {
            label: 'Pase diario cobrado',
            name,
            chips: [kindChip('daypass'), html`<span class="chip plain">${money(r.amount_cents)} · ${method.value}</span>`],
          });
        }
        await showDayPass();
        if (!r.walkin && !forMember && r.history.visits >= 3) {
          setHTML(actionCard.querySelector('#dp-hint'), frequencyHint(r.history, name, phoneEl.value));
        }
        refreshToday();
        focusInput();
      } catch (err) {
        errorEl.textContent = err.message;
        submitBtn.disabled = false;
      }
    });
  }

  function frequencyHint(h, name, phone) {
    if (h.visits < 3) return '';
    const monthly = activePlans().find((p) => p.months === 1);
    const params = new URLSearchParams({ name, phone });
    return html`${icon('trend', 18, 1.8)}
      <span>Vino ${plural(h.visits, 'vez', 'veces')} este mes con pase diario (${money(h.total_cents)}).
      ${monthly ? `La mensualidad cuesta ${money(monthly.price_cents)}: ofrécele membresía. ` : ''}
      <a href="#/nuevo?${params.toString()}">Inscribir</a></span>`;
  }

  // ---------- Columna derecha: el día de hoy ----------

  async function refreshToday() {
    let t;
    try {
      t = await api('/today');
    } catch {
      return;
    }
    const pct = Math.min(100, Math.round((t.inside_now / t.capacity) * 100));
    const s = store.config.settings;
    setHTML(
      todayCol,
      html`<section class="card tight">
          <div class="card-label">En el gym ahora</div>
          <div class="row" style="align-items: baseline; gap: 8px;">
            <span class="display huge">${t.inside_now}</span>
            <span class="muted">de ${t.capacity} de capacidad</span>
          </div>
          <div class="bar-track" style="margin-top: 10px;"><div class="bar-fill" style="width: ${pct}%;"></div></div>
          <div class="small muted" style="margin-top: 8px;">Estimado con las entradas de los últimos ${s.stay_minutes} minutos</div>
        </section>
        <div class="two">
          <section class="card tight">
            <div class="card-label">Entradas hoy</div>
            <div class="display big">${t.entries.total}</div>
            <div class="small"><span style="color: var(--blue);">${t.entries.member} membresía</span> · <span style="color: var(--orange);">${t.entries.daypass} diario</span></div>
          </section>
          <section class="card tight">
            <div class="card-label">Cobrado hoy</div>
            <div class="display big">${money(t.daypass.total_cents + t.membership.total_cents)}</div>
            <div class="small soft">Pases ${money(t.daypass.total_cents)} · Mensualidades ${money(t.membership.total_cents)}</div>
          </section>
        </div>
        <section class="card tight stack" style="gap: 10px;">
          <div class="card-label">Lo que viene (según el histórico)</div>
          ${!t.has_history
            ? html`<div class="small muted">Todavía no hay historial. En unos días aquí verás las horas fuertes.</div>`
            : t.forecast.length === 0
              ? html`<div class="small muted">No hay más horas hoy.</div>`
              : t.forecast.map(
                  (f) => html`<div class="forecast-row">
                    <span class="forecast-hour tnum">${String(f.hour).padStart(2, '0')}:00</span>
                    <div class="bar-track"><div class="bar-fill" style="width: ${Math.max(4, Math.round(f.ratio * 100))}%; background: ${f.level === 'Pico' ? 'var(--text)' : f.level === 'Alta' ? '#8A909C' : '#5A606B'};"></div></div>
                    <span class="forecast-label">${f.level} · ~${f.avg}</span>
                  </div>`
                )}
        </section>
        <section class="card tight">
          <div class="card-label" style="margin-bottom: 6px;">Últimas entradas</div>
          ${t.recent.length
            ? t.recent.map(
                (c) => html`<div class="list-row">
                  <span class="muted tnum">${fmtTime(c.created_at)}</span>
                  <span class="grow">${c.name}</span>
                  ${kindChip(c.kind)}
                </div>`
              )
            : html`<div class="small muted">Aún no ha entrado nadie hoy.</div>`}
        </section>`
    );
  }

  // ---------- Cámara ----------

  root.querySelector('#scan-btn').addEventListener('click', () => {
    const Lib = window.__Html5QrcodeLibrary__;
    if (!window.isSecureContext || !navigator.mediaDevices || !Lib) {
      if (!window.isSecureContext) {
        // Al recargar, el servidor lleva a la dirección https, donde sí se permite la cámara.
        toast('La cámara necesita la dirección segura (https). Recargando…');
        setTimeout(() => location.reload(), 1200);
      } else {
        toast('Este navegador no permite usar la cámara. Escribe la cédula o usa un lector de códigos.', 'error');
      }
      return;
    }
    let scanner;
    const modal = openModal('Escanear código', html`<div id="qr-reader"></div><p class="small muted">Acerca el código QR del carnet o del teléfono a la cámara.</p>`, {
      onClose: () => {
        scanner?.isScanning && scanner.stop().catch(() => {});
        focusInput();
      },
    });
    scanner = new Lib.Html5Qrcode('qr-reader');
    scanner
      .start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (text) => {
        scanner.stop().catch(() => {}).finally(() => {
          modal.close();
          input.value = text;
          form.requestSubmit();
        });
      })
      .catch(() => {
        modal.close();
        toast('No se pudo abrir la cámara. Revisa los permisos del navegador.', 'error');
      });
  });

  await showDayPass();
  await refreshToday();
  focusInput();
  const timer = setInterval(refreshToday, REFRESH_MS);
  return () => clearInterval(timer);
}
