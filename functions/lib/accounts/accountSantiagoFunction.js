const { onRequest } = require('firebase-functions/v2/https');
const { resolveFirebaseProjectId } = require('../runtime/runtimeConfig');

// The existing callable owns its protocol, CORS, authentication and error policy.
const createSantiagoAccountFunction = callableHandler =>
  onRequest(
    {
      region: 'southamerica-west1',
      serviceAccount: `${resolveFirebaseProjectId()}@appspot.gserviceaccount.com`,
      // Password verification and the cold start are CPU work: at 1/6 of a CPU, a login that found
      // no running instance waited 3.9 s here (2026-11-02), 2.2 s of it starting the instance.
      memory: '1GiB',
      cpu: 1,
      concurrency: 1,
      minInstances: 0,
      maxInstances: 10,
      timeoutSeconds: 60,
    },
    callableHandler
  );

module.exports = { createSantiagoAccountFunction };
