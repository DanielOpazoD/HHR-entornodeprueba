(() => {
  'use strict';

  const form = document.getElementById('syslab-login-form');
  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  if (!form || !runtimeMessages) return;
  const username = form.querySelector('input[name="username"]');
  const password = form.querySelector('input[name="password"]');
  const submit = form.querySelector('button[type="submit"]');
  const status = form.querySelector('output');
  let parentOrigin = '';
  try {
    const candidate = new URL(document.referrer).origin;
    if (candidate === 'https://fichamedico.rayensalud.cl') parentOrigin = candidate;
  } catch (_error) {}

  const notifyParent = (connected, message) => {
    if (!parentOrigin || window.parent === window) return;
    window.parent.postMessage({
      type: 'HHR_SYSLAB_LOGIN_STATE',
      connected: Boolean(connected),
      message: String(message || ''),
    }, parentOrigin);
  };

  const sendMessage = message => new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { error: 'La extensión no respondió.' });
    });
  });

  const showStatus = (message, connected = false) => {
    status.textContent = String(message || '');
    status.style.color = connected ? '#087f5b' : '#765c15';
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const safeUsername = username.value.trim();
    const safePassword = password.value;
    if (!safeUsername || !safePassword) return;
    submit.disabled = true;
    showStatus('Verificando credenciales en Syslab…');
    const response = await sendMessage({
      type: runtimeMessages.SYSLAB_LOGIN_REQUEST,
      username: safeUsername,
      password: safePassword,
    });
    password.value = '';
    submit.disabled = false;
    const connected = Boolean(response && !response.error && response.connected);
    const message = connected
      ? 'Syslab conectado. Vuelve a Eloísa y pulsa Actualizar.'
      : String(response && response.error || 'Syslab no confirmó el acceso.');
    showStatus(message, connected);
    notifyParent(connected, message);
    if (!connected) password.focus();
  });

  void sendMessage({ type: runtimeMessages.SYSLAB_STATUS_REQUEST }).then(response => {
    const connected = Boolean(response && !response.error && response.connected);
    if (!connected) return;
    const message = String(response.message || 'Syslab conectado.');
    showStatus(message, true);
    notifyParent(true, message);
  });
})();
