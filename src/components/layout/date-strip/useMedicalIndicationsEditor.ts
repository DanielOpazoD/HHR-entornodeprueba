import React from 'react';
import {
  calculateMedicalIndicationsStayDays,
  formatMedicalIndicationsDate,
  normalizeMedicalIndicationsDateKey,
  type MedicalIndicationRecord,
  type MedicalIndicationsKineType,
  type MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';

const INDICATIONS_LINES = 15;

const defaultSelectedPatient = (patients: MedicalIndicationsPatientOption[]) => patients[0] ?? null;

const buildTodayDateKey = () => new Date().toISOString().slice(0, 10);

const resolveInitialTargetDate = (patient: MedicalIndicationsPatientOption | null): string =>
  normalizeMedicalIndicationsDateKey(patient?.sourceDailyRecordDate || '') || buildTodayDateKey();

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
  const [indicationDraft, setIndicationDraft] = React.useState('');
  const [indications, setIndications] = React.useState<string[]>(() =>
    Array.from({ length: INDICATIONS_LINES }, () => '')
  );
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

  React.useEffect(() => {
    if (!isOpen || !selectedPatient) return;
    setSelectedBedId(current => (current ? current : selectedPatient.bedId));
  }, [isOpen, selectedPatient]);

  React.useEffect(() => {
    if (!isOpen || !selectedPatient) return;
    setTreatingDoctor(selectedPatient.treatingDoctor);
  }, [isOpen, selectedPatient]);

  React.useEffect(() => {
    if (!isOpen || !selectedPatient) return;
    setTargetDate(resolveInitialTargetDate(selectedPatient));
  }, [isOpen, selectedPatient]);

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

  const insertIndication = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    let inserted = false;
    setIndications(current => {
      const next = [...current];
      const firstEmptyIndex = next.findIndex(item => !item.trim());
      if (firstEmptyIndex === -1) return next;
      next[firstEmptyIndex] = trimmed;
      inserted = true;
      return next;
    });
    return inserted;
  };

  const addIndication = () => {
    const trimmed = indicationDraft.trim();
    if (!trimmed) return;

    if (insertIndication(trimmed)) {
      setIndicationDraft('');
    }
  };

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
    setIndications([
      ...nextIndications,
      ...Array.from({ length: INDICATIONS_LINES - nextIndications.length }, () => ''),
    ]);
    setIndicationDraft('');
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
      setIndications(Array.from({ length: INDICATIONS_LINES }, () => ''));
      setIndicationDraft('');
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
