import { useEffect, useMemo, useRef, useState } from 'react';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import type {
  SpecialtyCatalogRule,
  SpecialtyRoundSetup,
} from '@/services/specialty/specialtyJevClient';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import {
  isValidDiagnosisCode,
  normalizeDiagnosisCode,
  summarizeCurrentDiagnoses,
} from './specialtyRulesHistoryModel';
import { useSpecialtyRuleSources } from './useSpecialtyRuleSources';

import { upsertSpecialtyRule } from './specialtyRulesEditorModel';

export const useSpecialtyRulesEditor = (date: string) => {
  const beds = useDailyRecordBeds();
  const today = getClinicalCalendarDateISO();
  const [setup, setSetup] = useState<SpecialtyRoundSetup | null>(null);
  const [rules, setRules] = useState<SpecialtyCatalogRule[]>([]);
  const [memory, setMemory] = useState<SpecialtyCatalogRule[]>([]);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [code, setCode] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedSpecialties, setSelectedSpecialties] = useState<Record<string, string>>({});
  const {
    currentBeds,
    currentDate,
    currentError,
    retryCurrent,
    historyMonth,
    historyState,
    history,
    changeHistoryMonth,
    loadHistory,
  } = useSpecialtyRuleSources(date, beds, today);
  const mountedRef = useRef(true);
  const dirty = Boolean(
    setup &&
    (autoEnabled !== setup.policy.autoEnabled ||
      JSON.stringify(rules) !== JSON.stringify(setup.policy.rules) ||
      JSON.stringify(memory) !== JSON.stringify(setup.policy.memory))
  );
  const memoryPendingDeploy = setup?.policy.memoryAvailable === false;

  useEffect(() => {
    mountedRef.current = true;
    void import('@/services/specialty/specialtyJevClient')
      .then(service => service.loadSpecialtyRoundSetup())
      .then(next => {
        if (!mountedRef.current) return;
        setSetup(next);
        setRules(next.policy.rules);
        setMemory(next.policy.memory);
        setAutoEnabled(next.policy.autoEnabled);
      })
      .catch(async error => {
        if (!mountedRef.current) return;
        const service = await import('@/services/specialty/specialtyJevClient');
        if (!mountedRef.current) return;
        setError(service.describeSpecialtySetupError(error));
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const recordedLabels = useMemo(() => {
    const patients = Object.values(currentBeds ?? {}).flatMap(bed => [bed, bed.clinicalCrib]);
    return Object.fromEntries(
      patients
        .filter(patient => patient?.cie10Code && patient.cie10Description)
        .map(patient => [
          normalizeDiagnosisCode(patient!.cie10Code!),
          patient!.cie10Description!.trim(),
        ])
    );
  }, [currentBeds]);
  const currentDiagnoses = useMemo(() => summarizeCurrentDiagnoses(currentBeds), [currentBeds]);
  const normalizedCode = normalizeDiagnosisCode(code);
  const codeLabel = setup?.labels[normalizedCode] || recordedLabels[normalizedCode];
  const suggestions = useMemo(() => {
    if (normalizedCode.length < 2 || !setup) return [];
    return Object.entries(setup.labels)
      .filter(
        ([entryCode, label]) =>
          entryCode.startsWith(normalizedCode) || label.toLowerCase().includes(code.toLowerCase())
      )
      .slice(0, 8);
  }, [code, normalizedCode, setup]);
  const isValidCode = isValidDiagnosisCode(normalizedCode);
  const addRule = () => {
    if (
      !isValidCode ||
      !specialty ||
      rules.some(rule => normalizeDiagnosisCode(rule.cie10Code) === normalizedCode) ||
      rules.length >= 128
    )
      return;
    setRules(current => upsertSpecialtyRule(current, normalizedCode, specialty));
    setMemory(current =>
      current.filter(
        item =>
          normalizeDiagnosisCode(item.cie10Code) !== normalizedCode || item.specialty === specialty
      )
    );
    setCode('');
    setSpecialty('');
    setMessage('');
    setError('');
  };
  const clearConflictingMemory = (selectedCode: string, selectedSpecialty: string) =>
    setMemory(current =>
      current.filter(
        item =>
          normalizeDiagnosisCode(item.cie10Code) !== normalizeDiagnosisCode(selectedCode) ||
          item.specialty === selectedSpecialty
      )
    );
  const changeRule = (id: string, value: string) => {
    const selectedRule = rules.find(rule => rule.id === id);
    if (!selectedRule) return;
    setRules(current =>
      current.map(rule => {
        if (rule.id !== id || (rule.kind === 'review' ? 'review' : rule.specialty) === value) {
          return rule;
        }
        return value === 'review'
          ? {
              id: rule.id,
              kind: 'review',
              cie10Code: rule.cie10Code,
              scope: rule.scope,
              revision: rule.revision + 1,
            }
          : { ...rule, kind: 'assign', specialty: value, revision: rule.revision + 1 };
      })
    );
    if (value !== 'review') clearConflictingMemory(selectedRule.cie10Code, value);
    setError('');
  };
  const stageAssociation = (selectedCode: string, selectedSpecialty: string) => {
    if (
      !isValidDiagnosisCode(selectedCode) ||
      !SPECIALTY_OPTIONS.includes(selectedSpecialty as never) ||
      selectedSpecialty === 'Otro'
    )
      return;
    const normalized = normalizeDiagnosisCode(selectedCode);
    if (
      rules.length >= 128 &&
      !rules.some(rule => normalizeDiagnosisCode(rule.cie10Code) === normalized)
    )
      return;
    setRules(current => upsertSpecialtyRule(current, normalized, selectedSpecialty));
    clearConflictingMemory(normalized, selectedSpecialty);
    setMessage(
      `Asociación ${selectedCode} → ${selectedSpecialty} preparada. Guarda las reglas para publicarla.`
    );
    setError('');
  };
  const changeMemory = (id: string, value: string) => {
    const selected = memory.find(rule => rule.id === id);
    if (!selected) return;
    const explicit = rules.find(
      rule => normalizeDiagnosisCode(rule.cie10Code) === normalizeDiagnosisCode(selected.cie10Code)
    );
    if (explicit && (explicit.kind === 'review' ? 'review' : explicit.specialty) !== value) {
      setError(`La regla explícita de ${selected.cie10Code} tiene otra decisión. Edítala primero.`);
      return;
    }
    setError('');
    setMemory(current =>
      current.map(rule => {
        if (rule.id !== id || (rule.kind === 'review' ? 'review' : rule.specialty) === value) {
          return rule;
        }
        return value === 'review'
          ? {
              id: rule.id,
              kind: 'review',
              cie10Code: rule.cie10Code,
              scope: rule.scope,
              revision: rule.revision + 1,
            }
          : { ...rule, kind: 'assign', specialty: value, revision: rule.revision + 1 };
      })
    );
  };
  const save = async (activateJev = false) => {
    if (
      !setup ||
      busy ||
      (memoryPendingDeploy && setup.policy.memoryEnabled) ||
      (!dirty && !activateJev)
    )
      return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const service = await import('@/services/specialty/specialtyJevClient');
      const result = await service.saveSpecialtyRules(
        setup.policy,
        rules,
        autoEnabled,
        activateJev,
        memory,
        autoEnabled ? today : undefined
      );
      if (!mountedRef.current) return;
      const next = await service.loadSpecialtyRoundSetup();
      if (!mountedRef.current) return;
      setSetup(next);
      setRules(next.policy.rules);
      setMemory(next.policy.memory);
      setAutoEnabled(next.policy.autoEnabled);
      setMessage(
        activateJev
          ? 'Piloto Jev configurado. Las consultas siguen requiriendo confirmación.'
          : !autoEnabled
            ? 'Reglas guardadas · asociación automática desactivada.'
            : autoEnabled && result?.applicationStatus === 'record_missing'
              ? 'Reglas guardadas. El censo vigente aún no existe; se aplicarán cuando esté disponible.'
              : autoEnabled &&
                  result?.applicationStatus !== 'not_requested' &&
                  result?.appliedDecisions !== undefined
                ? `Reglas guardadas · ${result.appliedDecisions} ${result.appliedDecisions === 1 ? 'especialidad asignada' : 'especialidades asignadas'}. Las confirmadas se conservan.`
                : 'Reglas guardadas. Se aplicarán a episodios pendientes en las próximas actualizaciones clínicas.'
      );
    } catch {
      if (!mountedRef.current) return;
      setError(
        'No se pudo confirmar el guardado. Reabre el panel para comprobar las reglas y reintentar.'
      );
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return {
    setup,
    rules,
    memory,
    autoEnabled,
    setAutoEnabled,
    code,
    setCode,
    specialty,
    setSpecialty,
    busy,
    message,
    error,
    selectedSpecialties,
    setSelectedSpecialties,
    currentBeds,
    currentDate,
    currentError,
    retryCurrent,
    historyMonth,
    historyState,
    history,
    changeHistoryMonth,
    loadHistory,
    dirty,
    memoryPendingDeploy,
    recordedLabels,
    currentDiagnoses,
    normalizedCode,
    codeLabel,
    suggestions,
    isValidCode,
    addRule,
    changeRule,
    stageAssociation,
    changeMemory,
    save,
    setRules,
    today,
  };
};
