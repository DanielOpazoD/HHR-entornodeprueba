/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_API_KEY_B64?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_LEGACY_FIREBASE_API_KEY?: string;
  readonly VITE_LEGACY_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_LEGACY_FIREBASE_PROJECT_ID?: string;
  readonly VITE_LEGACY_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_LEGACY_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_LEGACY_FIREBASE_APP_ID?: string;
  readonly VITE_LOCAL_GEMINI_API_KEY?: string;
  readonly VITE_LOCAL_OPENAI_API_KEY?: string;
  readonly VITE_LOCAL_ANTHROPIC_API_KEY?: string;
  readonly VITE_LOCAL_AI_PROVIDER?: 'gemini' | 'openai' | 'anthropic';
  readonly VITE_E2E_MODE?: string;
  readonly VITE_ALLOW_DEV_EMAIL_SEND?: string;
  readonly VITE_CENSUS_EMAIL_ENDPOINT?: string;
  readonly VITE_CLINICAL_AI_SUMMARY_ENDPOINT?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_FUNCTIONS_EMULATOR_HOST?: string;
  readonly VITE_AUTH_EMULATOR_HOST?: string;
  readonly VITE_FIRESTORE_EMULATOR_HOST?: string;
  readonly VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_EMAIL?: string;
  readonly VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_PASSWORD?: string;
  readonly VITE_AUTH_PREFER_REDIRECT_ON_LOCALHOST?: string;
  readonly VITE_AUTH_AUTO_REDIRECT_FALLBACK?: string;
  readonly VITE_DEBUG_LEGACY_FIREBASE?: string;
  readonly VITE_LEGACY_COMPATIBILITY_MODE?: string;
  readonly VITE_DEBUG_REPOSITORY?: string;
  readonly VITE_WHATSAPP_BOT_URL?: string;
  readonly VITE_OPERATIONAL_TELEMETRY_ENDPOINT?: string;
  readonly VITE_OPERATIONAL_TELEMETRY_SAMPLE_RATE?: string;
  readonly VITE_RAYEN_CLINICAL_ENRICHMENT_BATCH_MODE?: 'off' | 'shadow' | 'enforced';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  const __APP_BUILD_VERSION__: string;

  interface Window {
    __HHR_E2E_OVERRIDE__?: Record<string, import('./types').DailyRecord>;
  }
}

export {};
