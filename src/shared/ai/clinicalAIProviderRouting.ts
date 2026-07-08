export const CLINICAL_AI_PROVIDERS = ['gemini', 'openai', 'anthropic', 'deepseek'] as const;
export type ClinicalAIProvider = (typeof CLINICAL_AI_PROVIDERS)[number];

export const CLINICAL_AI_ACTIONS = [
  {
    id: 'clinical_document_import',
    label: 'Importación de documentos clínicos',
    description: 'Convierte texto PDF/DOCX en borradores editables de epicrisis o traslado.',
  },
  {
    id: 'clinical_ai_summary',
    label: 'Resumen clínico',
    description: 'Resume contexto del paciente desde censo, entregas y documentos clínicos.',
  },
  {
    id: 'cie10_search',
    label: 'Búsqueda CIE-10/FONASA',
    description: 'Apoya codificación diagnóstica y búsqueda terminológica bajo demanda.',
  },
  {
    id: 'clinical_attachment_name_suggestion',
    label: 'Nombre de archivos del episodio',
    description: 'Sugiere nombres breves y seguros para archivos anexos de una hospitalización.',
  },
] as const;

export type ClinicalAIActionId = (typeof CLINICAL_AI_ACTIONS)[number]['id'];

export const CLINICAL_AI_PROVIDER_LABELS: Record<ClinicalAIProvider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
};

export interface ClinicalAIProviderRoutingRule {
  enabled: boolean;
  provider: ClinicalAIProvider | null;
  model?: string | null;
}

export interface ClinicalAIProviderRoutingDocument {
  actions: Partial<Record<ClinicalAIActionId, ClinicalAIProviderRoutingRule>>;
  updatedAt?: string | null;
  updatedByEmail?: string | null;
}

const isProvider = (value: unknown): value is ClinicalAIProvider =>
  typeof value === 'string' && CLINICAL_AI_PROVIDERS.includes(value as ClinicalAIProvider);

const isAction = (value: unknown): value is ClinicalAIActionId =>
  typeof value === 'string' && CLINICAL_AI_ACTIONS.some(action => action.id === value);

export const normalizeClinicalAIProviderRoutingDocument = (
  raw: unknown
): ClinicalAIProviderRoutingDocument => {
  const rawActions =
    raw && typeof raw === 'object' && 'actions' in raw
      ? (raw as { actions?: unknown }).actions
      : null;
  const actions: ClinicalAIProviderRoutingDocument['actions'] = {};

  if (rawActions && typeof rawActions === 'object') {
    Object.entries(rawActions as Record<string, unknown>).forEach(([actionId, rawRule]) => {
      if (!isAction(actionId) || !rawRule || typeof rawRule !== 'object') return;

      const rule = rawRule as { enabled?: unknown; provider?: unknown; model?: unknown };
      actions[actionId] = {
        enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
        provider: isProvider(rule.provider) ? rule.provider : null,
        model: typeof rule.model === 'string' && rule.model.trim() ? rule.model.trim() : null,
      };
    });
  }

  const metadata = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    actions,
    updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : null,
    updatedByEmail: typeof metadata.updatedByEmail === 'string' ? metadata.updatedByEmail : null,
  };
};

export const createDefaultClinicalAIProviderRoutingDocument =
  (): ClinicalAIProviderRoutingDocument => ({
    actions: Object.fromEntries(
      CLINICAL_AI_ACTIONS.map(action => [
        action.id,
        {
          enabled: true,
          provider: action.id === 'clinical_attachment_name_suggestion' ? 'deepseek' : null,
          model: null,
        },
      ])
    ) as ClinicalAIProviderRoutingDocument['actions'],
    updatedAt: null,
    updatedByEmail: null,
  });
