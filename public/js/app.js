import { reloadConfig } from './config.js';
import { html, setHTML, fmtLongToday } from './ui.js';

const routes = {
  entrada: () => import('./views/entrada.js'),
  mensualidades: () => import('./views/mensualidades.js'),
  nuevo: () => import('./views/nuevo.js'),
  clientes: () => import('./views/clientes.js'),
  reportes: () => import('./views/reportes.js'),
  ajustes: () => import('./views/ajustes.js'),
};

const view = document.getElementById('view');
let cleanup = null;
let navSeq = 0;

async function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const name = routes[path] ? path : 'entrada';
  const seq = ++navSeq;

  cleanup?.();
  cleanup = null;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.route === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }

  setHTML(view, html`<div class="loading">Cargando…</div>`);
  try {
    // Trae precios y ajustes frescos por si se cambiaron desde otro equipo.
    await reloadConfig().catch(() => {});
    const mod = await routes[name]();
    const done = await mod.render(view, new URLSearchParams(qs ?? ''));
    if (seq === navSeq) cleanup = done ?? null;
    else done?.();
  } catch (err) {
    console.error(err);
    if (seq === navSeq) setHTML(view, html`<div class="loading">No se pudo cargar esta sección: ${err.message}</div>`);
  }
}

function tickClock() {
  const d = new Date();
  document.getElementById('clock').textContent =
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  document.getElementById('today-label').textContent = fmtLongToday();
}

tickClock();
setInterval(tickClock, 10_000);

try {
  await reloadConfig();
  window.addEventListener('hashchange', route);
  route();
} catch (err) {
  setHTML(view, html`<div class="loading">${err.message}. Revisa que el servidor esté encendido y recarga la página.</div>`);
}
