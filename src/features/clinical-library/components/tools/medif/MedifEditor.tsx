import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Printer, Settings2, Upload } from 'lucide-react';
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
import { MedifHabitualButton } from './MedifHabitualButton';
import { applyMedifHabitualAnswers } from '../../../domain/medifHabitualAnswers';
import { MedifPreferencesPanel } from './MedifPreferencesPanel';
import { MedifVariableIndex } from './MedifVariableIndex';
import { MedifTabs, MedifJumpIndex, type MedifTabId } from './MedifNavigation';
import {
  downloadMedifJson,
  MEDIF_SECONDARY_BUTTON,
  type MedifEditorProps,
} from './medifEditorTypes';

import {
  MEDIF_FORM_BLOCKS,
  getMedifCanonicalFieldId,
  getMedifFormBlockIdForField,
} from '../../../domain/medifFormLayout';
import './medifEditor.css';

export type { MedifEditorProps, MedifEditorPatient } from './medifEditorTypes';

interface Replacement {
  values: MedifValues;
  key: string;
  source: string;
}

export const MedifEditor: React.FC<MedifEditorProps> = ({
  patients,
  onBack,
  onClose,
  onGeneratePdf,
  onDirtyChange,
}) => {
  const [values, setValues] = useState(emptyMedifValues);
  const [preferences, setPreferences] = useState(loadMedifPreferences);
  const [preferencesSaved, setPreferencesSaved] = useState<boolean | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [source, setSource] = useState('');
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [tab, setTab] = useState<MedifTabId>('form');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const draftInput = useRef<HTMLInputElement>(null);
  const currentValues = useRef(values);
  const importSequence = useRef(0);
  const dirty = Object.values(values).some(value => value.trim());

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
  const applyHabitualAnswers = (): void => {
    const result = applyMedifHabitualAnswers(currentValues.current, preferences);
    currentValues.current = result.values;
    setValues(result.values);
    setNotice(
      result.applied
        ? 'Respuestas habituales aplicadas.'
        : 'No había respuestas habituales pendientes.'
    );
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
      source: patient?.sourceLabel ?? '',
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
        source: 'Borrador',
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
  const openField = (id: string): void => {
    const canonical = getMedifCanonicalFieldId(id);
    setSettingsOpen(true);
    setFocusField(canonical);
    setTab(isMedifFieldHidden(preferences, canonical) ? 'preferences' : 'form');
    setNotice('');
  };
  const jumpBlock = (id: string): void => {
    const element = document.getElementById(`medif-block-${id}`);
    element?.scrollIntoView?.({ block: 'start' });
    element?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (tab !== 'form' || !focusField) return;
    const element =
      document.getElementById(`medif-${focusField}`) ??
      document.getElementById(`medif-block-${getMedifFormBlockIdForField(focusField)}`);
    element?.scrollIntoView?.({ block: 'center' });
    element?.focus({ preventScroll: true });
  }, [tab, focusField]);

  return (
    <ToolFrame
      title="MEDIF · autorización médica de viaje"
      icon={<FileText size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      testId="library-tool-medif"
    >
      <div className="medif-toolbar">
        <label className="medif-source">
          Paciente
          <select
            aria-label="Origen de los datos"
            value={selectedKey}
            onChange={event => choosePatient(event.target.value)}
            className={`${TOOL_INPUT_CLASS} mt-1`}
            disabled={busy || Boolean(replacement)}
          >
            <option value="">Ingreso manual</option>
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
        <div className="medif-toolbar-actions">
          <MedifHabitualButton
            onClick={applyHabitualAnswers}
            disabled={busy || Boolean(replacement)}
          />
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
          <button
            type="button"
            aria-label="Configurar MEDIF"
            title="Variables y preferencias"
            aria-expanded={settingsOpen}
            aria-controls="medif-settings"
            className={`${MEDIF_SECONDARY_BUTTON} medif-settings-button`}
            onClick={() => {
              setSettingsOpen(!settingsOpen);
              setFocusField(null);
              setTab('form');
            }}
          >
            <Settings2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
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
              className="medif-replace-button rounded-md bg-amber-700 px-3 py-2 text-[11px] font-semibold text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2"
            >
              Reemplazar todos los datos
            </button>
          </div>
        </div>
      )}

      <div id="medif-settings" hidden={!settingsOpen}>
        {settingsOpen && (
          <MedifTabs
            value={tab}
            onChange={next => {
              setFocusField(null);
              setTab(next);
            }}
          />
        )}
      </div>

      <div
        role={settingsOpen ? 'tabpanel' : 'region'}
        id={`medif-panel-${tab}`}
        aria-label={settingsOpen ? undefined : 'Formulario MEDIF'}
        aria-labelledby={settingsOpen ? `medif-tab-${tab}` : undefined}
      >
        {tab === 'form' ? (
          <>
            <MedifJumpIndex onSelect={jumpBlock} />
            <div className="medif-form-grid">
              {MEDIF_FORM_BLOCKS.map(block => (
                <MedifFormSection
                  key={block.id}
                  block={block}
                  values={values}
                  preferences={preferences}
                  onChange={changeField}
                />
              ))}
            </div>
          </>
        ) : tab === 'variables' ? (
          <MedifVariableIndex preferences={preferences} onSelectField={openField} />
        ) : (
          <MedifPreferencesPanel
            preferences={preferences}
            onChange={changePreferences}
            saved={preferencesSaved}
            targetFieldId={focusField ?? undefined}
          />
        )}
      </div>

      <div className="medif-export-bar">
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
          <p role="status" className="medif-notice">
            {notice}
          </p>
        )}
      </div>
    </ToolFrame>
  );
};
