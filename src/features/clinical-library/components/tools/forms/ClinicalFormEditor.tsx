import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileText, Printer, RefreshCw, Save, Settings2, Upload } from 'lucide-react';
import {
  CLINICAL_VARIABLE_CATALOG,
  getClinicalForm,
  PATIENT_CLINICAL_FORMS,
} from '../../../domain/forms/clinicalFormCatalog';
import { exportClinicalFormDraft } from '../../../domain/forms/clinicalFormDraft';
import {
  loadClinicalFormPreferences,
  saveClinicalFormPreferences,
  type ClinicalFormPreferences,
} from '../../../domain/forms/clinicalFormPreferences';
import type {
  ClinicalFormId,
  ClinicalFormPatientOption,
} from '../../../domain/forms/clinicalFormTypes';
import { ToolFrame } from '../ToolFrame';
import { ToolJsonFileInput } from '../ToolJsonFileInput';
import { ToolReplaceConfirmDialog } from '../ToolReplaceConfirmDialog';
import { downloadToolJsonFile } from '../toolDraftFiles';
import { ClinicalFormFields } from './ClinicalFormFields';
import { ClinicalFormSettings } from './ClinicalFormSettings';
import { useClinicalFormDraft } from './useClinicalFormDraft';
import {
  useClinicalFormPdf,
  type ClinicalFormPdfGenerator,
  type ClinicalFormDocxGenerator,
} from './useClinicalFormPdf';
import { useClinicalFormAnnexes } from './useClinicalFormAnnexes';
import { ClinicalFormAnnexPanel } from './ClinicalFormAnnexPanel';
import { mapBradenRecordsToClinicalFormValues } from '../../../domain/forms/clinicalFormBradenHistory';
import { SIC_FORM_ID } from '../../../domain/forms/sicFormData';
import { normalizeDicomPatientId } from '@/domain/radiology/dicomTypes';
import './clinicalForms.css';

export interface ClinicalFormEditorProps {
  formId: ClinicalFormId;
  onFormChange: (id: ClinicalFormId) => void;
  patients: ReadonlyArray<ClinicalFormPatientOption>;
  onBack: () => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onGeneratePdf: ClinicalFormPdfGenerator;
  onGenerateDocx?: ClinicalFormDocxGenerator;
  exportContext?: string;
  exportFields?: React.ReactNode;
  exportBlocked?: boolean;
  exportDirty?: boolean;
}

