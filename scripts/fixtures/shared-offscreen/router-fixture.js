/* Installed only into the disposable extension copy by the runtime smoke. */
(() => {
  const original = self.HhrOffscreenRouter;
  const events = [];
  let router;
  const session = () =>
    new Promise((resolve, reject) => {
      const frame = document.getElementById('hhr-syslab-frame');
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(new Error('Fixture iframe not ready')), 1500);
      function finish(error, result) {
        clearTimeout(timer);
        removeEventListener('message', receive);
        if (error) reject(error);
        else resolve(result);
      }
      function receive(event) {
        if (event.source !== frame.contentWindow || event.origin !== 'http://10.4.69.90') return;
        if (event.data?.type === 'SMOKE_SESSION_RESULT' && event.data.id === id) {
          finish(null, event.data.state);
        }
      }
      addEventListener('message', receive);
      frame.contentWindow.postMessage({ type: 'SMOKE_SESSION', id }, 'http://10.4.69.90');
    });
  self.HhrOffscreenRouter = Object.freeze({
    create(deps) {
      router = original.create({
        ...deps,
        handlers: {
          ...deps.handlers,
          fixture: async (payload, { signal }) => {
            if (payload.op === 'session') return session();
            if (payload.op === 'diagnostics')
              return {
                documentId: router.documentId,
                router: router.getDiagnostics(),
                events: [...events],
              };
            events.push(`started:${payload.token}`);
            signal.addEventListener('abort', () => events.push(`aborted:${payload.token}`), {
              once: true,
            });
            // Intentionally ignore abort: late completions must not settle another request.
            await new Promise(resolve => setTimeout(resolve, payload.delayMs || 0));
            events.push(`completed:${payload.token}`);
            if (payload.op === 'error') throw new Error('Synthetic fixture failure');
            return { token: payload.token };
          },
        },
      });
      return router;
    },
  });
})();
