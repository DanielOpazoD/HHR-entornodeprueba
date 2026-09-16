/** Safe callback-style messaging for content scripts during MV3 runtime replacement. */
(function (root) {
  'use strict';
  const messageOf = error => String(error && error.message || error || 'Extension context invalidated.');
  const createSender = chromeApi => message => new Promise(resolve => {
    const fail = error => resolve({ error: messageOf(error) });
    const runtime = chromeApi && chromeApi.runtime;
    if (!runtime || typeof runtime.sendMessage !== 'function') return fail();
    try {
      runtime.sendMessage(message, response => {
        let runtimeError;
        try { runtimeError = runtime.lastError; }
        catch (error) { return fail(error); }
        resolve(runtimeError ? { error: runtimeError.message } : response);
      });
    } catch (error) { fail(error); }
  });
  root.HhrRuntimeMessageClient = Object.freeze({ createSender });
})(typeof self !== 'undefined' ? self : globalThis);
