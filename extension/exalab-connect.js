(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1));
  const pair = params.get('pair');
  const origin = params.get('origin');
  // The capability stays in memory, never in history, storage, logs or a remote URL.
  history.replaceState(null, '', location.pathname);
  const [button, status, auto] = ['connect', 'status', 'auto'].map(id => document.getElementById(id));
  document.getElementById('back').addEventListener('click', () => window.close());
  if (!globalThis.HhrAppOrigins?.has(origin) || !/^[A-Za-z0-9_-]{43}$/.test(pair || '')) {
    button.disabled = true; status.textContent = 'Abre una conexión nueva desde Laboratorio → Exalab en HHR.'; return;
  }
  button.addEventListener('click', async () => {
    const session = globalThis.HhrExalabSession;
    // Request directly in the click turn so Chrome retains the user gesture.
    button.disabled = true;
    try {
      const permission = chrome.permissions.request(session.GRANT);
      if (!await permission) { status.textContent = 'No se autorizó la conexión. Puedes volver a intentarlo.'; return; }
      const cookies = await session.readCookies();
      if (!session.hasSession(cookies)) {
        status.textContent = 'Primero ingresa a Exalab con tu cuenta personal. Luego vuelve a conectar.'; return;
      }
      status.textContent = 'Comprobando la sesión desde el puente del Mac mini…';
      const linked = await session.connect(origin, pair, cookies, navigator.userAgent);
      if (!linked.connected) {
        status.textContent = 'No se pudo vincular la sesión. Renueva el ingreso a Exalab desde este PC y abre una conexión nueva desde HHR.'; return;
      }
      // Remembered consent names this HHR site, HHR account and Exalab user; only they reconnect silently.
      const remember = auto?.checked === true && Boolean(linked.owner && linked.exalabUser) && session.autoOrigin(origin);
      await chrome.storage.local.set({ exalabAutoConnect: remember, exalabAutoConnectOrigin: remember ? origin : null,
        exalabAutoConnectOwner: remember ? linked.owner : null, exalabAutoConnectUser: remember ? linked.exalabUser : null });
      status.textContent = 'Sesión conectada. Puedes cerrar esta pestaña.';
      button.hidden = true;
    } catch { status.textContent = 'No se pudo conectar. Revisa la conexión y abre una conexión nueva desde HHR.'; }
    finally { button.disabled = false; }
  });
})();
