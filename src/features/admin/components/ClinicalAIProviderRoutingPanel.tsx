import React from 'react';
import { Bot, PlayCircle, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useNotification } from '@/context/UIContext';
import { useClinicalAIProviderRouting } from '@/features/admin/hooks/useClinicalAIProviderRouting';
import {
  CLINICAL_AI_ACTIONS,
  CLINICAL_AI_PROVIDER_LABELS,
  type ClinicalAIActionId,
  type ClinicalAIProvider,
  type ClinicalAIProviderRoutingDocument,
} from '@/shared/ai/clinicalAIProviderRouting';
import {
  getClinicalAIProviderStatuses,
  testClinicalAIProvider,
  type ClinicalAIProviderStatus,
} from '@/services/admin/clinicalAIProviderStatusService';

const DEFAULT_PROVIDER_VALUE = '__netlify_default__';

const buildDraftWithRule = (
  routing: ClinicalAIProviderRoutingDocument,
  actionId: ClinicalAIActionId,
  patch: Partial<NonNullable<ClinicalAIProviderRoutingDocument['actions'][ClinicalAIActionId]>>
): ClinicalAIProviderRoutingDocument => ({
  ...routing,
  actions: {
    ...routing.actions,
    [actionId]: {
      enabled: routing.actions[actionId]?.enabled ?? true,
      provider: routing.actions[actionId]?.provider ?? null,
      model: routing.actions[actionId]?.model ?? null,
      ...patch,
    },
  },
});

