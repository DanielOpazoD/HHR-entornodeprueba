const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { HOSPITAL_CAPACITY, ensureFirebaseProjectRuntimeEnv } = require('./runtime/runtimeConfig');

ensureFirebaseProjectRuntimeEnv();
const app = getApps()[0] || initializeApp();
const auth = getAuth(app);
const firestore = getFirestore(app);
const storage = getStorage(app);

module.exports = {
  app,
  auth,
  firestore,
  storage,
  FieldValue,
  Timestamp,
  HOSPITAL_CAPACITY,
};
