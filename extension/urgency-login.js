/** Extension-origin credentials UI. Only completion and height are posted to its HHR parent. */
(() => {
  'use strict';
  const type = globalThis.HhrRayenMessageContract.types.URGENCY_DAU_AUTH_REQUEST;
  const flowId = new URL(location.href).searchParams.get('flow');
  const login = document.getElementById('login-form');
  const otp = document.getElementById('otp-form');
  const profile = document.getElementById('profile-form');
  const status = document.getElementById('status');
  let parentOrigin = '', completed = false, busy = false;
  const notify = (state, extra = {}) => {
    if (!parentOrigin || parent === window) return;
    parent.postMessage({ type: 'HHR_URGENCY_LOGIN_STATE', flowId, state, ...extra }, parentOrigin);
  };
  const send = async (operation, values = {}) => {
    try { return await chrome.runtime.sendMessage({ type, flowId, operation, ...values }); }
    catch { return { ok: false, error: 'No se pudo conectar con la extensión. Actualízala y reintenta.' }; }
  };
  const present = result => {
    if (!result.ok) { status.textContent = result.error || 'Rayen no confirmó el acceso.'; return; }
    parentOrigin = result.parentOrigin || parentOrigin;
    login.hidden = result.state !== 'credentials';
    otp.hidden = result.state !== 'otp';
    profile.hidden = result.state !== 'profiles';
    status.textContent = '';
    if (result.state === 'profiles') {
      const select = profile.elements.choiceId;
      select.replaceChildren();
      for (const choice of result.choices || []) {
        const option = document.createElement('option');
        option.value = choice.id; option.textContent = choice.label; select.append(option);
      }
    }
    if (result.state === 'authenticated') {
      completed = true;
      status.textContent = 'Acceso confirmado. Preparando el DAU…';
      notify('authenticated');
    }
    notify('resize', { height: document.documentElement.scrollHeight });
  };
  const submit = async (form, operation, event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const values = Object.fromEntries(new FormData(form));
    const pending = send(operation, values);
    if (form.elements.password) form.elements.password.value = '';
    if (form.elements.otp) form.elements.otp.value = '';
    values.password = ''; values.otp = '';
    for (const button of form.querySelectorAll('button')) button.disabled = true;
    status.textContent = 'Verificando en Rayen…';
    const response = await pending;
    busy = false;
    for (const button of form.querySelectorAll('button')) button.disabled = false;
    present(response);
  };
  login.addEventListener('submit', event => void submit(login, 'login', event));
  otp.addEventListener('submit', event => void submit(otp, 'otp', event));
  profile.addEventListener('submit', event => void submit(profile, 'choose', event));
  document.getElementById('cancel').addEventListener('click', () => {
    completed = true;
    void send('cancel');
    notify('cancelled');
  });
  window.addEventListener('pagehide', () => { if (!completed) void send('cancel'); });
  new ResizeObserver(() => notify('resize', { height: document.documentElement.scrollHeight })).observe(document.body);
  void send('status').then(present);
})();
