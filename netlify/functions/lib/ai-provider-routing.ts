import type { ClinicalAIAction, ClinicalAIProvider, ClinicalAIRoutingConfig } from './ai-provider';

type FetchLike = typeof fetch;

const SUPPORTED_ACTIONS = new Set<ClinicalAIAction>([
  'clinical_ai_summary',
  'clinical_document_import',
  'cie10_search',
  'clinical_attachment_name_suggestion',
]);

const SUPPORTED_PROVIDERS = new Set<ClinicalAIProvider>([
  'gemini',
  'openai',
  'anthropic',
  'deepseek',
]);

const DEFAULT_HOSPITAL_ID = 'hanga_roa';
const ROUTING_DOC_ID = 'aiProviderRouting';

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreValue> };
  arrayValue?: { values?: FirestoreValue[] };
};

type FirestoreDocument = {
  fields?: Record<string, FirestoreValue>;
};

const resolveFirebaseProjectId = (env: NodeJS.ProcessEnv): string | null => {
  const explicitProjectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (explicitProjectId) return explicitProjectId;

  const firebaseConfig = env.FIREBASE_CONFIG?.trim();
  if (!firebaseConfig) return null;

  try {
    const parsed = JSON.parse(firebaseConfig) as { projectId?: string };
    return parsed.projectId?.trim() || null;
  } catch {
    return null;
  }
};

const decodeFirestoreValue = (value: FirestoreValue | undefined): unknown => {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue ?? '';
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue ?? 0);
  if ('doubleValue' in value) return Number(value.doubleValue ?? 0);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values ?? []).map(item => decodeFirestoreValue(item));
  }
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue?.fields ?? {}).map(([key, nested]) => [
        key,
        decodeFirestoreValue(nested),
      ])
    );
  }
  return undefined;
};

export const parseClinicalAIRoutingConfig = (raw: unknown): ClinicalAIRoutingConfig | null => {
  if (!raw || typeof raw !== 'object') return null;
  const actions = (raw as { actions?: unknown }).actions;
  if (!actions || typeof actions !== 'object') return null;

  const normalized: ClinicalAIRoutingConfig = { actions: {} };
  Object.entries(actions as Record<string, unknown>).forEach(([action, value]) => {
    if (!SUPPORTED_ACTIONS.has(action as ClinicalAIAction) || !value || typeof value !== 'object') {
      return;
    }

    const rule = value as { enabled?: unknown; provider?: unknown; model?: unknown };
    const provider =
      typeof rule.provider === 'string' &&
      SUPPORTED_PROVIDERS.has(rule.provider as ClinicalAIProvider)
        ? (rule.provider as ClinicalAIProvider)
        : null;
    if (!provider) return;

    normalized.actions![action as ClinicalAIAction] = {
      enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
      provider,
      model: typeof rule.model === 'string' && rule.model.trim() ? rule.model.trim() : null,
    };
  });

  return Object.keys(normalized.actions ?? {}).length > 0 ? normalized : null;
};

export const parseFirestoreClinicalAIRoutingDocument = (
  document: FirestoreDocument | null
): ClinicalAIRoutingConfig | null => {
  if (!document?.fields) return null;
  return parseClinicalAIRoutingConfig(
    decodeFirestoreValue({ mapValue: { fields: document.fields } })
  );
};

export const loadClinicalAIRoutingConfigFromFirestore = async ({
  bearerToken,
  env = process.env,
  fetchImpl = fetch,
  hospitalId = env.ACTIVE_HOSPITAL_ID || DEFAULT_HOSPITAL_ID,
}: {
  bearerToken: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  hospitalId?: string;
}): Promise<ClinicalAIRoutingConfig | null> => {
  const projectId = resolveFirebaseProjectId(env);
  if (!projectId) return null;

  const documentPath = `hospitals/${hospitalId}/settings/${ROUTING_DOC_ID}`;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    console.warn(`[ClinicalAI] routing config lookup failed (${response.status}).`);
    return null;
  }

  return parseFirestoreClinicalAIRoutingDocument((await response.json()) as FirestoreDocument);
};
