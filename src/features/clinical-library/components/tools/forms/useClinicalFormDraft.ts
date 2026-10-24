import { useEffect, useRef, useState } from 'react';
import {
  hasClinicalFormData,
  importClinicalFormDraft,
  setClinicalFormValue,
  projectedClinicalFormValues,
  storedClinicalFormValues,
  storedClinicalFormVariableId,
} from '../../../domain/forms/clinicalFormDraft';
import { mergeEmptyFormValues } from '../../../domain/forms/clinicalFormPatient';
import type {
  ClinicalFormId,
  ClinicalFormPatientOption,
  ClinicalFormValue,
  ClinicalFormValues,
} from '../../../domain/forms/clinicalFormTypes';

interface Replacement {
  values: ClinicalFormValues;
  source: ClinicalFormPatientOption | null;
  formId?: ClinicalFormId;
}

const censusContextValues = (source: ClinicalFormPatientOption): ClinicalFormValues => ({
  ...source.values,
  imagen_procedencia: 'hospitalizado',
  contraste_procedencia: 'hospitalizado',
  laboratorio_procedencia: 'hospitalizado',
  vdrl_procedencia: 'Hospital Hanga Roa · Hospitalizados',
  serologia_procedencia: 'Hospital Hanga Roa · Hospitalizados',
  establecimiento_nombre: 'Hospital Hanga Roa',
  tbc_unidad: 'Hospitalizados',
});

export const useClinicalFormDraft = (
  formId: ClinicalFormId,
  patients: ReadonlyArray<ClinicalFormPatientOption>,
  onFormChange: (id: ClinicalFormId) => void,
  onDirtyChange?: (dirty: boolean) => void
) => {
  const [storedValues, setValues] = useState<ClinicalFormValues>({});
  const valuesRef = useRef(storedValues);
  const values = projectedClinicalFormValues(formId, storedValues);
  const [source, setSource] = useState<ClinicalFormPatientOption | null>(null);
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [notice, setNotice] = useState('');
  const importSequence = useRef(0);
  const dirty = hasClinicalFormData(storedValues);
  const currentSource = source
    ? patients.find(
        patient =>
          patient.key === source.key && patient.context.identity === source.context.identity
      )
    : null;
  const sourceMissing = Boolean(source && !currentSource);
  const sourceChanges =
    source && currentSource
      ? [...new Set([...Object.keys(source.values), ...Object.keys(currentSource.values)])]
          .filter(
            id => id !== 'censo_actualizado_en' && source.values[id] !== currentSource.values[id]
          )
          .map(id => ({ id, draft: values[id] ?? null, current: currentSource.values[id] ?? null }))
      : [];
  const sourceChanged = sourceChanges.length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(
    () => () => {
      importSequence.current += 1;
    },
    []
  );

  const updateValues = (next: ClinicalFormValues) => {
    valuesRef.current = next;
    setValues(next);
  };
  const replace = (next: Replacement) => {
    importSequence.current += 1;
    updateValues(storedClinicalFormValues(next.formId ?? formId, next.values));
    setSource(next.source);
    setReplacement(null);
    setNotice('');
    if (next.formId) onFormChange(next.formId);
  };
  const request = (next: Replacement) => {
    if (hasClinicalFormData(valuesRef.current)) setReplacement(next);
    else replace(next);
  };
  const selectPatient = (key: string) => {
    if (key === (source?.key ?? '')) return;
    const patient = patients.find(item => item.key === key);
    if (key && !patient) return;
    importSequence.current += 1;
    request({ source: patient ?? null, values: patient ? censusContextValues(patient) : {} });
  };
  const change = (id: string, value: ClinicalFormValue) => {
    importSequence.current += 1;
    updateValues(
      setClinicalFormValue(valuesRef.current, storedClinicalFormVariableId(formId, id), value)
    );
    setNotice('');
  };
  const refresh = () => {
    if (!currentSource) return;
    updateValues(mergeEmptyFormValues(valuesRef.current, censusContextValues(currentSource)));
    setSource(currentSource);
    setNotice('Se completaron los campos vacíos. Se conservaron las respuestas existentes.');
  };
  const keepReviewedSource = () => {
    if (currentSource) setSource(currentSource);
  };
  const importFile = async (file: File) => {
    const sequence = ++importSequence.current;
    try {
      if (file.size > 1_000_000) throw new Error('El borrador es demasiado grande.');
      const text = await file.text().catch(() => {
        throw new Error('No se pudo leer el archivo de borrador. Vuelve a intentarlo.');
      });
      if (sequence !== importSequence.current) return;
      const imported = importClinicalFormDraft(text);
      setNotice('');
      request({ ...imported, source: null });
    } catch (error) {
      if (sequence === importSequence.current)
        setNotice(error instanceof Error ? error.message : 'No se pudo importar el borrador.');
    }
  };
  return {
    values,
    source,
    replacement,
    dirty,
    notice,
    sourceMissing,
    sourceChanged,
    sourceChanges,
    setNotice,
    selectPatient,
    change,
    refresh,
    keepReviewedSource,
    importFile,
    changeForm: (id: ClinicalFormId) => {
      importSequence.current += 1;
      onFormChange(id);
    },
    cancelReplacement: () => setReplacement(null),
    confirmReplacement: () => {
      if (replacement) replace(replacement);
    },
    detachSource: () => {
      setSource(null);
      setNotice('Borrador manual desvinculado del censo. Revisa sus datos antes de imprimir.');
    },
  };
};
