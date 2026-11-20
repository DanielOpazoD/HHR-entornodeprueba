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
  type MedicalIndicationsRecordVisit,
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
    const { patient } = record;
    const visit = { id: record.id, request: record.request };
    executeGetLatestMedicalIndicationRecord({ patient, targetDate: record.targetDate })
      .then(saved => dispatch({ type: 'loaded', visit, saved, patient }))
      .catch(error =>
        dispatch({
          type: 'loadFailed',
          visit,
          message:
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar las indicaciones aplicadas.',
        })
      );
  }, [record]);

  const ready = record.status === 'ready' ? record : null;
  const draft = ready ? ready.draft : NO_DRAFT;
  if (useChangedOnRender([ready?.id, ready?.request])) {
    setEditingIndex(null);
    setEditingValue('');
  }

  const edit = (update: (current: MedicalIndicationsDraft) => MedicalIndicationsDraft) => {
    if (ready) dispatch({ type: 'edit', visit: { id: ready.id, request: ready.request }, update });
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
    /** Whether what is on screen is exactly what this visit saved. */
    isDraftSaved: Boolean(ready && ready.savedDraft === ready.draft),
    /** The template audit finished; it lands only if `visit` is still the one on screen. */
    insertTemplate: (
      visit: MedicalIndicationsRecordVisit,
      template: Pick<MedicalIndicationTemplate, 'id' | 'text'>
    ) => dispatch({ type: 'templateAudited', visit, template }),
    markSaved: (
      visit: MedicalIndicationsRecordVisit,
      savedDraft: MedicalIndicationsDraft,
      saved: MedicalIndicationRecord
    ) => dispatch({ type: 'saved', visit, draft: savedDraft, record: saved }),
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
