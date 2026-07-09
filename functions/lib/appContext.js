const admin = require('firebase-admin');
const { HOSPITAL_CAPACITY, ensureFirebaseProjectRuntimeEnv } = require('./runtime/runtimeConfig');

ensureFirebaseProjectRuntimeEnv();
admin.initializeApp();

module.exports = {
  admin,
  HOSPITAL_CAPACITY,
};
