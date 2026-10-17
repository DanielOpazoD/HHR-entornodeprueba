import React, { useMemo, useRef, useState } from 'react';
import { Download, Eye, FileText, Printer, RefreshCw, Save, Settings2, Upload } from 'lucide-react';
import {
  CLINICAL_FORMS,
  CLINICAL_VARIABLE_CATALOG,
  getClinicalForm,
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
import { ClinicalFormFields } from './ClinicalFormFields';
import { ClinicalFormSettings, downloadClinicalFormJson } from './ClinicalFormSettings';
import { useClinicalFormDraft } from './useClinicalFormDraft';
import { useClinicalFormPdf, type ClinicalFormPdfGenerator } from './useClinicalFormPdf';
import './clinicalForms.css';

export interface ClinicalFormEditorProps {
  formId: ClinicalFormId;
  onFormChange: (id: ClinicalFormId) => void;
  patients: ReadonlyArray<ClinicalFormPatientOption>;
  onBack: () => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onGeneratePdf: ClinicalFormPdfGenerator;
  onGenerateDocx?: ClinicalFormPdfGenerator;
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
}) => {
  const form = getClinicalForm(formId);
  const draft = useClinicalFormDraft(formId, patients, onFormChange, onDirtyChange);
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, ClinicalFormPreferences>>({});
  const loadedPreferences = useMemo(() => loadClinicalFormPreferences(form), [form]);
  const preferences = overrides[formId] ?? loadedPreferences;
  const inputRef = useRef<HTMLInputElement>(null);
  const pdf = useClinicalFormPdf(
    form,
    draft.values,
    preferences.hidden,
    JSON.stringify([
      draft.source?.key,
      draft.sourceMissing,
      draft.sourceChanged,
      Boolean(draft.replacement),
    ]),
    onGeneratePdf,
    draft.setNotice,
    onGenerateDocx
  );
  const blocked = Boolean(draft.replacement) || draft.sourceMissing || draft.sourceChanged;
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
              {CLINICAL_FORMS.map(item => (
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
                downloadClinicalFormJson(
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
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Archivo de borrador del formulario"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void draft.importFile(file);
            event.target.value = '';
          }}
        />
        {draft.replacement && (
          <section
            role="alertdialog"
            aria-labelledby="clinical-form-replace-title"
            aria-describedby="clinical-form-replace-description"
            className="clinical-form-review"
          >
            <strong id="clinical-form-replace-title">Reemplazar los datos actuales</strong>
            <p id="clinical-form-replace-description">
              Se vaciarán los datos anteriores antes de cargar el nuevo paciente o borrador.
            </p>
            <div className="clinical-form-actions">
              <button type="button" autoFocus onClick={draft.cancelReplacement}>
                Conservar formulario
              </button>
              <button type="button" onClick={draft.confirmReplacement}>
                Reemplazar datos
              </button>
            </div>
          </section>
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
              <input
                type="search"
                aria-label="Buscar campo o examen"
                placeholder="Buscar campo o examen…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="clinical-form-input clinical-form-search"
              />
              <ClinicalFormFields
                form={form}
                values={draft.values}
                hidden={preferences.hidden}
                query={query}
                onChange={draft.change}
              />
            </>
          )}
        </fieldset>
        <div className="clinical-form-export">
          <div className="clinical-form-actions">
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
            {formId === 'informe-traslado-hospital-salvador' && (
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
