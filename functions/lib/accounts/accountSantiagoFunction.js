const { onRequest } = require('firebase-functions/v2/https');
const { resolveFirebaseProjectId } = require('../runtime/runtimeConfig');

// The existing callable owns its protocol, CORS, authentication and error policy.
const createSantiagoAccountFunction = callableHandler =>
  onRequest(
    {
      region: 'southamerica-west1',
      serviceAccount: `${resolveFirebaseProjectId()}@appspot.gserviceaccount.com`,
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
