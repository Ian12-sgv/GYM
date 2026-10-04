import { api } from '../api.js';
import { carnet, printCarnet, sendCarnet } from '../member.js';
import {
  html, setHTML, money, fmtDay, icon, toast, optionGroup, methodButtons, activePlans, addMonths, todayStr, plural,
} from '../ui.js';

export async function render(root, params) {
  const plans = activePlans();
  const startPlan = plans.find((p) => p.months === 1)?.id ?? plans[0]?.id;

  setHTML(
    root,
    html`<div class="grid-2">
      <section class="card">
        <form class="stack" id="new-form" autocomplete="off" style="gap: 16px;">
          <div>
            <h1 class="display h1">Inscribir nuevo miembro</h1>
            <p class="subtitle">Al cobrar se genera su código QR para entrar</p>
          </div>
          <div class="two">
            <div class="field"><label for="nm-name">Nombre y apellido</label>
              <input id="nm-name" name="name" class="input" required value="${params.get('name') ?? ''}"></div>
            <div class="field"><label for="nm-ced">Cédula</label>
              <input id="nm-ced" name="cedula" class="input" required placeholder="V-12.345.678" value="${params.get('cedula') ?? ''}"></div>
            <div class="field"><label for="nm-phone">WhatsApp</label>
              <input id="nm-phone" name="phone" class="input" type="tel" placeholder="0414-000-0000" value="${params.get('phone') ?? ''}"></div>
            <div class="field"><label for="nm-start">Fecha de inicio</label>
              <input id="nm-start" name="start_date" class="input" type="date" required value="${todayStr()}"></div>
          </div>
          <div class="hint" id="nm-hint"></div>
          <div class="opts plans" role="group" aria-label="Plan" id="nm-plans">
            ${plans.map(
              (p) => html`<button type="button" class="opt" data-value="${p.id}" aria-pressed="${String(p.id === startPlan)}">
                <span class="plan-name">${p.name}</span>
                <span class="plan-price">${money(p.price_cents)}</span>
                <span class="plan-note" data-due="${p.id}"></span>
              </button>`
            )}
          </div>
          <div class="opts" role="group" aria-label="Método de pago" id="nm-methods">${methodButtons()}</div>
          <label class="check"><input type="checkbox" id="nm-checkin" checked> Registrar su entrada de hoy</label>
          <p class="form-error" role="alert" id="nm-error"></p>
          <div class="pay-row">
            <div>
              <div class="small muted">Total</div>
              <div class="display total" id="nm-total"></div>
            </div>
            <button type="submit" class="btn primary lg" id="nm-submit">Cobrar e inscribir</button>
          </div>
        </form>
      </section>
      <section class="card stack" style="align-items: center;">
        <div class="card-label" style="align-self: stretch;">Carnet digital del miembro</div>
        <div id="nm-carnet"></div>
        <div class="stack" id="nm-after" style="align-self: stretch;"></div>
      </section>
    </div>`
  );

  const form = root.querySelector('#new-form');
  const nameEl = root.querySelector('#nm-name');
  const phoneEl = root.querySelector('#nm-phone');
  const startEl = root.querySelector('#nm-start');
  const errorEl = root.querySelector('#nm-error');
  const submitBtn = root.querySelector('#nm-submit');
  const carnetEl = root.querySelector('#nm-carnet');
  const afterEl = root.querySelector('#nm-after');
  let created = null;

  const plan = optionGroup(root.querySelector('#nm-plans'), updatePreview);
  const method = optionGroup(root.querySelector('#nm-methods'), () => (errorEl.textContent = ''));
  const currentPlan = () => plans.find((p) => p.id === Number(plan.value));

  function updatePreview() {
    if (created) return;
    const start = startEl.value || todayStr();
    for (const p of plans) {
      root.querySelector(`[data-due="${p.id}"]`).textContent = `Vence ${fmtDay(addMonths(start, p.months))}`;
    }
    const p = currentPlan();
    root.querySelector('#nm-total').textContent = p ? money(p.price_cents, { decimals: true }) : '—';
    setHTML(
      carnetEl,
      carnet({ name: nameEl.value.trim(), plan_name: p?.name ?? '', due_date: p ? addMonths(start, p.months) : start })
    );
  }

  async function updateHint() {
    try {
      const h = await api(`/daypass/history?phone=${encodeURIComponent(phoneEl.value)}`);
      const p = currentPlan();
      setHTML(
        root.querySelector('#nm-hint'),
        h.visits > 0
          ? html`${icon('trend', 18, 1.8)}<span>Este cliente vino ${plural(h.visits, 'vez', 'veces')} con pase diario este mes (${money(h.total_cents)}).
            ${p && h.total_cents >= p.price_cents * 0.6 ? `Con la ${p.name.toLowerCase()} paga ${money(p.price_cents)} y entra todos los días.` : ''}</span>`
          : ''
      );
    } catch {
      /* el aviso es opcional */
    }
  }

  nameEl.addEventListener('input', updatePreview);
  startEl.addEventListener('change', updatePreview);
  phoneEl.addEventListener('change', updateHint);
  if (phoneEl.value) updateHint();
  updatePreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!plan.value) return (errorEl.textContent = 'Elige un plan');
    if (!method.value) return (errorEl.textContent = 'Elige el método de pago');
    submitBtn.disabled = true;
    try {
      const m = await api('/members', {
        method: 'POST',
        body: {
          ...Object.fromEntries(new FormData(form)),
          plan_id: Number(plan.value),
          method: method.value,
          checkin: root.querySelector('#nm-checkin').checked,
          walkin_id: Number(params.get('walkin')) || undefined,
        },
      });
      created = m;
      toast(`${m.name} inscrito con el código ${m.code}`);
      form.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
      setHTML(carnetEl, carnet(m));
      setHTML(
        afterEl,
        html`<div class="two">
            <button type="button" class="btn" id="nm-send">${icon('chat', 18, 1.8)} Enviar por WhatsApp</button>
            <button type="button" class="btn" id="nm-print">${icon('print', 18, 1.8)} Imprimir carnet</button>
          </div>
          <a class="btn primary" href="#/nuevo" id="nm-another">Inscribir a otra persona</a>
          <div class="small muted">Puede mostrar el QR desde su teléfono o el carnet impreso. Si lo olvida, basta con su cédula.</div>`
      );
      afterEl.querySelector('#nm-print').addEventListener('click', printCarnet);
      afterEl.querySelector('#nm-send').addEventListener('click', () => sendCarnet(m));
      // Si ya estamos en #/nuevo el hash no cambia: recargamos la vista a mano.
      afterEl.querySelector('#nm-another').addEventListener('click', (ev) => {
        if (location.hash === '#/nuevo') {
          ev.preventDefault();
          render(root, new URLSearchParams());
        }
      });
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
}
