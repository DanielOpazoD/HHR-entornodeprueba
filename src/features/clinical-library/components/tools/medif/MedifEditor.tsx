import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Printer, Upload } from 'lucide-react';
import { MEDIF_FIELDS, MEDIF_SECTIONS } from '../../../domain/medifSchema';
import {
  emptyMedifValues,
  exportMedifDraft,
  importMedifDraft,
  setMedifFieldValue,
  type MedifValues,
} from '../../../domain/medifDraft';
import {
  isMedifFieldHidden,
  loadMedifPreferences,
  saveMedifPreferences,
  type MedifPreferences,
} from '../../../domain/medifPreferences';
import { ToolFrame } from '../ToolFrame';
import { TOOL_INPUT_CLASS } from '../ToolField';
import { MedifFormSection } from './MedifFormSection';
import { MedifPreferencesPanel } from './MedifPreferencesPanel';
import { MedifVariableIndex } from './MedifVariableIndex';
import { MedifTabs, MedifSectionNavigation, type MedifTabId } from './MedifNavigation';
import {
  downloadMedifJson,
  MEDIF_SECONDARY_BUTTON,
  type MedifEditorProps,
} from './medifEditorTypes';

export type { MedifEditorProps, MedifEditorPatient } from './medifEditorTypes';

interface Replacement {
  values: MedifValues;
  key: string;
  source: string;
}
const DEFAULT_PREVIEWS = [1, 2, 3].map(page => `/images/forms/medif/page-${page}.png`);

