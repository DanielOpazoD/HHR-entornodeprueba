/** Opens and reuses the extension-owned Syslab credential window. */
(function (root) {
  'use strict';

  const LOGIN_PAGE = 'syslab-login.html';

  const create = dependencies => {
    const chromeApi = dependencies && dependencies.chrome;
    if (
      !chromeApi ||
      !chromeApi.runtime ||
      typeof chromeApi.runtime.getURL !== 'function' ||
      !chromeApi.tabs ||
      typeof chromeApi.tabs.query !== 'function' ||
      typeof chromeApi.tabs.update !== 'function' ||
      !chromeApi.windows ||
      typeof chromeApi.windows.create !== 'function' ||
      typeof chromeApi.windows.update !== 'function'
    ) {
      throw new Error('No se pudo inicializar la ventana de acceso a Syslab.');
    }

    const open = async () => {
      const url = chromeApi.runtime.getURL(LOGIN_PAGE);
      const existingTabs = await chromeApi.tabs.query({ url });
      const existing = (Array.isArray(existingTabs) ? existingTabs : []).find(tab =>
        Number.isInteger(tab && tab.id)
      );

      if (existing) {
        await chromeApi.tabs.update(existing.id, { active: true });
        if (Number.isInteger(existing.windowId)) {
          await chromeApi.windows.update(existing.windowId, { focused: true });
        }
        return { ok: true, opened: true, reused: true };
      }

      await chromeApi.windows.create({
        url,
        type: 'popup',
        width: 720,
        height: 230,
        focused: true,
      });
      return { ok: true, opened: true, reused: false };
    };

    return Object.freeze({ open });
  };

  const register = dependencies => {
    const chromeApi = dependencies && dependencies.chrome;
    const messageContract = dependencies && dependencies.messageContract;
    if (
      !chromeApi ||
      !chromeApi.runtime ||
      !chromeApi.runtime.onMessage ||
      typeof chromeApi.runtime.onMessage.addListener !== 'function' ||
      !messageContract ||
      typeof messageContract.createRuntimeRouter !== 'function' ||
      !messageContract.types
    ) {
      throw new Error('No se pudo registrar la ventana de acceso a Syslab.');
    }
    const loginWindow = create({ chrome: chromeApi });
    const type = messageContract.types.SYSLAB_LOGIN_OPEN_REQUEST;
    chromeApi.runtime.onMessage.addListener(
      messageContract.createRuntimeRouter({
        [type]: Object.freeze({
          handle: () => loginWindow.open(),
          fallback: 'No se pudo abrir el acceso a Syslab.',
        }),
      })
    );
  };

  root.HhrSyslabLoginWindow = Object.freeze({ create, register });
  if (root.chrome && root.HhrRayenMessageContract) {
    root.HhrSyslabLoginWindow.register({
      chrome: root.chrome,
      messageContract: root.HhrRayenMessageContract,
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
