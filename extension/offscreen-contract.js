/** Private worker/document protocol. Never exposed through the page message bridge. */
(function (root) {
  'use strict';

  root.HhrOffscreenContract = Object.freeze({
    version: 1,
    target: 'hhr-shared-offscreen',
    documentPath: 'syslab-offscreen.html',
    maxPending: 32,
    minTimeoutMs: 250,
    maxTimeoutMs: 601_000,
    handshakeTimeoutMs: 3_000,
  });
})(typeof self !== 'undefined' ? self : globalThis);
