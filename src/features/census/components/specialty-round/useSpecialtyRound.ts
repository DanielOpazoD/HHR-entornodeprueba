import { useEffect, useMemo, useRef, useState } from 'react';
import { useDailyRecordBeds, useDailyRecordData } from '@/context/DailyRecordContext';
import { buildSpecialtyRoundCandidates, isCurrentSpecialtyCandidate,
  resolveSpecialtyRoundRule } from './specialtyRoundModel';
import { resolveSpecialtyJevLabel } from '@/services/specialty/specialtyJevClient';
import type { JevSuggestion, SpecialtyRoundSetup } from '@/services/specialty/specialtyJevClient';

type RoundResult = {
  state: 'consulting' | 'ready' | 'review' | 'failed' | 'outdated' | 'saved';
  requestId?: string;
  suggestion?: JevSuggestion;
};

export const useSpecialtyRound = (date: string, disabled: boolean) => {
  const beds = useDailyRecordBeds();
  const { record } = useDailyRecordData();
  const [candidates] = useState(() => buildSpecialtyRoundCandidates(beds, date));
  const [setup, setSetup] = useState<SpecialtyRoundSetup | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [results, setResults] = useState<Record<string, RoundResult>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const bedsRef = useRef(beds);
  const recordDateRef = useRef(record?.date);
  const disabledRef = useRef(disabled);
  const activeRef = useRef(true);
  const resultsRef = useRef(results);
  bedsRef.current = beds;
  recordDateRef.current = record?.date;
  disabledRef.current = disabled;
  resultsRef.current = results;
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    void import('@/services/specialty/specialtyJevClient')
      .then(service => service.loadSpecialtyRoundSetup())
      .then(next => {
        if (!activeRef.current) return;
        setSetup(next);
        if (next.policy.autoEnabled) {
          setChoices(current => Object.fromEntries(candidates.map(candidate => [candidate.key,
            current[candidate.key] || resolveSpecialtyRoundRule(next.policy.rules, candidate.cie10Code) || '',
          ])));
        }
      })
      .catch(async error => {
        if (!activeRef.current) return;
        const service = await import('@/services/specialty/specialtyJevClient');
        if (!activeRef.current) return;
        setCatalogError(`${service.describeSpecialtySetupError(error)} La asignación manual sigue disponible.`);
      });
  }, [candidates]);

  const catalog = setup?.policy.aiMode === 'consultative' ? setup.labels : null;
  const labels = useMemo(() => Object.fromEntries(candidates.map(candidate => [
    candidate.key,
    catalog ? resolveSpecialtyJevLabel(catalog, candidate.cie10Code) : null,
  ])), [candidates, catalog]);
  const eligible = useMemo(() => candidates.filter(candidate =>
    candidate.scope && candidate.cie10Code && labels[candidate.key] &&
    !(setup?.policy.autoEnabled &&
      setup.policy.rules.some(rule => rule.cie10Code === candidate.cie10Code))
  ), [candidates, labels, setup]);

  const setResult = (key: string, result: RoundResult) => {
    resultsRef.current = { ...resultsRef.current, [key]: result };
    setResults(resultsRef.current);
  };

  const consultAll = async () => {
    if (busy || disabledRef.current || !catalog || recordDateRef.current !== date) return;
    setBusy(true);
    setProgress('Preparando consultas…');
    try {
      const service = await import('@/services/specialty/specialtyJevClient');
      const pending = eligible.filter(candidate => !['ready', 'review', 'saved'].includes(
        resultsRef.current[candidate.key]?.state ?? ''
      ) && !choices[candidate.key]);
      for (const [index, candidate] of pending.entries()) {
        if (!activeRef.current) break;
        const { scope, key, cie10Code } = candidate;
        if (!scope || disabledRef.current || recordDateRef.current !== date ||
          !isCurrentSpecialtyCandidate(bedsRef.current, candidate)) {
          setResult(key, { state: 'outdated' });
          continue;
        }
        const requestId = resultsRef.current[key]?.requestId ?? crypto.randomUUID();
        setResult(key, { state: 'consulting', requestId });
        setProgress(`Consultando Jev ${index + 1} de ${pending.length}…`);
        try {
          const suggestion = await service.requestSpecialtySuggestion(scope, requestId, {
            code: cie10Code,
            canonicalLabel: labels[key]!,
          });
          if (!activeRef.current) break;
          if (!isCurrentSpecialtyCandidate(bedsRef.current, candidate) ||
            recordDateRef.current !== date) {
            setResult(key, { state: 'outdated' });
          } else {
            setResult(key, { state: suggestion.specialty ? 'ready' : 'review', requestId, suggestion });
            if (suggestion.specialty) {
              setChoices(current => ({ ...current, [key]: suggestion.specialty! }));
            }
          }
        } catch (error) {
          if (!activeRef.current) break;
          setResult(key, { state: 'failed',
            requestId: service.shouldRetainJevRequestId(error) ? requestId : undefined });
        }
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const saveAll = async () => {
    if (busy || disabledRef.current || recordDateRef.current !== date) return;
    const selected = candidates.filter(candidate =>
      candidate.scope && choices[candidate.key] &&
      resultsRef.current[candidate.key]?.state !== 'saved'
    );
    if (!selected.length) return;
    setBusy(true);
    try {
      const service = await import('@/services/specialty/specialtyJevClient');
      for (const [index, candidate] of selected.entries()) {
        if (!activeRef.current) break;
        setProgress(`Confirmando ${index + 1} de ${selected.length}…`);
        const scope = candidate.scope;
        if (!scope || disabledRef.current || recordDateRef.current !== date ||
          !isCurrentSpecialtyCandidate(bedsRef.current, candidate)) {
          setResult(candidate.key, { state: 'outdated' });
          continue;
        }
        const choice = choices[candidate.key];
        const previous = resultsRef.current[candidate.key];
        try {
          if (previous && ['ready', 'failed'].includes(previous.state) &&
              previous.suggestion?.specialty === choice &&
              previous.requestId) {
            await service.acceptSpecialtySuggestion(scope, previous.requestId, choice,
              candidate.decisionId);
          } else {
            await service.assignSpecialtyManually(scope, choice, candidate.decisionId);
          }
          if (!activeRef.current) break;
          setResult(candidate.key, { state: 'saved' });
        } catch {
          if (!activeRef.current) break;
          setResult(candidate.key, { ...previous, state: 'failed' });
        }
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return { candidates, catalog, labels,
    catalogError: catalogError || (setup?.policy.aiMode === 'off' ?
      'Jev aún no está configurado en este entorno. Un administrador puede hacerlo en «Reglas automáticas».' : ''),
    eligible, results, choices, busy, progress,
    rules: setup?.policy.autoEnabled ? setup.policy.rules : [],
    setChoices, consultAll, saveAll };
};