export const ClinicalFormEditor: React.FC<ClinicalFormEditorProps> = ({
  formId,
  onFormChange,
  patients,
  onBack,
  onClose,
  onDirtyChange,
  onGeneratePdf,
  onGenerateDocx,
  exportContext,
  exportFields,
  exportBlocked = false,
  exportDirty = false,
}) => {
  const form = getClinicalForm(formId);
  const draft = useClinicalFormDraft(formId, patients, onFormChange);
  const patientId = String(draft.values.paciente_rut || '');
  const annexContext = JSON.stringify([
    draft.source?.key,
    draft.source?.context.episodeId,
    draft.source?.context.identity,
    draft.sourceMissing,
    normalizeDicomPatientId(patientId),
  ]);
  const annexes = useClinicalFormAnnexes(annexContext, patientId);
  useEffect(() => {
    onDirtyChange?.(draft.dirty || annexes.images.length > 0 || exportDirty);
  }, [draft.dirty, annexes.images.length, exportDirty, onDirtyChange]);
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const [loadingBradenEpisode, setLoadingBradenEpisode] = useState<string | null>(null);
  const bradenHistoryRequest = useRef(0);
  const [overrides, setOverrides] = useState<Record<string, ClinicalFormPreferences>>({});
  const loadedPreferences = useMemo(() => loadClinicalFormPreferences(form), [form]);
  const preferences = overrides[formId] ?? loadedPreferences;
  const inputRef = useRef<HTMLInputElement>(null);
  const pdf = useClinicalFormPdf(
    form,
    draft.values,
    preferences.hidden,
    JSON.stringify([
      exportContext,
      draft.source?.key,
      draft.sourceMissing,
      draft.sourceChanged,
      Boolean(draft.replacement),
    ]),
    onGeneratePdf,
    draft.setNotice,
    onGenerateDocx,
    annexes.images
  );
  const blocked =
    exportBlocked || Boolean(draft.replacement) || draft.sourceMissing || draft.sourceChanged;
  const fieldSearchLabel = form.internalOnly ? 'Buscar campo' : 'Buscar campo o examen';
  const bradenEpisodeId =
    formId === 'pauta-braden-lpp' && draft.source?.context.episodeId
      ? draft.source.context.episodeId
      : '';
  const loadingBradenHistory = Boolean(bradenEpisodeId && loadingBradenEpisode === bradenEpisodeId);
  useEffect(() => {
    bradenHistoryRequest.current += 1;
  }, [bradenEpisodeId]);
  const loadSavedBradenHistory = async () => {
    if (!bradenEpisodeId || loadingBradenHistory) return;
    const seq = ++bradenHistoryRequest.current;
    setLoadingBradenEpisode(bradenEpisodeId);
    draft.setNotice('Consultando evaluaciones Braden guardadas en HHR…');
    try {
      const { clinicalChecklist } = await import('@/services/clinical-checklists/checklistService');
      const result = await clinicalChecklist({
        action: 'history',
        episode: bradenEpisodeId,
        scaleGroup: 'braden',
      });
      if (bradenHistoryRequest.current !== seq) return;
      if (!result.records.length) {
        draft.setNotice('No hay evaluaciones Braden guardadas en HHR para este episodio.');
        return;
      }
      const proposed = mapBradenRecordsToClinicalFormValues(result.records);
      draft.mergeValues(
        proposed,
        `Se cargaron ${result.records.length} ${result.records.length === 1 ? 'evaluación Braden' : 'evaluaciones Braden'} desde HHR en las filas vacías.`
      );
    } catch (error) {
      if (bradenHistoryRequest.current === seq) {
        draft.setNotice(
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar las evaluaciones Braden guardadas en HHR.'
        );
      }
    } finally {
      if (bradenHistoryRequest.current === seq) setLoadingBradenEpisode(null);
    }
  };
  const changePreferences = (next: ClinicalFormPreferences) => {
    setOverrides(current => ({ ...current, [formId]: next }));
    draft.setNotice(
      saveClinicalFormPreferences(form, next)
        ? ''
        : 'Preferencias aplicadas. El navegador no permitió guardarlas; puedes exportarlas.'
    );
  };
  return (
    <ToolFrame
      title={form.title}
      icon={<FileText size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      testId="library-tool-clinical-form"
    >
      <div className="clinical-form-editor">
        <div className="clinical-form-toolbar">
          {form.internalOnly ? (
            <p className="clinical-form-source">Uso interno del personal · Ingreso manual</p>
          ) : (
            <>
              <label className="clinical-form-source">
                Formulario
                <select
                  aria-label="Formulario clínico"
                  value={formId}
                  disabled={pdf.busy || Boolean(draft.replacement)}
                  className="clinical-form-input"
                  onChange={event => {
                    draft.changeForm(event.target.value as ClinicalFormId);
                    setQuery('');
                  }}
                >
                  {PATIENT_CLINICAL_FORMS.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="clinical-form-source">
                Paciente
                <select
                  aria-label="Origen de los datos"
                  value={draft.source?.key ?? ''}
                  disabled={pdf.busy || Boolean(draft.replacement)}
                  className="clinical-form-input"
                  onChange={event => draft.selectPatient(event.target.value)}
                >
                  <option value="">Ingreso manual</option>
                  {patients.map(patient => (
                    <option key={patient.key} value={patient.key}>
                      {patient.label}
                    </option>
                  ))}
                  {draft.sourceMissing && draft.source && (
                    <option value={draft.source.key}>
                      Paciente cargado · vínculo pendiente de revisión
                    </option>
                  )}
                </select>
              </label>
            </>
          )}
          <div className="clinical-form-actions">
            {draft.source && (
              <button
                type="button"
                aria-label="Completar campos vacíos desde el censo"
                title="Completar vacíos desde el censo"
                className="clinical-form-icon"
                disabled={pdf.busy || draft.sourceMissing || Boolean(draft.replacement)}
                onClick={draft.refresh}
              >
                <RefreshCw size={16} />
              </button>
            )}
            <button
              type="button"
              aria-label="Guardar borrador"
              title="Guardar borrador"
              className="clinical-form-icon"
              disabled={pdf.busy}
              onClick={() =>
                downloadToolJsonFile(
                  exportClinicalFormDraft(formId, draft.values),
                  `${formId}-borrador.json`
                )
              }
            >
              <Save size={16} />
            </button>
            <button
              type="button"
              aria-label="Importar borrador"
              title="Importar borrador"
              className="clinical-form-icon"
              disabled={pdf.busy || Boolean(draft.replacement)}
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={16} />
            </button>
            <button
              type="button"
              aria-label="Variables y preferencias"
              title="Variables y preferencias"
              aria-expanded={settings}
              aria-controls="clinical-form-configuration"
              className="clinical-form-icon"
              disabled={pdf.busy || Boolean(draft.replacement)}
              onClick={() => setSettings(!settings)}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
        <ToolJsonFileInput
          inputRef={inputRef}
          ariaLabel="Archivo de borrador del formulario"
          onFileSelected={file => {
            void draft.importFile(file);
          }}
        />
        {draft.replacement && (
          <ToolReplaceConfirmDialog
            idPrefix="clinical-form"
            title="Reemplazar los datos actuales"
            description={
              form.internalOnly
                ? 'El borrador que importes reemplazará los datos actuales.'
                : 'Se vaciarán los datos anteriores antes de cargar el nuevo paciente o borrador.'
            }
            confirmLabel="Reemplazar datos"
            onKeep={draft.cancelReplacement}
            onConfirm={draft.confirmReplacement}
            containerClassName="clinical-form-review"
            titleClassName="font-bold"
            actionsClassName="clinical-form-actions"
          />
        )}
        {draft.sourceMissing && (
          <div role="alert" className="clinical-form-review">
            La cama, el episodio o la identidad cambiaron. Selecciona al paciente actual o{' '}
            <button type="button" onClick={draft.detachSource}>
              continuar como borrador manual
            </button>
            .
          </div>
        )}
        {draft.sourceChanged && (
          <div role="alert" className="clinical-form-review">
            Hay cambios en los datos de origen.
            <dl className="clinical-form-source-changes">
              {draft.sourceChanges.map(change => (
                <div key={change.id}>
                  <dt>
                    {CLINICAL_VARIABLE_CATALOG.variables.find(variable => variable.id === change.id)
                      ?.label ?? change.id}
                  </dt>
                  <dd>
                    Borrador: {String(change.draft ?? 'Sin dato')}
                    <br />
                    Censo: {String(change.current ?? 'Sin dato')}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="clinical-form-actions">
              <button type="button" onClick={draft.refresh}>
                Completar sólo vacíos
              </button>
              <button type="button" onClick={draft.keepReviewedSource}>
                Revisado: conservar mis datos
              </button>
            </div>
          </div>
        )}
        <fieldset
          disabled={pdf.busy || Boolean(draft.replacement)}
          className="clinical-form-workspace"
        >
          {settings ? (
            <div id="clinical-form-configuration">
              <ClinicalFormSettings
                key={formId}
                form={form}
                preferences={preferences}
                onChange={changePreferences}
                onNotice={draft.setNotice}
              />
            </div>
          ) : (
            <>
              {formId !== SIC_FORM_ID && (
                <input
                  type="search"
                  aria-label={fieldSearchLabel}
                  placeholder={`${fieldSearchLabel}…`}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  className="clinical-form-input clinical-form-search"
                />
              )}
              <ClinicalFormFields
                form={form}
                values={draft.values}
                hidden={preferences.hidden}
                query={query}
                onChange={draft.change}
              />
              {exportFields}
            </>
          )}
        </fieldset>
        {formId === 'informe-traslado-hospital-salvador' && (
          <ClinicalFormAnnexPanel
            key={annexContext}
            annexes={annexes}
            patientId={patientId}
            patientName={String(draft.values.paciente_nombre_completo || '')}
            disabled={pdf.busy || blocked}
          />
        )}
        <div className="clinical-form-export">
          <div className="clinical-form-actions">
            {bradenEpisodeId && (
              <button
                type="button"
                className="clinical-form-button"
                disabled={pdf.busy || blocked || loadingBradenHistory}
                onClick={() => void loadSavedBradenHistory()}
              >
                <RefreshCw size={15} className={loadingBradenHistory ? 'animate-spin' : ''} />
                {loadingBradenHistory ? 'Cargando Braden…' : 'Cargar Braden de HHR'}
              </button>
            )}
            <button
              type="button"
              className="clinical-form-button"
              disabled={pdf.busy || blocked}
              onClick={() => void pdf.prepare()}
            >
              <Eye size={15} />
              Vista previa
            </button>
            <button
              type="button"
              className="clinical-form-button"
              disabled={pdf.busy || blocked || !pdf.currentPdf}
              onClick={pdf.print}
            >
              <Printer size={15} />
              Imprimir
            </button>
            <button
              type="button"
              className="clinical-form-button clinical-form-primary"
              disabled={pdf.busy || blocked}
              onClick={() => void pdf.download()}
            >
              <Download size={15} />
              {pdf.busyFormat === 'pdf' ? 'Preparando…' : 'PDF imprimible'}
            </button>
            {form.supportsDocxExport && (
              <button
                type="button"
                className="clinical-form-button"
                disabled={pdf.busy || blocked}
                onClick={() => void pdf.downloadDocx()}
              >
                <FileText size={15} aria-hidden="true" />
                {pdf.busyFormat === 'docx' ? 'Preparando…' : 'Word (.docx)'}
              </button>
            )}
          </div>
          {draft.notice && (
            <p role="status" className="clinical-form-notice">
              {draft.notice}
            </p>
          )}
        </div>
        {pdf.currentPdf && !blocked && (
          <iframe
            className="clinical-form-preview"
            src={pdf.currentPdf.url}
            title={`${form.title} · PDF para imprimir`}
          />
        )}
      </div>
    </ToolFrame>
  );
};
