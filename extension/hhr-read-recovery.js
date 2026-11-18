/** Contextual recovery for read/preview failures. Never receives write or print callbacks. */
(() => {
  'use strict';
  const isSessionFailure = response => {
    const code = String(response?.errorCode || response?.code || '').toLowerCase();
    const message = String(response?.error || response?.message || '');
    return response?.requiresLogin === true || response?.state === 'requires-session' ||
      ['session_required', 'session_expired'].includes(code) || response?.status === 401 ||
      /\bHTTP\s*401\b|sin (?:token|sesi[oó]n)|(?:inicia|iniciar|inicie) sesi[oó]n|sesi[oó]n[^.]*?(?:venci[oó]|vencida|expir)/i.test(message);
  };
  const ready = report => report?.fichaMedico?.status === 'ready' && report.fichaMedico.reason === 'connected';
  const attach = ({ root, host, response, isCurrent, retry, sendMessage, runtimeMessages }) => {
    host.__hhrReadRecovery?.dispose();
    if (!isSessionFailure(response)) return null;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'hhr-center-action hhr-read-reconnect';
    button.textContent = 'Reconectar y continuar';
    const feedback = document.createElement('span');
    feedback.className = 'hhr-read-reconnect-feedback'; feedback.setAttribute('role', 'status');
    const lineBreak = document.createElement('br');
    host.append(lineBreak, button, feedback);
    let disposed = false, checking = false, pending = false;
    const sourceUrl = window.location.href;
    const current = () => !disposed && button.isConnected && root.isConnected && window.location.href === sourceUrl && isCurrent();
    const dispose = () => {
      disposed = true; observer.disconnect(); lineBreak.remove(); button.remove(); feedback.remove();
      if (host.__hhrReadRecovery?.dispose === dispose) delete host.__hhrReadRecovery;
    };
    const observer = new MutationObserver(() => { if (!current()) dispose(); });
    observer.observe(root, { childList: true, subtree: true });
    button.addEventListener('click', async () => {
      if (pending || !current()) return;
      pending = true; button.disabled = true; feedback.textContent = ' Comprobando conexión…';
      try {
        const result = await sendMessage({ type: checking ? runtimeMessages.EXTENSION_HEALTH_REQUEST : runtimeMessages.CONNECTION_REPAIR_REQUEST });
        if (!current()) return;
        const report = checking ? result : result?.report;
        if (ready(report)) {
          dispose(); await retry(); return;
        }
        checking = Boolean(result?.opened) || checking;
        feedback.textContent = result?.requiresLogin || checking
          ? ' Inicia sesión en la pestaña oficial y vuelve aquí para continuar.'
          : ' ' + (result?.message || result?.error || 'No se pudo verificar la conexión. Reintenta.');
        button.textContent = checking ? 'Continuar' : 'Reconectar y continuar';
      } catch (_error) {
        if (current()) feedback.textContent = ' La extensión no respondió. Reintenta.';
      } finally {
        pending = false; if (current()) button.disabled = false;
      }
    });
    host.__hhrReadRecovery = { dispose };
    return host.__hhrReadRecovery;
  };
  globalThis.HhrReadRecovery = Object.freeze({ isSessionFailure, attach });
})();
