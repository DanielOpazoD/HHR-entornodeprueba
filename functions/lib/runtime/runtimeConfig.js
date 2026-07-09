const DEFAULT_HOSPITAL_ID = 'hanga_roa';
const DEFAULT_HOSPITAL_CAPACITY = 38;
const DEFAULT_FIREBASE_PROJECT_ID = 'hhr-pruebas';

const toPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const resolveFirebaseProjectId = () => {
  const explicitProjectId = String(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || ''
  ).trim();
  if (explicitProjectId) {
    return explicitProjectId;
  }

  const firebaseConfig = process.env.FIREBASE_CONFIG;
  if (firebaseConfig) {
    try {
      const parsedConfig = JSON.parse(firebaseConfig);
      const projectId = String(parsedConfig?.projectId || '').trim();
      if (projectId) {
        return projectId;
      }
    } catch (_error) {
      return DEFAULT_FIREBASE_PROJECT_ID;
    }
  }

  return DEFAULT_FIREBASE_PROJECT_ID;
};

const ensureFirebaseProjectRuntimeEnv = () => {
  const projectId = resolveFirebaseProjectId();

  if (!process.env.GCLOUD_PROJECT) {
    process.env.GCLOUD_PROJECT = projectId;
  }

  if (!process.env.FIREBASE_CONFIG) {
    process.env.FIREBASE_CONFIG = JSON.stringify({
      projectId,
      storageBucket: process.env.STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    });
  }

  return projectId;
};

const HOSPITAL_ID = process.env.HOSPITAL_ID || DEFAULT_HOSPITAL_ID;
const HOSPITAL_CAPACITY = toPositiveInteger(
  process.env.HOSPITAL_CAPACITY,
  DEFAULT_HOSPITAL_CAPACITY
);

module.exports = {
  DEFAULT_FIREBASE_PROJECT_ID,
  DEFAULT_HOSPITAL_CAPACITY,
  DEFAULT_HOSPITAL_ID,
  HOSPITAL_CAPACITY,
  HOSPITAL_ID,
  ensureFirebaseProjectRuntimeEnv,
  resolveFirebaseProjectId,
};
