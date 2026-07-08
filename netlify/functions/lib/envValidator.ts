/**
 * Server-side environment variable validation for Netlify Functions.
 *
 * Does NOT use Zod — Netlify function bundles should stay lean.
 * Each validator checks a specific group of env vars and returns a typed result.
 */

/* ── Generic result type ────────────────────────────────────────────── */

interface EnvValidationOk<T> {
  valid: true;
  config: T;
  missing?: undefined;
}

interface EnvValidationFail {
  valid: false;
  config?: undefined;
  missing: string[];
}

export type EnvValidationResult<T> = EnvValidationOk<T> | EnvValidationFail;

/* ── Helpers ────────────────────────────────────────────────────────── */

const env = (key: string): string | undefined => process.env[key]?.trim() || undefined;

const check = <T>(
  required: Record<string, string>,
  optional: Record<string, string | undefined> = {}
): EnvValidationResult<T> => {
  const missing: string[] = [];
  const config: Record<string, string | undefined> = {};

  for (const [field, envKey] of Object.entries(required)) {
    const value = env(envKey);
    if (!value) {
      missing.push(envKey);
    }
    config[field] = value;
  }

  for (const [field, envKey] of Object.entries(optional)) {
    config[field] = envKey ? env(envKey) : undefined;
  }

  if (missing.length > 0) {
    return { valid: false, missing };
  }

  return { valid: true, config: config as T };
};

/* ── Firebase (shared by most server functions) ─────────────────────── */

export interface FirebaseServerConfig {
  apiKey: string;
  apiKeyB64?: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const validateFirebaseServerEnv = (): EnvValidationResult<FirebaseServerConfig> => {
  // apiKey can come from either the plain or B64 var
  const apiKey = env('VITE_FIREBASE_API_KEY');
  const apiKeyB64 = env('VITE_FIREBASE_API_KEY_B64');

  if (!apiKey && !apiKeyB64) {
    const base = check<FirebaseServerConfig>(
      {
        apiKey: 'VITE_FIREBASE_API_KEY',
        authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
        projectId: 'VITE_FIREBASE_PROJECT_ID',
        storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
        messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
        appId: 'VITE_FIREBASE_APP_ID',
      },
      { apiKeyB64: 'VITE_FIREBASE_API_KEY_B64' }
    );
    // Ensure VITE_FIREBASE_API_KEY appears in missing if neither key is set
    if (!base.valid && !base.missing.includes('VITE_FIREBASE_API_KEY')) {
      base.missing.unshift('VITE_FIREBASE_API_KEY (o VITE_FIREBASE_API_KEY_B64)');
    }
    return base;
  }

  return check<FirebaseServerConfig>(
    {
      authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
      projectId: 'VITE_FIREBASE_PROJECT_ID',
      storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
      messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
      appId: 'VITE_FIREBASE_APP_ID',
    },
    {
      apiKey: 'VITE_FIREBASE_API_KEY',
      apiKeyB64: 'VITE_FIREBASE_API_KEY_B64',
    }
  ) as EnvValidationResult<FirebaseServerConfig>;
};

/* ── Gmail (email functions: send-fuga-notification, census email) ─── */

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export const validateGmailEnv = (): EnvValidationResult<GmailConfig> =>
  check<GmailConfig>({
    clientId: 'GMAIL_CLIENT_ID',
    clientSecret: 'GMAIL_CLIENT_SECRET',
    refreshToken: 'GMAIL_REFRESH_TOKEN',
  });

/* ── AI providers (clinical-ai-summary) ─────────────────────────────── */

export interface AiProviderConfig {
  provider?: string;
  geminiKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  deepseekKey?: string;
}

export const validateAiProviderEnv = (): EnvValidationResult<AiProviderConfig> => {
  const provider = env('AI_PROVIDER');
  const geminiKey = env('GEMINI_API_KEY') || env('API_KEY');
  const openaiKey = env('OPENAI_API_KEY');
  const anthropicKey = env('ANTHROPIC_API_KEY');
  const deepseekKey = env('DEEPSEEK_API_KEY');

  // At least one API key must be present
  if (!geminiKey && !openaiKey && !anthropicKey && !deepseekKey) {
    return {
      valid: false,
      missing: [
        'Se requiere al menos una API key de AI: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY o DEEPSEEK_API_KEY',
      ],
    };
  }

  return {
    valid: true,
    config: { provider, geminiKey, openaiKey, anthropicKey, deepseekKey },
  };
};

/* ── Syslab (syslab-proxy) ──────────────────────────────────────────── */

export interface SyslabConfig {
  proxyUrl: string;
}

export const validateSyslabEnv = (): EnvValidationResult<SyslabConfig> =>
  check<SyslabConfig>({
    proxyUrl: 'SYSLAB_PROXY_URL',
  });

/* ── WhatsApp (whatsapp-proxy) ──────────────────────────────────────── */

export interface WhatsappConfig {
  botUrl: string;
}

export const validateWhatsappEnv = (): EnvValidationResult<WhatsappConfig> => {
  const botUrl = env('WHATSAPP_BOT_URL') || env('WHATSAPP_BOT_SERVER');

  if (!botUrl) {
    return {
      valid: false,
      missing: ['WHATSAPP_BOT_URL (o WHATSAPP_BOT_SERVER)'],
    };
  }

  return { valid: true, config: { botUrl } };
};

/* ── MMRAD (mmrad-search) ───────────────────────────────────────────── */

export interface MmradConfig {
  username: string;
  password: string;
}

export const validateMmradEnv = (): EnvValidationResult<MmradConfig> =>
  check<MmradConfig>({
    username: 'MMRAD_USERNAME',
    password: 'MMRAD_PASSWORD',
  });

/* ── CORS / Netlify built-ins (informational) ───────────────────────── */

export interface NetlifySiteConfig {
  url?: string;
  deployPrimeUrl?: string;
  deployUrl?: string;
  siteUrl?: string;
  appUrl?: string;
}

export const getNetlifySiteConfig = (): NetlifySiteConfig => ({
  url: env('URL'),
  deployPrimeUrl: env('DEPLOY_PRIME_URL'),
  deployUrl: env('DEPLOY_URL'),
  siteUrl: env('SITE_URL'),
  appUrl: env('APP_URL'),
});
