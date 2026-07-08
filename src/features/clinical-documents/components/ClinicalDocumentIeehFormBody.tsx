import React from 'react';
import { Loader2, Printer, Search, Sparkles, UserRound, X } from 'lucide-react';

import type {
  ClinicalDocumentIeehDraft,
  IeehDischargeConditionCode,
} from '@/features/clinical-documents/domain/entities';
import { IEEH_DISCHARGE_CONDITIONS } from '@/features/clinical-documents/controllers/clinicalDocumentIeehController';
import { FonasaSearchInput } from '@/features/clinical-documents/components/FonasaSearchInput';
import type { TerminologyConcept } from '@/services/terminology/terminologyService';

interface ClinicalDocumentIeehFormBodyProps {
  localDraft: ClinicalDocumentIeehDraft;
  searchQuery: string;
  searchResults: TerminologyConcept[];
  isSearching: boolean;
  isAiSearching: boolean;
  hasSelectedDiagnosis: boolean;
  shouldShowDiagnosisResults: boolean;
  canRunAiSearch: boolean;
  shouldShowInterventionSelector: boolean;
  shouldShowProcedureSelector: boolean;
  canPrintIeeh: boolean;
  printButtonTitle: string;
  isPrinting: boolean;
  cie10ContainerRef: React.RefObject<HTMLDivElement | null>;
  onSearchChange: (query: string) => void;
  onOpenSearchResults: () => void;
  onAiSearch: () => void;
  onSelectDiagnosis: (concept: TerminologyConcept) => void;
  onClearDiagnosis: () => void;
  onPatchField: <K extends keyof ClinicalDocumentIeehDraft>(
    field: K,
    value: ClinicalDocumentIeehDraft[K]
  ) => void;
  onCommitDraft: (draft: ClinicalDocumentIeehDraft) => void;
  onPrintIeeh: () => void;
  onRemovePanel: () => void;
}

