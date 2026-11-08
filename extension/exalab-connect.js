(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1));
  const pair = params.get('pair');
  const origin = params.get('origin');
  // The capability stays in memory, never in history, storage, logs or a remote URL.
  history.replaceState(null, '', location.pathname);
  const button = document.getElementById('connect');
  const status = document.getElementById('status');
  document.getElementById('back').addEventListener('click', () => window.close());
  if (!globalThis.HhrAppOrigins?.has(origin) || !/^[A-Za-z0-9_-]{43}$/.test(pair || '')) {
    button.disabled = true; status.textContent = 'Abre una conexión nueva desde Laboratorio → Exalab en HHR.'; return;
  }
  button.addEventListener('click', async () => {
    // Request directly in the click turn so Chrome retains the user gesture.
    button.disabled = true;
    try {
      const permission = chrome.permissions.request({ permissions: ['cookies'], origins: ['https://exalab.saludoriente.cl/*'] });
      if (!await permission) { status.textContent = 'No se autorizó la conexión. Puedes volver a intentarlo.'; return; }
      const applicable = await chrome.cookies.getAll({ url: 'https://exalab.saludoriente.cl/web_ssmo/index.php' });
      const cookies = applicable.filter(cookie => ['PHPSESSID', 'cf_clearance'].includes(cookie.name))
        .map(({ name, value, domain }) => ({ name, value, domain }));
      if (!cookies.some(cookie => cookie.name === 'PHPSESSID')) {
        status.textContent = 'Primero ingresa a Exalab con tu cuenta personal. Luego vuelve a conectar.'; return;
      }
      status.textContent = 'Comprobando la sesión desde el puente del Mac mini…';
      const response = await fetch(`${origin}/.netlify/functions/exalab-proxy?action=connect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ pair, session: { cookies, userAgent: navigator.userAgent } }),
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(50_000),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true || result.connected !== true) {
        status.textContent = 'No se pudo vincular la sesión. Renueva el ingreso a Exalab desde este PC y abre una conexión nueva desde HHR.'; return;
      }
      status.textContent = 'Sesión conectada. Vuelve a HHR y pulsa Comprobar sesión.';
      button.hidden = true;
    } catch { status.textContent = 'No se pudo conectar. Revisa la conexión y abre una conexión nueva desde HHR.'; }
    finally { button.disabled = false; }
  });
})();