export const MedifEditor: React.FC<MedifEditorProps> = ({
  patients,
  onBack,
  onClose,
  onGeneratePdf,
  onDirtyChange,
  previewPageUrls = DEFAULT_PREVIEWS,
}) => {
  const [values, setValues] = useState(emptyMedifValues);
  const [preferences, setPreferences] = useState(loadMedifPreferences);
  const [preferencesSaved, setPreferencesSaved] = useState<boolean | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [source, setSource] = useState('Ingreso manual · sin asociación a una cama');
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [tab, setTab] = useState<MedifTabId>('form');
  const [sectionId, setSectionId] = useState(MEDIF_SECTIONS[0].id);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const draftInput = useRef<HTMLInputElement>(null);
  const currentValues = useRef(values);
  const importSequence = useRef(0);
  const sectionIndex = MEDIF_SECTIONS.findIndex(section => section.id === sectionId);
  const section = MEDIF_SECTIONS[sectionIndex];
  const dirty = Object.values(values).some(value => value.trim());
  const visibleFields = MEDIF_FIELDS.filter(field => !isMedifFieldHidden(preferences, field.id));
  const completed = visibleFields.filter(field => values[field.id]?.trim()).length;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  const replaceDraft = (next: Replacement): void => {
    importSequence.current += 1;
    currentValues.current = { ...emptyMedifValues(), ...next.values };
    setValues(currentValues.current);
    setSelectedKey(next.key);
    setSource(next.source);
    setReplacement(null);
    setNotice('');
  };
  const changeField = (id: string, value: string): void => {
    currentValues.current = setMedifFieldValue(currentValues.current, id, value);
    setValues(currentValues.current);
  };
  const requestReplacement = (next: Replacement): void => {
    if (Object.values(currentValues.current).some(value => value.trim())) setReplacement(next);
    else replaceDraft(next);
  };
  const choosePatient = (key: string): void => {
    if (key === selectedKey) return;
    const patient = patients.find(item => item.key === key);
    if (key && !patient) return;
    importSequence.current += 1;
    requestReplacement({
      key,
      values: patient?.values ?? emptyMedifValues(),
      source: patient?.sourceLabel ?? 'Ingreso manual · sin asociación a una cama',
    });
  };
  const changePreferences = (next: MedifPreferences): void => {
    setPreferences(next);
    setPreferencesSaved(saveMedifPreferences(next));
  };
  const importDraft = async (file?: File): Promise<void> => {
    if (!file) return;
    const sequence = ++importSequence.current;
    try {
      if (file.size > 1_000_000) throw new Error('El borrador es demasiado grande.');
      const text = await file.text();
      if (sequence !== importSequence.current) return;
      const imported = importMedifDraft(text);
      requestReplacement({
        key: '',
        values: imported,
        source: 'Borrador importado · sin asociación a una cama',
      });
    } catch (error) {
      if (sequence !== importSequence.current) return;
      setNotice(error instanceof Error ? error.message : 'No se pudo cargar el borrador.');
    }
  };
  const generate = async (mode: 'print' | 'editable'): Promise<void> => {
    setBusy(true);
    setNotice('');
    try {
      await onGeneratePdf(values, preferences, mode);
      setNotice(mode === 'print' ? 'PDF imprimible preparado.' : 'PDF editable preparado.');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'No se pudo generar el PDF. Inténtalo nuevamente.'
      );
    } finally {
      setBusy(false);
    }
  };
  const openSection = (id: string): void => {
    setSectionId(id);
    setTab('form');
  };

  return (
    <ToolFrame
      title="MEDIF · autorización médica de viaje"
      icon={<FileText size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      testId="library-tool-medif"
    >
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-medical-600">
              Documentos de traslado
            </p>
            <h4 className="mt-1 text-xl font-bold text-slate-800">Preparar formulario MEDIF</h4>
            <p className="mt-1 text-[12px] text-slate-500">
              Completa el formulario, revisa sus variables y descarga el PDF original.
            </p>
          </div>
          <span className="rounded-full border border-medical-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-medical-700">
            3 páginas · 137 casilleros
          </span>
        </div>
        <div className="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="min-w-0 text-[11px] font-semibold text-slate-600">
            Origen de los datos
            <select
              value={selectedKey}
              onChange={event => choosePatient(event.target.value)}
              className={`${TOOL_INPUT_CLASS} mt-1`}
              disabled={busy || Boolean(replacement)}
            >
              <option value="">Ingreso manual / paciente externo</option>
              {patients.map(patient => (
                <option key={patient.key} value={patient.key}>
                  {patient.label}
                </option>
              ))}
              {selectedKey && !patients.some(patient => patient.key === selectedKey) && (
                <option value={selectedKey}>Paciente cargado · {source}</option>
              )}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={MEDIF_SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => downloadMedifJson(exportMedifDraft(values), 'medif-borrador.json')}
            >
              <Download size={13} aria-hidden="true" /> Guardar borrador
            </button>
            <button
              type="button"
              className={MEDIF_SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => draftInput.current?.click()}
            >
              <Upload size={13} aria-hidden="true" /> Cargar
            </button>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {source}
          {selectedKey ? ' · Copia al cargar; confirma los datos antes de emitir.' : ''}
        </p>
        <input
          ref={draftInput}
          type="file"
          accept=".json,application/json"
          aria-label="Archivo de borrador MEDIF"
          className="hidden"
          onChange={event => {
            void importDraft(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <p className="mt-1 text-[10px] text-slate-400">
          El formulario se mantiene en esta sesión. «Guardar borrador» descarga todos sus datos,
          incluidos los campos ocultos, a un archivo local.
        </p>
      </div>

      {replacement && (
        <div
          role="alertdialog"
          aria-labelledby="medif-replace-title"
          aria-describedby="medif-replace-description"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <h4 id="medif-replace-title" className="text-[13px] font-bold text-amber-900">
            Reemplazar el formulario actual
          </h4>
          <p id="medif-replace-description" className="mt-1 text-[12px] text-amber-800">
            Se borrarán todos los datos actuales para cargar{' '}
            {replacement.key ? 'el paciente seleccionado' : 'el ingreso manual o borrador'}. Guarda
            el borrador primero si quieres conservarlo.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => setReplacement(null)}
              className={MEDIF_SECONDARY_BUTTON}
            >
              Conservar formulario
            </button>
            <button
              type="button"
              onClick={() => replaceDraft(replacement)}
              className="rounded-md bg-amber-700 px-3 py-2 text-[11px] font-semibold text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700"
            >
              Reemplazar todos los datos
            </button>
          </div>
        </div>
      )}

      <MedifTabs value={tab} onChange={setTab} />

      <div role="tabpanel" id={`medif-panel-${tab}`} aria-labelledby={`medif-tab-${tab}`}>
        {tab === 'form' ? (
          <div className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)]">
            <MedifSectionNavigation
              sectionId={sectionId}
              values={values}
              preferences={preferences}
              onSelect={setSectionId}
            />
            <div className="min-w-0">
              <MedifFormSection
                section={section}
                values={values}
                preferences={preferences}
                onChange={changeField}
                onPreferences={() => setTab('preferences')}
              />
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  className={MEDIF_SECONDARY_BUTTON}
                  disabled={sectionIndex === 0}
                  onClick={() => setSectionId(MEDIF_SECTIONS[sectionIndex - 1].id)}
                >
                  <ChevronLeft size={13} aria-hidden="true" /> Anterior
                </button>
                <span className="text-[10px] text-slate-400">
                  Sección {sectionIndex + 1} de {MEDIF_SECTIONS.length}
                </span>
                <button
                  type="button"
                  className={MEDIF_SECONDARY_BUTTON}
                  disabled={sectionIndex === MEDIF_SECTIONS.length - 1}
                  onClick={() => setSectionId(MEDIF_SECTIONS[sectionIndex + 1].id)}
                >
                  Siguiente <ChevronRight size={13} aria-hidden="true" />
                </button>
              </div>
              {previewPageUrls.length > 0 && (
                <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50">
                  <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-semibold text-slate-600 focus-visible:outline focus-visible:outline-medical-600">
                    Referencia del PDF original · página {section.page}
                  </summary>
                  <div className="border-t border-slate-200 p-3">
                    <p className="mb-2 text-[10px] text-slate-500">
                      Plantilla sin datos. El PDF descargado incorpora los campos visibles que
                      completaste.
                    </p>
                    <a
                      href={previewPageUrls[section.page - 1]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                      aria-label={`Ampliar página ${section.page} del original`}
                    >
                      <img
                        src={previewPageUrls[section.page - 1]}
                        alt={`Página ${section.page} del formulario MEDIF original`}
                        loading="lazy"
                        className="mx-auto w-full max-w-xl border border-slate-200 bg-white shadow-sm"
                      />
                    </a>
                  </div>
                </details>
              )}
            </div>
          </div>
        ) : tab === 'variables' ? (
          <MedifVariableIndex preferences={preferences} onSelectField={openSection} />
        ) : (
          <MedifPreferencesPanel
            preferences={preferences}
            onChange={changePreferences}
            saved={preferencesSaved}
          />
        )}
      </div>

      <div className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 py-3 backdrop-blur-sm">
        <div>
          <p className="text-[11px] font-semibold text-slate-600">
            {completed} de {visibleFields.length} casilleros visibles con datos
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Revisa los datos y las respuestas clínicas antes de firmar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate('editable')}
            className={MEDIF_SECONDARY_BUTTON}
          >
            <Download size={13} aria-hidden="true" /> PDF editable
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate('print')}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-medical-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 disabled:cursor-wait disabled:opacity-50"
          >
            <Printer size={14} aria-hidden="true" />
            {busy ? 'Preparando PDF…' : 'PDF imprimible'}
          </button>
        </div>
        {notice && (
          <p
            role="status"
            className="w-full rounded-md bg-slate-100 px-3 py-2 text-[12px] text-slate-700"
          >
            {notice}
          </p>
        )}
      </div>
    </ToolFrame>
  );
};