export const ClinicalDocumentIeehFormBody: React.FC<ClinicalDocumentIeehFormBodyProps> = ({
  localDraft,
  searchQuery,
  searchResults,
  isSearching,
  isAiSearching,
  hasSelectedDiagnosis,
  shouldShowDiagnosisResults,
  canRunAiSearch,
  shouldShowInterventionSelector,
  shouldShowProcedureSelector,
  canPrintIeeh,
  printButtonTitle,
  isPrinting,
  cie10ContainerRef,
  onSearchChange,
  onOpenSearchResults,
  onAiSearch,
  onSelectDiagnosis,
  onClearDiagnosis,
  onPatchField,
  onCommitDraft,
  onPrintIeeh,
  onRemovePanel,
}) => {
  const [showDoctorConfig, setShowDoctorConfig] = React.useState(
    Boolean(
      localDraft.tratanteNombreCompleto?.trim() ||
      localDraft.tratanteEspecialidad?.trim() ||
      localDraft.tratanteRut?.trim()
    )
  );

  return (
    <div className="space-y-3 px-3 pb-3">
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
          Diagnóstico principal (CIE-10)
        </label>

        {hasSelectedDiagnosis ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5">
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">
              {localDraft.cie10Code}
            </span>
            <span className="flex-1 truncate text-xs text-slate-700">
              {localDraft.cie10Description}
            </span>
            <button
              type="button"
              onClick={onClearDiagnosis}
              className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
              aria-label="Cambiar diagnóstico CIE-10"
              title="Cambiar diagnóstico"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="relative" ref={cie10ContainerRef}>
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <Search
                  size={13}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => onSearchChange(e.target.value)}
                  onFocus={onOpenSearchResults}
                  placeholder="Buscar diagnóstico CIE-10..."
                  className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                />
                {isSearching && (
                  <Loader2
                    size={13}
                    className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={onAiSearch}
                disabled={!canRunAiSearch}
                className="flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-[10px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-40"
                aria-label="Buscar diagnóstico con inteligencia artificial"
                title="Buscar con IA"
              >
                {isAiSearching ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                IA
              </button>
            </div>

            {shouldShowDiagnosisResults && (
              <div className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {searchResults.map(concept => (
                  <button
                    key={concept.code}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => onSelectDiagnosis(concept)}
                    className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-emerald-50"
                  >
                    <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-mono font-bold text-slate-600">
                      {concept.code}
                    </span>
                    <span className="text-xs leading-snug text-slate-700">
                      {concept.display}
                      {concept.fromAI && (
                        <span className="ml-1 text-[9px] text-violet-500">⚡ IA</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
          Condición al egreso
        </label>
        <select
          value={localDraft.condicionEgreso}
          onChange={e =>
            onPatchField('condicionEgreso', e.target.value as IeehDischargeConditionCode)
          }
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
        >
          {IEEH_DISCHARGE_CONDITIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.value}. {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
          Intervención quirúrgica
        </label>
        <div className="flex items-center gap-4 text-xs text-slate-700">
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              checked={localDraft.intervencionQuirurgica === '1'}
              onChange={() => onPatchField('intervencionQuirurgica', '1')}
              className="h-3 w-3 text-emerald-600"
            />
            Sí
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              checked={localDraft.intervencionQuirurgica === '2'}
              onChange={() => onPatchField('intervencionQuirurgica', '2')}
              className="h-3 w-3 text-emerald-600"
            />
            No
          </label>
        </div>
        {shouldShowInterventionSelector && (
          <div className="mt-1">
            <FonasaSearchInput
              catalog="interventions"
              code={localDraft.intervencionCodigo ?? ''}
              description={localDraft.intervencionQuirurgDescrip ?? ''}
              placeholder="Buscar intervención quirúrgica FONASA..."
              onSelect={entry =>
                onCommitDraft({
                  ...localDraft,
                  intervencionCodigo: entry.code,
                  intervencionQuirurgDescrip: entry.description,
                })
              }
              onManualChange={text =>
                onCommitDraft({
                  ...localDraft,
                  intervencionCodigo: undefined,
                  intervencionQuirurgDescrip: text,
                })
              }
              onClear={() =>
                onCommitDraft({
                  ...localDraft,
                  intervencionCodigo: undefined,
                  intervencionQuirurgDescrip: undefined,
                })
              }
            />
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
          Procedimiento
        </label>
        <div className="flex items-center gap-4 text-xs text-slate-700">
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              checked={localDraft.procedimiento === '1'}
              onChange={() => onPatchField('procedimiento', '1')}
              className="h-3 w-3 text-emerald-600"
            />
            Sí
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              checked={localDraft.procedimiento === '2'}
              onChange={() => onPatchField('procedimiento', '2')}
              className="h-3 w-3 text-emerald-600"
            />
            No
          </label>
        </div>
        {shouldShowProcedureSelector && (
          <div className="mt-1">
            <FonasaSearchInput
              catalog="procedures"
              code={localDraft.procedimientoCodigo ?? ''}
              description={localDraft.procedimientoDescrip ?? ''}
              placeholder="Buscar procedimiento FONASA..."
              onSelect={entry =>
                onCommitDraft({
                  ...localDraft,
                  procedimientoCodigo: entry.code,
                  procedimientoDescrip: entry.description,
                })
              }
              onManualChange={text =>
                onCommitDraft({
                  ...localDraft,
                  procedimientoCodigo: undefined,
                  procedimientoDescrip: text,
                })
              }
              onClear={() =>
                onCommitDraft({
                  ...localDraft,
                  procedimientoCodigo: undefined,
                  procedimientoDescrip: undefined,
                })
              }
            />
          </div>
        )}
      </div>

      <div className="rounded-md border border-emerald-100 bg-white/70 p-2">
        <button
          type="button"
          onClick={() => setShowDoctorConfig(prev => !prev)}
          className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-emerald-700 hover:text-emerald-900"
          aria-expanded={showDoctorConfig}
        >
          <UserRound size={13} />
          Configurar médico IEEH
        </button>

        {showDoctorConfig && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="ieeh-tratante-nombre"
                className="mb-1 block text-[10px] font-semibold uppercase text-slate-500"
              >
                Nombre médico tratante
              </label>
              <input
                id="ieeh-tratante-nombre"
                type="text"
                value={localDraft.tratanteNombreCompleto ?? ''}
                onChange={e => onPatchField('tratanteNombreCompleto', e.target.value)}
                placeholder="Nombre Apellido 1 Apellido 2"
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="ieeh-tratante-especialidad"
                className="mb-1 block text-[10px] font-semibold uppercase text-slate-500"
              >
                Especialidad médico tratante
              </label>
              <input
                id="ieeh-tratante-especialidad"
                type="text"
                value={localDraft.tratanteEspecialidad ?? ''}
                onChange={e => onPatchField('tratanteEspecialidad', e.target.value)}
                placeholder="Especialidad"
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="ieeh-tratante-rut"
                className="mb-1 block text-[10px] font-semibold uppercase text-slate-500"
              >
                RUT médico tratante
              </label>
              <input
                id="ieeh-tratante-rut"
                type="text"
                value={localDraft.tratanteRut ?? ''}
                onChange={e => onPatchField('tratanteRut', e.target.value)}
                placeholder="12.345.678-9"
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-emerald-100 pt-2">
        <button
          type="button"
          onClick={onPrintIeeh}
          disabled={!canPrintIeeh}
          className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          title={printButtonTitle}
        >
          {isPrinting ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
          Imprimir IEEH
        </button>
        <button
          type="button"
          onClick={onRemovePanel}
          className="text-[10px] text-red-500 transition-colors hover:text-red-700"
        >
          Eliminar egreso estadístico
        </button>
      </div>
    </div>
  );
};
