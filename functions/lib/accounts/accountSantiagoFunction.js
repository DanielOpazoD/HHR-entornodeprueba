const { onRequest } = require('firebase-functions/v2/https');
const { resolveFirebaseProjectId } = require('../runtime/runtimeConfig');

// The existing callable owns its protocol, CORS, authentication and error policy.
const createSantiagoAccountFunction = callableHandler =>
  onRequest(
    {
      region: 'southamerica-west1',
      serviceAccount: `${resolveFirebaseProjectId()}@appspot.gserviceaccount.com`,
      // 1 GiB and 1 CPU were tried (#1158) and did not help: on 2026-11-02 the cold start took
      // 2.46 s (2.0-2.3 s before) and the first answer 1.28 s (1.05-1.15 s before).
      memory: '256MiB',
      cpu: 'gcf_gen1',
      concurrency: 1,
      minInstances: 0,
      maxInstances: 10,
      timeoutSeconds: 60,
    },
    callableHandler
  );

module.exports = { createSantiagoAccountFunction };
