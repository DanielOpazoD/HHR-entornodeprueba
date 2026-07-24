/**
 * Client-side environment variable validation using Zod.
 *
 * Firebase vars are required in DEV (loaded from .env) but optional in PROD
 * (fetched at runtime from the Netlify `firebase-config` function).
 */
import { z } from 'zod';
import { createScopedLogger } from '@/services/utils/loggerScope';

const envValidatorLogger = createScopedLogger('EnvValidator');

/* ── Helpers ────────────────────────────────────────────────────────── */

const nonEmpty = z.string().min(1);
const optionalStr = z.string().optional().default('');

// In DEV, Firebase vars come from .env; in PROD they come from Netlify Function at runtime
const isDevMode = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

/* ── Schema ─────────────────────────────────────────────────────────── */

const clientEnvSchema = z.object({
  /* ── Firebase — required only in DEV (prod loads at runtime) ─────── */
  VITE_FIREBASE_API_KEY: isDevMode ? nonEmpty : optionalStr,
  VITE_FIREBASE_API_KEY_B64: optionalStr,
  VITE_FIREBASE_AUTH_DOMAIN: isDevMode ? nonEmpty : optionalStr,
  VITE_FIREBASE_PROJECT_ID: isDevMode ? nonEmpty : optionalStr,
  VITE_FIREBASE_STORAGE_BUCKET: isDevMode ? nonEmpty : optionalStr,
  VITE_FIREBASE_MESSAGING_SENDER_ID: isDevMode ? nonEmpty : optionalStr,
  VITE_FIREBASE_APP_ID: isDevMode ? nonEmpty : optionalStr,

  /* ── Legacy Firebase (migration support, always optional) ────────── */
  VITE_LEGACY_FIREBASE_API_KEY: optionalStr,
  VITE_LEGACY_FIREBASE_AUTH_DOMAIN: optionalStr,
  VITE_LEGACY_FIREBASE_PROJECT_ID: optionalStr,
  VITE_LEGACY_FIREBASE_STORAGE_BUCKET: optionalStr,
  VITE_LEGACY_FIREBASE_MESSAGING_SENDER_ID: optionalStr,
  VITE_LEGACY_FIREBASE_APP_ID: optionalStr,

  /* ── AI providers (local dev keys) ──────────────────────────────── */
  VITE_LOCAL_GEMINI_API_KEY: optionalStr,
  VITE_LOCAL_OPENAI_API_KEY: optionalStr,
  VITE_LOCAL_ANTHROPIC_API_KEY: optionalStr,
  VITE_LOCAL_AI_PROVIDER: z.enum(['gemini', 'openai', 'anthropic']).optional(),

  /* ── Email / endpoints ──────────────────────────────────────────── */
  VITE_ALLOW_DEV_EMAIL_SEND: optionalStr,
  VITE_CENSUS_EMAIL_ENDPOINT: optionalStr,
  VITE_CLINICAL_AI_SUMMARY_ENDPOINT: optionalStr,

  /* ── Google OAuth ───────────────────────────────────────────────── */
  VITE_GOOGLE_CLIENT_ID: optionalStr,

  /* ── Emulators ──────────────────────────────────────────────────── */
  VITE_FUNCTIONS_EMULATOR_HOST: optionalStr,
  VITE_AUTH_EMULATOR_HOST: optionalStr,
  VITE_FIRESTORE_EMULATOR_HOST: optionalStr,
  VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_EMAIL: optionalStr,
  VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_PASSWORD: optionalStr,

  /* ── Auth behaviour overrides ───────────────────────────────────── */
  VITE_AUTH_PREFER_REDIRECT_ON_LOCALHOST: optionalStr,
  VITE_AUTH_AUTO_REDIRECT_FALLBACK: optionalStr,

  /* ── Debug / legacy ─────────────────────────────────────────────── */
  VITE_DEBUG_LEGACY_FIREBASE: optionalStr,
  VITE_LEGACY_COMPATIBILITY_MODE: optionalStr,
  VITE_DEBUG_REPOSITORY: optionalStr,
  VITE_E2E_MODE: optionalStr,

  /* ── Integrations ───────────────────────────────────────────────── */
  VITE_WHATSAPP_BOT_URL: optionalStr,

  /* ── Telemetry ──────────────────────────────────────────────────── */
  VITE_OPERATIONAL_TELEMETRY_ENDPOINT: optionalStr,
  VITE_OPERATIONAL_TELEMETRY_SAMPLE_RATE: optionalStr,
});

/* ── Public types ───────────────────────────────────────────────────── */

export type ValidatedClientEnv = z.infer<typeof clientEnvSchema>;

export interface ClientEnvValidationOk {
  success: true;
  env: ValidatedClientEnv;
  issues?: undefined;
}

export interface ClientEnvValidationFail {
  success: false;
  env?: undefined;
  issues: string[];
}

export type ClientEnvValidationResult = ClientEnvValidationOk | ClientEnvValidationFail;

/* ── Validate ───────────────────────────────────────────────────────── */

export function validateClientEnv(): ClientEnvValidationResult {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env : {};

  const result = clientEnvSchema.safeParse(raw);

  if (result.success) {
    return { success: true, env: result.data };
  }

  const issues = result.error.issues.map(issue => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });

  // Log a clear table so the developer can immediately see what is missing
  envValidatorLogger.error(
    `Validación de variables de entorno falló:\n${issues.map(i => `  ✗ ${i}`).join('\n')}`
  );

  return { success: false, issues };
}
