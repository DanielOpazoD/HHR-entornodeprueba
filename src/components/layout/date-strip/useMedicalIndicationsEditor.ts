import React from 'react';
import { executeGetLatestMedicalIndicationRecord } from '@/application/medical-indications/medicalIndicationsUseCases';
import {
  buildMedicalIndicationsEpisodeId,
  calculateMedicalIndicationsStayDays,
  formatMedicalIndicationsDate,
  normalizeMedicalIndicationsDateKey,
  type MedicalIndicationRecord,
  type MedicalIndicationTemplate,
  type MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';
import {
  CLOSED_RECORD,
  INDICATIONS_LINES,
  addFreeText,
  buildMedicalIndicationsRecordId,
  moveLine,
  padIndicationLines,
  reduceMedicalIndicationsRecord,
  removeLine,
  replaceLine,
  type MedicalIndicationsDraft,
} from './medicalIndicationsRecordState';

const defaultSelectedPatient = (patients: MedicalIndicationsPatientOption[]) => patients[0] ?? null;

const resolveInitialTargetDate = (patient: MedicalIndicationsPatientOption | null): string =>
  normalizeMedicalIndicationsDateKey(patient?.sourceDailyRecordDate || '') || getTodayISO();

/** What the fields show while no record is ready: nothing, and nothing can be typed into it. */
const NO_DRAFT: MedicalIndicationsDraft = {
  reposo: '',
  regimen: '',
  kineType: 'ninguna',
  kineTimes: '',
  treatingDoctor: '',
  pendingNotes: '',
  lines: padIndicationLines([]),
  freeText: '',
  templateIds: [],
  templateDidNotFit: false,
};

export const useMedicalIndicationsEditor = ({
  isOpen,
  patients,
}: {
  isOpen: boolean;
  patients: MedicalIndicationsPatientOption[];
}) => {
  const [selectedBedId, setSelectedBedId] = React.useState('');
  const [targetDate, setTargetDate] = React.useState('');
  const [record, dispatch] = React.useReducer(reduceMedicalIndicationsRecord, CLOSED_RECORD);
  const [isEditingIndications, setIsEditingIndications] = React.useState(true);
  const [isOrderingIndications, setIsOrderingIndications] = React.useState(false);
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editingValue, setEditingValue] = React.useState('');
  const [isPrinting, setIsPrinting] = React.useState(false);

  const selectedPatient = React.useMemo(() => {
    const fallbackPatient = defaultSelectedPatient(patients);
    if (!selectedBedId) return fallbackPatient;
    return patients.find(patient => patient.bedId === selectedBedId) ?? fallbackPatient;
  }, [patients, selectedBedId]);

  // A census refresh rebuilds the patient objects; only another episode starts on its census day.
  const selectedEpisodeId = selectedPatient
    ? buildMedicalIndicationsEpisodeId(selectedPatient)
    : '';
  if (useChangedOnRender([isOpen, selectedEpisodeId]) && isOpen && selectedPatient) {
    setSelectedBedId(current => (current ? current : selectedPatient.bedId));
    setTargetDate(resolveInitialTargetDate(selectedPatient));
  }

  const selectedRecordId =
    isOpen && selectedPatient && targetDate
      ? buildMedicalIndicationsRecordId(selectedPatient, targetDate)
      : null;
  if (useChangedOnRender([selectedRecordId])) {
    dispatch({
      type: 'select',
      selection:
        selectedRecordId && selectedPatient ? { patient: selectedPatient, targetDate } : null,
    });
  }

  React.useEffect(() => {
    if (record.status !== 'loading') return;
    const { id, patient } = record;
    executeGetLatestMedicalIndicationRecord({ patient, targetDate: record.targetDate })
      .then(saved => dispatch({ type: 'loaded', id, saved, patient }))
      .catch(error =>
        dispatch({
          type: 'loadFailed',
          id,
          message:
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar las indicaciones aplicadas.',
        })
      );
  }, [record]);

  const readyId = record.status === 'ready' ? record.id : null;
  const draft = record.status === 'ready' ? record.draft : NO_DRAFT;
  if (useChangedOnRender([readyId])) {
    setEditingIndex(null);
    setEditingValue('');
  }

  const edit = (update: (current: MedicalIndicationsDraft) => MedicalIndicationsDraft) => {
    if (readyId) dispatch({ type: 'edit', id: readyId, update });
  };
  const editField =
    <Field extends keyof MedicalIndicationsDraft>(field: Field) =>
    (value: MedicalIndicationsDraft[Field]) =>
      edit(current => ({ ...current, [field]: value }));

  const activeIndications = React.useMemo(
    () => draft.lines.map(text => text.trim()).filter(Boolean),
    [draft.lines]
  );

  const targetDateLabel = React.useMemo(
    () => formatMedicalIndicationsDate(targetDate),
    [targetDate]
  );

  const daysOfStayForTargetDate = React.useMemo(
    () =>
      selectedPatient
        ? calculateMedicalIndicationsStayDays(selectedPatient.admissionDate, targetDate)
        : '',
    [selectedPatient, targetDate]
  );

  const resetEditing = () => {
    setEditingIndex(null);
    setEditingValue('');
  };

  const saveEditedIndication = () => {
    if (editingIndex === null) return;
    const trimmed = editingValue.trim();
    if (!trimmed) return;
    edit(current => replaceLine(current, editingIndex, trimmed));
    resetEditing();
  };

  return {
    selectedBedId,
    setSelectedBedId,
    selectedPatient,
    /** The record life cycle: only `ready` can be edited, saved, printed or receive a template. */
    record,
    reposo: draft.reposo,
    setReposo: editField('reposo'),
    regimen: draft.regimen,
    setRegimen: editField('regimen'),
    kineType: draft.kineType,
    setKineType: editField('kineType'),
    kineTimes: draft.kineTimes,
    setKineTimes: editField('kineTimes'),
    treatingDoctor: draft.treatingDoctor,
    setTreatingDoctor: editField('treatingDoctor'),
    pendingNotes: draft.pendingNotes,
    setPendingNotes: editField('pendingNotes'),
    targetDate,
    setTargetDate,
    targetDateLabel,
    daysOfStayForTargetDate,
    indicationDraft: draft.freeText,
    setIndicationDraft: editField('freeText'),
    indications: draft.lines,
    activeIndications,
    isEditingIndications,
    setIsEditingIndications,
    isOrderingIndications,
    setIsOrderingIndications,
    editingIndex,
    editingValue,
    setEditingValue,
    isPrinting,
    setIsPrinting,
    templateIds: draft.templateIds,
    templateDidNotFit: draft.templateDidNotFit,
    /** The template audit finished; it lands only if record `id` is still the one being edited. */
    insertTemplate: (id: string, template: Pick<MedicalIndicationTemplate, 'id' | 'text'>) =>
      dispatch({ type: 'templateAudited', id, template }),
    markSaved: (id: string, saved: MedicalIndicationRecord) =>
      dispatch({ type: 'saved', id, record: saved }),
    addIndication: () => edit(addFreeText),
    removeIndication: (index: number) => edit(current => removeLine(current, index)),
    moveIndication: (index: number, direction: 'up' | 'down') =>
      edit(current => moveLine(current, index, direction)),
    startEditing: (index: number, text: string) => {
      setEditingIndex(index);
      setEditingValue(text);
    },
    resetEditing,
    saveEditedIndication,
    maxIndications: INDICATIONS_LINES,
  };
};
