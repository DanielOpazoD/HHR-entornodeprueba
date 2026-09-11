/** Shared hidden document composition root. Syslab keeps the same iframe/session. */
(() => {
  'use strict';

  const transport = self.HhrSyslabOffscreenTransport.create({
    frame: document.getElementById('hhr-syslab-frame'),
    window,
  });
  const router = self.HhrOffscreenRouter.create({
    chrome,
    handlers: { syslab: (message, context) => transport.request(message, context) },
  });
  window.addEventListener('pagehide', () => {
    router.dispose();
    transport.dispose();
  }, { once: true });
})();
