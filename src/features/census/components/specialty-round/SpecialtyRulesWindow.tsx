import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { SpecialtyRulesHistoryPanel } from './SpecialtyRulesHistoryPanel';
import { BaseModal } from '@/components/shared/BaseModal';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { normalizeDiagnosisCode } from './specialtyRulesHistoryModel';
import { useSpecialtyRulesEditor } from './useSpecialtyRulesEditor';
import { SpecialtyRulesTabs, type SpecialtyRulesTab } from './SpecialtyRulesTabs';

export const SpecialtyRulesWindow = ({
  date = getClinicalCalendarDateISO(),
  disabled = false,
  onClose,
}: {
  date?: string;
  disabled?: boolean;
  onClose: () => void;
}) => {
  const [tab, setTab] = useState<SpecialtyRulesTab>('rules');
  const editor = useSpecialtyRulesEditor(date);
  const {
    setup,
    rules,
    autoEnabled,
    setAutoEnabled,
    code,
    setCode,
    specialty,
    setSpecialty,
    busy,
    message,
    error,
    selectedSpecialties,
    setSelectedSpecialties,
    currentBeds,
    currentDate,
    currentError,
    retryCurrent,
    dirty,
    memoryPendingDeploy,
    recordedLabels,
    currentDiagnoses,
    normalizedCode,
    codeLabel,
    suggestions,
    isValidCode,
    addRule,
    changeRule,
    stageAssociation,
    save,
    setRules,
    today,
  } = editor;
  return (
    <BaseModal
      isOpen
      onClose={() => {
        if (!busy) onClose();
      }}
      closeOnBackdrop={false}
      size="3xl"
      bodyClassName="flex min-h-0 flex-col !overflow-hidden p-4 sm:p-5"
      title="Reglas automáticas de especialidad"
      icon={<ListChecks size={20} className="text-teal-700" aria-hidden="true" />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm text-slate-700">
        <fieldset disabled={disabled} className="contents">
          <p className="text-xs text-slate-500">
            Sólo episodios pendientes; se conservan las decisiones confirmadas.
          </p>
          {memoryPendingDeploy && (
            <p role="status" className="rounded-lg bg-amber-50 p-2 text-amber-900">
              El servidor aún no entrega asociaciones recordadas. Se conservarán intactas al guardar
              reglas; la edición de memoria estará disponible tras actualizar Firebase.
            </p>
          )}
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={autoEnabled}
              disabled={busy || !setup}
              onChange={event => setAutoEnabled(event.target.checked)}
            />
            <span>
              <strong>Activar asociación automática</strong>
              <span className="block text-xs">
                Actual y futuros censos, hasta desactivar o eliminar las reglas.
              </span>
            </span>
          </label>
          <SpecialtyRulesTabs active={tab} onChange={setTab} />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div
              role="tabpanel"
              id="specialty-panel-rules"
              aria-labelledby="specialty-tab-rules"
              hidden={tab !== 'rules'}
              tabIndex={0}
            >
              <div className="space-y-2" aria-label="Reglas configuradas">
                {rules.map(rule => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2"
                  >
                    <strong className="w-16">{rule.cie10Code}</strong>
                    <span
                      className="min-w-0 flex-1 truncate text-xs"
                      title={setup?.labels[rule.cie10Code] || recordedLabels[rule.cie10Code]}
                    >
                      {setup?.labels[rule.cie10Code] ||
                        recordedLabels[rule.cie10Code] ||
                        'Descripción no disponible'}
                    </span>
                    <select
                      aria-label={`Regla para ${rule.cie10Code}`}
                      value={rule.kind === 'review' ? 'review' : rule.specialty}
                      disabled={busy}
                      onChange={event => changeRule(rule.id, event.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    >
                      {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value="review">Revisión manual</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setRules(current => current.filter(item => item.id !== rule.id))
                      }
                      className="rounded px-2 py-1 text-red-700 hover:bg-red-50"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                {!rules.length && (
                  <p className="rounded-lg bg-slate-50 p-3 text-slate-500">
                    Aún no hay asociaciones automáticas.
                  </p>
                )}
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <p className="mb-2 font-semibold">Añadir diagnóstico</p>
                <div className="flex flex-wrap gap-2">
                  <div className="min-w-44 flex-1">
                    <input
                      aria-label="Código CIE-10"
                      value={code}
                      disabled={busy}
                      onChange={event => setCode(event.target.value)}
                      placeholder="Ej.: J18.9"
                      className="w-full rounded border border-slate-300 px-2 py-1.5"
                    />
                    {code && (
                      <span className="mt-1 block text-xs text-slate-600">
                        {codeLabel ||
                          (isValidCode
                            ? 'Código válido sin descripción en el catálogo; la regla usará este código exacto.'
                            : 'Introduce un código CIE-10 válido.')}
                      </span>
                    )}
                    {suggestions.length > 0 && (
                      <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-200 bg-white">
                        {suggestions.map(([suggestedCode, label]) => (
                          <button
                            key={suggestedCode}
                            type="button"
                            onClick={() => setCode(suggestedCode)}
                            className="block w-full px-2 py-1 text-left text-xs hover:bg-teal-50"
                          >
                            <strong>{suggestedCode}</strong> · {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <select
                    aria-label="Especialidad de la nueva regla"
                    value={specialty}
                    disabled={busy}
                    onChange={event => setSpecialty(event.target.value)}
                    className="h-9 rounded border border-slate-300 bg-white px-2"
                  >
                    <option value="">Elegir especialidad</option>
                    {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value="review">Revisión manual</option>
                  </select>
                  <button
                    type="button"
                    disabled={
                      !isValidCode ||
                      !specialty ||
                      busy ||
                      rules.some(rule => rule.cie10Code === normalizedCode)
                    }
                    onClick={addRule}
                    className="h-9 rounded bg-teal-700 px-3 font-semibold text-white disabled:opacity-50"
                  >
                    Añadir
                  </button>
                </div>
              </div>
            </div>
            <div
              role="tabpanel"
              id="specialty-panel-current"
              aria-labelledby="specialty-tab-current"
              hidden={tab !== 'current'}
              tabIndex={0}
            >
              <section className="space-y-2" aria-label="Diagnósticos de pacientes hospitalizados">
                <h3 className="sr-only">Diagnósticos de pacientes hospitalizados</h3>
                <p className="text-xs text-slate-500">
                  Censo {currentDate === today ? 'vigente' : 'seleccionado'} · {currentDate}
                </p>
                {currentError && (
                  <p role="status" className="text-xs text-amber-800">
                    No se pudo leer el censo vigente. Se muestra el seleccionado.{' '}
                    <button type="button" onClick={retryCurrent} className="underline">
                      Reintentar
                    </button>
                  </p>
                )}
                {!currentBeds && <p className="text-slate-500">Leyendo censo vigente…</p>}
                {currentBeds && !currentDiagnoses.length && (
                  <p className="text-slate-500">
                    No hay diagnósticos CIE-10 en pacientes hospitalizados.
                  </p>
                )}
                <div className="space-y-2">
                  {currentDiagnoses.map(diagnosis => {
                    const existing = rules.find(
                      rule => normalizeDiagnosisCode(rule.cie10Code) === diagnosis.code
                    );
                    const selected =
                      selectedSpecialties[diagnosis.code] ??
                      existing?.specialty ??
                      diagnosis.suggestedSpecialty;
                    return (
                      <div
                        key={diagnosis.code}
                        className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2"
                      >
                        <strong className="w-16">{diagnosis.code}</strong>
                        <span className="min-w-32 flex-1 text-xs">
                          {setup?.labels[diagnosis.code] ||
                            diagnosis.description ||
                            'Descripción no disponible'}
                          <span className="block text-slate-500">
                            {diagnosis.patients}{' '}
                            {diagnosis.patients === 1 ? 'paciente' : 'pacientes'} ·{' '}
                            {existing ? 'regla existente' : 'sin regla'}
                          </span>
                        </span>
                        <div className="flex w-full gap-2 sm:w-auto">
                          <select
                            aria-label={`Especialidad para ${diagnosis.code}`}
                            value={selected}
                            disabled={busy || !setup}
                            onChange={event =>
                              setSelectedSpecialties(current => ({
                                ...current,
                                [diagnosis.code]: event.target.value,
                              }))
                            }
                            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5"
                          >
                            <option value="">Elegir especialidad</option>
                            {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={
                              !selected || busy || !setup || (!existing && rules.length >= 128)
                            }
                            onClick={() => stageAssociation(diagnosis.code, selected)}
                            className="shrink-0 rounded border border-teal-300 px-2 py-1.5 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50"
                          >
                            {existing ? 'Actualizar regla' : 'Añadir regla'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
            <div
              role="tabpanel"
              id="specialty-panel-history"
              aria-labelledby="specialty-tab-history"
              hidden={tab !== 'history'}
              tabIndex={0}
            >
              <SpecialtyRulesHistoryPanel editor={editor} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-teal-800">
              {message}
            </p>
          )}
        </fieldset>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded border border-slate-300 px-4 py-2"
          >
            Cerrar
          </button>
          {setup?.policy.aiMode === 'off' && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void save(true)}
              className="rounded border border-teal-700 px-4 py-2 font-semibold text-teal-800 disabled:opacity-50"
            >
              Configurar piloto Jev
            </button>
          )}
          <button
            type="button"
            disabled={
              disabled || !dirty || busy || (memoryPendingDeploy && setup?.policy.memoryEnabled)
            }
            onClick={() => void save()}
            className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Publicando…' : 'Guardar reglas'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
