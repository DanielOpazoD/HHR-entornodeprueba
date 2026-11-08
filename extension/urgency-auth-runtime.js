/** Native login/MFA runs behind an extension-owned iframe, never through the HHR page relay. */
(function (root) {
  'use strict';
  const { fail, messages } = root.HhrUrgencyApi;
  const model = root.HhrUrgencyAuthModel;
  const presentation = flow => ({
    ok: true, state: flow.state, parentOrigin: flow.parentOrigin,
    choices: flow.state === 'profiles' ? flow.choices.map(({ id, label }) => ({ id, label })) : [],
  });
  const create = ({ chrome, api, getAuthorizationKey, now }) => {
    const state = root.HhrUrgencyAuthState.create({ chrome, getAuthorizationKey, now });
    // In-flight locks contain no credentials; durable authorization lives in storage.session.
    const inFlight = new Set();
    const ticketFor = async (flow, choice) => {
      const data = await api.read('/api/tokenAcceso/', {
        body: { idPT: choice.professionTypeId, contextId: flow.contextId },
        assertCurrent: () => state.current(flow),
      });
      await state.authenticated(flow, model.nativeSession(data, choice));
      return { ok: true, state: 'authenticated', parentOrigin: flow.parentOrigin };
    };
    const chooseOrContinue = async flow => {
      if (flow.choices.length === 1) return await ticketFor(flow, flow.choices[0]);
      await state.save(flow);
      return presentation(flow);
    };
    const login = async (flow, message) => {
      const username = typeof message.username === 'string' ? message.username.trim() : '';
      const password = typeof message.password === 'string' ? message.password : '';
      const domain = typeof message.domain === 'string' ? message.domain.trim() : '';
      if (!username || username.length > 128 || !password || password.length > 1024 ||
          !/^[A-Za-z0-9.-]{1,80}$/.test(domain)) fail('ACCESS');
      if (flow.state !== 'credentials') fail('EXPIRED');
      let data;
      try {
        data = await api.read('/api/usuario/login', {
          body: { Username: username, Password: password, IdFacility: 0, Domain: domain, TimeStampOtp: null },
          assertCurrent: () => state.current(flow),
        });
      } finally { message.password = ''; }
      const stage = model.loginStage(data);
      const next = { ...flow, ...stage, username };
      if (next.state === 'profiles') return await chooseOrContinue(next);
      await state.save(next);
      return presentation(next);
    };
    const verifyOtp = async (flow, message) => {
      if (flow.state !== 'otp' || !/^\d{6}$/.test(message.otp || '')) fail('OTP');
      const result = await api.read('/api/emergencyAccess/Validate', {
        body: { LoginName: flow.username, Codigo: message.otp, ContextId: flow.contextId },
        assertCurrent: () => state.current(flow),
      });
      return await chooseOrContinue({ ...flow, state: 'profiles', choices: model.otpChoices(result) });
    };
    const perform = async (flow, message) => {
      if (message.operation === 'status') return presentation(flow);
      if (message.operation === 'login') return await login(flow, message);
      if (message.operation === 'otp') return await verifyOtp(flow, message);
      if (message.operation === 'choose' && flow.state === 'profiles') {
        const choice = flow.choices.find(item => item.id === message.choiceId);
        if (!choice) fail('ACCESS');
        return await ticketFor(flow, choice);
      }
      if (message.operation === 'cancel') { await state.remove(flow.id); return { ok: true, state: 'cancelled' }; }
      fail('EXPIRED');
    };
    const handle = async (message, sender) => {
      try {
        const flow = await state.owned(message.flowId, sender);
        if (message.operation === 'cancel') return await perform(flow, message);
        if (inFlight.has(flow.id)) return { ok: false, error: 'Espera a que termine el acceso actual.' };
        inFlight.add(flow.id);
        try { return await perform(flow, message); } finally { inFlight.delete(flow.id); }
      } catch (error) {
        return { ok: false, error: messages[error?.dauCode] || messages.READ };
      } finally { message.password = ''; message.otp = ''; }
    };
    return { ...state, handle };
  };
  const register = dependencies => {
    const api = root.HhrUrgencyApi.create({ fetchImpl: dependencies.fetchImpl });
    const auth = create({ ...dependencies, api });
    const contract = root.HhrRayenMessageContract;
    dependencies.chrome.runtime.onMessage.addListener(contract.createRuntimeRouter({
      [contract.types.URGENCY_DAU_AUTH_REQUEST]: {
        handle: (message, sender) => auth.handle(message, sender), fallback: messages.READ,
      },
    }));
    dependencies.chrome.tabs.onRemoved.addListener(tabId => { void auth.revoke({ tab: { id: tabId } }); });
    return { ...auth, readDau: root.HhrUrgencyDauApi.create({ api, normalizeRun: dependencies.normalizeRun }).read };
  };
  root.HhrUrgencyAuth = { create, register };
})(typeof self !== 'undefined' ? self : globalThis);
