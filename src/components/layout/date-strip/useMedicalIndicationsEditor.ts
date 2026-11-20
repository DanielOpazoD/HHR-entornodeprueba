import React from 'react';
import {
  calculateMedicalIndicationsStayDays,
  formatMedicalIndicationsDate,
  normalizeMedicalIndicationsDateKey,
  type MedicalIndicationRecord,
  type MedicalIndicationsKineType,
  type MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

const INDICATIONS_LINES = 15;

const defaultSelectedPatient = (patients: MedicalIndicationsPatientOption[]) => patients[0] ?? null;

const buildTodayDateKey = () => getTodayISO();

const resolveInitialTargetDate = (patient: MedicalIndicationsPatientOption | null): string =>
  normalizeMedicalIndicationsDateKey(patient?.sourceDailyRecordDate || '') || buildTodayDateKey();

const emptyIndicationLines = () => Array.from({ length: INDICATIONS_LINES }, () => '');

/** The lines with `text` in the first empty one, or `null` when every line is taken. */
const placeInFirstEmptyLine = (lines: string[], text: string): string[] | null => {
  const firstEmptyIndex = lines.findIndex(item => !item.trim());
  if (firstEmptyIndex === -1) return null;
  const next = [...lines];
  next[firstEmptyIndex] = text;
  return next;
};

export const useMedicalIndicationsEditor = ({
  isOpen,
  patients,
}: {
  isOpen: boolean;
  patients: MedicalIndicationsPatientOption[];
}) => {
  const [selectedBedId, setSelectedBedId] = React.useState('');
  const [reposo, setReposo] = React.useState('');
  const [regimen, setRegimen] = React.useState('');
  const [kineType, setKineType] = React.useState<MedicalIndicationsKineType>('ninguna');
  const [kineTimes, setKineTimes] = React.useState('');
  const [treatingDoctor, setTreatingDoctor] = React.useState('');
  const [pendingNotes, setPendingNotes] = React.useState('');
  const [targetDate, setTargetDate] = React.useState('');
  // The free-text box and the lines live in one state, so adding a draft also empties the box.
  const [{ draft: indicationDraft, lines: indications }, setIndicationsList] = React.useState(
    () => ({ draft: '', lines: emptyIndicationLines() })
  );
  const setIndicationDraft = (draft: string) =>
    setIndicationsList(current => ({ ...current, draft }));
  const setIndications = (update: (lines: string[]) => string[]) =>
    setIndicationsList(current => ({ ...current, lines: update(current.lines) }));
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

  if (useChangedOnRender([isOpen, selectedPatient]) && isOpen && selectedPatient) {
    setSelectedBedId(current => (current ? current : selectedPatient.bedId));
    setTreatingDoctor(selectedPatient.treatingDoctor);
    setTargetDate(resolveInitialTargetDate(selectedPatient));
  }

  const activeIndications = React.useMemo(
    () => indications.map(text => text.trim()).filter(Boolean),
    [indications]
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

  // A template inserted after its audit lands on the latest lines and leaves the draft alone.
  const insertIndication = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIndications(current => placeInFirstEmptyLine(current, trimmed) ?? current);
  };

  // With every line taken the draft stays in the box, so nothing typed is lost.
  const addIndication = () =>
    setIndicationsList(current => {
      const trimmed = current.draft.trim();
      const lines = trimmed ? placeInFirstEmptyLine(current.lines, trimmed) : null;
      return lines ? { draft: '', lines } : current;
    });

  const removeIndication = (targetIndex: number) => {
    setIndications(current => {
      const next = current.map(text => text.trim()).filter(Boolean);
      next.splice(targetIndex, 1);
      return [...next, ...Array.from({ length: INDICATIONS_LINES - next.length }, () => '')];
    });
  };

  const moveIndication = (targetIndex: number, direction: 'up' | 'down') => {
    setIndications(current => {
      const active = current.map(text => text.trim()).filter(Boolean);
      const destination = direction === 'up' ? targetIndex - 1 : targetIndex + 1;
      if (destination < 0 || destination >= active.length) return current;
      [active[targetIndex], active[destination]] = [active[destination], active[targetIndex]];
      return [...active, ...Array.from({ length: INDICATIONS_LINES - active.length }, () => '')];
    });
  };

  const startEditing = (index: number, text: string) => {
    setEditingIndex(index);
    setEditingValue(text);
  };

  const resetEditing = () => {
    setEditingIndex(null);
    setEditingValue('');
  };

  const saveEditedIndication = () => {
    if (editingIndex === null) return;
    const trimmed = editingValue.trim();
    if (!trimmed) return;
    setIndications(current => {
      const active = current.map(text => text.trim()).filter(Boolean);
      active[editingIndex] = trimmed;
      return [...active, ...Array.from({ length: INDICATIONS_LINES - active.length }, () => '')];
    });
    resetEditing();
  };

  const hydrateFromRecord = React.useCallback((record: MedicalIndicationRecord) => {
    setReposo(record.reposo);
    setRegimen(record.regimen);
    setKineType(record.kineType);
    setKineTimes(record.kineTimes);
    setTreatingDoctor(record.treatingDoctor);
    setPendingNotes(record.pendingNotes);
    const nextIndications = record.indications.slice(0, INDICATIONS_LINES);
    setIndicationsList({
      draft: '',
      lines: [
        ...nextIndications,
        ...Array.from({ length: INDICATIONS_LINES - nextIndications.length }, () => ''),
      ],
    });
    setEditingIndex(null);
    setEditingValue('');
  }, []);

  const resetAppliedRecordDraft = React.useCallback(
    (patient: MedicalIndicationsPatientOption | null = selectedPatient) => {
      setReposo('');
      setRegimen('');
      setKineType('ninguna');
      setKineTimes('');
      setTreatingDoctor(patient?.treatingDoctor || '');
      setPendingNotes('');
      setIndicationsList({ draft: '', lines: emptyIndicationLines() });
      setEditingIndex(null);
      setEditingValue('');
    },
    [selectedPatient]
  );

  return {
    selectedBedId,
    setSelectedBedId,
    selectedPatient,
    reposo,
    setReposo,
    regimen,
    setRegimen,
    kineType,
    setKineType,
    kineTimes,
    setKineTimes,
    treatingDoctor,
    setTreatingDoctor,
    pendingNotes,
    setPendingNotes,
    targetDate,
    setTargetDate,
    targetDateLabel,
    daysOfStayForTargetDate,
    indicationDraft,
    setIndicationDraft,
    indications,
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
    insertIndication,
    addIndication,
    removeIndication,
    moveIndication,
    startEditing,
    resetEditing,
    saveEditedIndication,
    hydrateFromRecord,
    resetAppliedRecordDraft,
    maxIndications: INDICATIONS_LINES,
  };
};