export const ClinicalAIProviderRoutingPanel: React.FC = () => {
  const auth = useAuth();
  const { notify } = useNotification();
  const { routing, setRouting, loading, saving, error, save } = useClinicalAIProviderRouting(
    auth.currentUser?.email
  );
  const [statuses, setStatuses] = React.useState<ClinicalAIProviderStatus[]>([]);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = React.useState(true);
  const [testingActionId, setTestingActionId] = React.useState<ClinicalAIActionId | null>(null);

  const loadStatuses = React.useCallback(async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      setStatuses(await getClinicalAIProviderStatuses());
    } catch (loadError) {
      setStatusError(
        loadError instanceof Error
          ? loadError.message
          : 'No se pudo cargar el estado de proveedores IA.'
      );
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  React.useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  const configuredProviders = React.useMemo(
    () => statuses.filter(status => status.configured).map(status => status.provider),
    [statuses]
  );

  const statusByProvider = React.useMemo(
    () => new Map(statuses.map(status => [status.provider, status])),
    [statuses]
  );

  const handleProviderChange = (actionId: ClinicalAIActionId, value: string) => {
    setRouting(
      buildDraftWithRule(routing, actionId, {
        provider: value === DEFAULT_PROVIDER_VALUE || !value ? null : (value as ClinicalAIProvider),
      })
    );
  };

  const handleModelChange = (actionId: ClinicalAIActionId, value: string) => {
    setRouting(buildDraftWithRule(routing, actionId, { model: value.trim() || null }));
  };

  const handleEnabledChange = (actionId: ClinicalAIActionId, enabled: boolean) => {
    setRouting(buildDraftWithRule(routing, actionId, { enabled }));
  };

  const handleSave = async () => {
    await save(routing);
    notify({
      type: 'success',
      title: 'Configuración IA guardada',
      message: 'Las próximas llamadas usarán el proveedor definido por acción.',
    });
  };

  const handleTestProvider = async (actionId: ClinicalAIActionId) => {
    const action = CLINICAL_AI_ACTIONS.find(candidate => candidate.id === actionId);
    const rule = routing.actions[actionId];
    const provider = rule?.provider ?? null;

    if (!provider) {
      notify({
        type: 'warning',
        title: 'Selecciona un proveedor',
        message: 'La prueba requiere un proveedor explícito para esta acción.',
      });
      return;
    }

    setTestingActionId(actionId);
    try {
      const result = await testClinicalAIProvider({
        action: actionId,
        provider,
        model: rule?.model ?? null,
      });

      if (!result.ok) {
        notify({
          type: 'error',
          title: 'Proveedor IA no disponible',
          message: result.message,
        });
        return;
      }

      notify({
        type: 'success',
        title: 'Proveedor IA operativo',
        message: `${action?.label ?? 'Acción IA'} responde con ${
          result.model ?? CLINICAL_AI_PROVIDER_LABELS[provider]
        }.`,
      });
    } catch (testError) {
      notify({
        type: 'error',
        title: 'Prueba IA fallida',
        message:
          testError instanceof Error ? testError.message : 'No se pudo probar el proveedor IA.',
      });
    } finally {
      setTestingActionId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Bot size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Configuración IA por acción</h2>
            <p className="text-xs text-slate-500">
              Selección ADMIN. Las llaves permanecen en Netlify y nunca se guardan en el navegador.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadStatuses}
            disabled={loadingStatus}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loadingStatus ? 'animate-spin' : ''} />
            Proveedores
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || loadingStatus || Boolean(statusError)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Save size={14} />
            Guardar
          </button>
        </div>
      </div>

      {(error || statusError) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || statusError}
        </div>
      )}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={14} />
          DeepSeek queda disponible sólo si Netlify tiene `DEEPSEEK_API_KEY`.
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(220px,1.4fr)_minmax(170px,0.8fr)_minmax(150px,0.8fr)_150px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase text-slate-500 lg:grid">
          <span>Acción</span>
          <span>Proveedor</span>
          <span>Modelo</span>
          <span>Estado</span>
        </div>
        {CLINICAL_AI_ACTIONS.map(action => {
          const rule = routing.actions[action.id];
          const selectedProvider = rule?.provider ?? null;
          const selectedProviderIsConfigured =
            !selectedProvider || configuredProviders.includes(selectedProvider);
          const providerOptions = [
            ...new Set([
              ...configuredProviders,
              ...(selectedProvider && !configuredProviders.includes(selectedProvider)
                ? [selectedProvider]
                : []),
            ]),
          ];

          return (
            <div
              key={action.id}
              className="grid grid-cols-1 gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(220px,1.4fr)_minmax(170px,0.8fr)_minmax(150px,0.8fr)_150px]"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">{action.label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{action.description}</div>
              </div>

              <select
                value={selectedProvider ?? DEFAULT_PROVIDER_VALUE}
                disabled={loading || loadingStatus || Boolean(statusError)}
                onChange={event => handleProviderChange(action.id, event.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 disabled:bg-slate-50"
              >
                <option value={DEFAULT_PROVIDER_VALUE}>Predeterminado Netlify</option>
                {providerOptions.map(provider => (
                  <option
                    key={provider}
                    value={provider}
                    disabled={!configuredProviders.includes(provider)}
                  >
                    {CLINICAL_AI_PROVIDER_LABELS[provider]}
                    {configuredProviders.includes(provider) ? '' : ' (sin llave)'}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={rule?.model ?? ''}
                disabled={loading || !selectedProvider}
                onChange={event => handleModelChange(action.id, event.target.value)}
                placeholder={
                  selectedProvider
                    ? statusByProvider.get(selectedProvider)?.model || 'Modelo Netlify'
                    : 'Modelo Netlify'
                }
                className="h-10 rounded-lg border border-slate-200 px-3 text-sm disabled:bg-slate-50"
              />

              <div className="flex min-h-10 flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={rule?.enabled ?? true}
                    disabled={loading || !selectedProviderIsConfigured}
                    onChange={event => handleEnabledChange(action.id, event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Activa
                </label>
                <button
                  type="button"
                  onClick={() => void handleTestProvider(action.id)}
                  disabled={
                    loading ||
                    loadingStatus ||
                    testingActionId === action.id ||
                    !selectedProvider ||
                    !selectedProviderIsConfigured
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <PlayCircle size={13} />
                  {testingActionId === action.id ? 'Probando' : 'Probar'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
