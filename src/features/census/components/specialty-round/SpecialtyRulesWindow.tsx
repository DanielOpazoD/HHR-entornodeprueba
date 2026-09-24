import { useEffect, useMemo, useRef, useState } from 'react';
import { History, ListChecks } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import type { SpecialtyCatalogRule, SpecialtyRoundSetup } from '@/services/specialty/specialtyJevClient';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import {
  isValidDiagnosisCode, normalizeDiagnosisCode, summarizeCurrentDiagnoses,
} from './specialtyRulesHistoryModel';
import { useSpecialtyRuleSources } from './useSpecialtyRuleSources';

export const SpecialtyRulesWindow = ({ date = getClinicalCalendarDateISO(), onClose }: {
  date?: string; onClose: () => void;
}) => {
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
  const { currentBeds, currentError, historyMonth, historyState, history,
    changeHistoryMonth, loadHistory } = useSpecialtyRuleSources(date, beds, today);
  const mountedRef = useRef(true);
  const dirty = Boolean(setup && (autoEnabled !== setup.policy.autoEnabled ||
    JSON.stringify(rules) !== JSON.stringify(setup.policy.rules) ||
    JSON.stringify(memory) !== JSON.stringify(setup.policy.memory)));
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
    return () => { mountedRef.current = false; };
  }, []);

  const recordedLabels = useMemo(() => {
    const patients = Object.values(currentBeds ?? {}).flatMap(bed => [bed, bed.clinicalCrib]);
    return Object.fromEntries(patients.filter(patient => patient?.cie10Code &&
      patient.cie10Description).map(patient => [patient!.cie10Code!.trim().toUpperCase(),
      patient!.cie10Description!.trim()]));
  }, [currentBeds]);
  const currentDiagnoses = useMemo(() => summarizeCurrentDiagnoses(currentBeds), [currentBeds]);
  const normalizedCode = normalizeDiagnosisCode(code);
  const codeLabel = setup?.labels[normalizedCode] || recordedLabels[normalizedCode];
  const suggestions = useMemo(() => {
    if (normalizedCode.length < 2 || !setup) return [];
    return Object.entries(setup.labels).filter(([entryCode, label]) =>
      entryCode.startsWith(normalizedCode) || label.toLowerCase().includes(code.toLowerCase())
    ).slice(0, 8);
  }, [code, normalizedCode, setup]);
  const isValidCode = isValidDiagnosisCode(normalizedCode);
  const addRule = () => {
    if (!isValidCode || !specialty || rules.some(rule => rule.cie10Code === normalizedCode) ||
      rules.length >= 128) return;
    setRules(current => [...current, {
      id: `clinical_${normalizedCode.replace('.', '_')}`,
      kind: specialty === 'review' ? 'review' : 'assign',
      cie10Code: normalizedCode,
      ...(specialty === 'review' ? {} : { specialty }),
      scope: 'all', revision: 1,
    }]);
    setMemory(current => current.filter(item => item.cie10Code !== normalizedCode ||
      item.specialty === specialty));
    setCode('');
    setSpecialty('');
    setMessage('');
    setError('');
  };
  const clearConflictingMemory = (selectedCode: string, selectedSpecialty: string) =>
    setMemory(current => current.filter(item => item.cie10Code !== selectedCode ||
      item.specialty === selectedSpecialty));
  const changeRule = (id: string, value: string) => {
    const selectedRule = rules.find(rule => rule.id === id);
    if (!selectedRule) return;
    setRules(current => current.map(rule => {
      if (rule.id !== id || (rule.kind === 'review' ? 'review' : rule.specialty) === value) {
        return rule;
      }
      return value === 'review'
        ? { id: rule.id, kind: 'review', cie10Code: rule.cie10Code,
          scope: rule.scope, revision: rule.revision + 1 }
        : { ...rule, kind: 'assign', specialty: value, revision: rule.revision + 1 };
    }));
    if (value !== 'review') clearConflictingMemory(selectedRule.cie10Code, value);
    setError('');
  };
  const stageAssociation = (selectedCode: string, selectedSpecialty: string) => {
    if (!isValidDiagnosisCode(selectedCode) || !SPECIALTY_OPTIONS.includes(selectedSpecialty as never) ||
      selectedSpecialty === 'Otro') return;
    const existing = rules.find(rule => rule.cie10Code === selectedCode);
    if (existing) changeRule(existing.id, selectedSpecialty);
    else if (rules.length < 128) {
      setRules(current => [...current, {
        id: `clinical_${selectedCode.replace('.', '_')}`, kind: 'assign',
        cie10Code: selectedCode, specialty: selectedSpecialty, scope: 'all', revision: 1,
      }]);
      clearConflictingMemory(selectedCode, selectedSpecialty);
    }
    else return;
    setMessage(`Asociación ${selectedCode} → ${selectedSpecialty} preparada. Guarda las reglas para publicarla.`);
    setError('');
  };
  const changeMemory = (id: string, value: string) => {
    const selected = memory.find(rule => rule.id === id);
    if (!selected) return;
    const explicit = rules.find(rule => rule.cie10Code === selected.cie10Code);
    if (explicit && (explicit.kind === 'review' ? 'review' : explicit.specialty) !== value) {
      setError(`La regla explícita de ${selected.cie10Code} tiene otra decisión. Edítala primero.`);
      return;
    }
    setError('');
    setMemory(current => current.map(rule => {
      if (rule.id !== id || (rule.kind === 'review' ? 'review' : rule.specialty) === value) {
        return rule;
      }
      return value === 'review'
        ? { id: rule.id, kind: 'review', cie10Code: rule.cie10Code,
          scope: rule.scope, revision: rule.revision + 1 }
        : { ...rule, kind: 'assign', specialty: value, revision: rule.revision + 1 };
    }));
  };
  const save = async (activateJev = false) => {
    if (!setup || busy || (memoryPendingDeploy && setup.policy.memoryEnabled) ||
      (!dirty && !activateJev)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const service = await import('@/services/specialty/specialtyJevClient');
      await service.saveSpecialtyRules(setup.policy, rules, autoEnabled, activateJev, memory);
      const next = await service.loadSpecialtyRoundSetup();
      setSetup(next);
      setRules(next.policy.rules);
      setMemory(next.policy.memory);
      setAutoEnabled(next.policy.autoEnabled);
      setMessage(activateJev ? 'Piloto Jev configurado. Las consultas siguen requiriendo confirmación.' :
        'Reglas publicadas. Se aplicarán a episodios pendientes en las próximas actualizaciones clínicas.');
    } catch {
      setError('No se publicaron las reglas. Actualiza el panel y comprueba permisos y revisión del catálogo.');
    } finally { setBusy(false); }
  };

  return <BaseModal isOpen onClose={() => { if (!busy) onClose(); }} closeOnBackdrop={false}
    size="3xl" title="Reglas automáticas de especialidad"
    icon={<ListChecks size={20} className="text-teal-700" aria-hidden="true" />}>
    <div className="space-y-4 text-sm text-slate-700">
      <p>Relaciona códigos CIE-10 exactos con una especialidad. Las reglas se aplican sólo a
        episodios pendientes; una decisión ya confirmada no se reemplaza.</p>
      {memoryPendingDeploy && <p role="status" className="rounded-lg bg-amber-50 p-2 text-amber-900">
        El servidor aún no entrega asociaciones recordadas. Se conservarán intactas al guardar
        reglas; la edición de memoria estará disponible tras actualizar Firebase.
      </p>}
      <label className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 p-3">
        <input type="checkbox" checked={autoEnabled} disabled={busy || !setup}
          onChange={event => setAutoEnabled(event.target.checked)} />
        <span><strong>Activar asociación automática</strong>
          <span className="block text-xs">Se aplicará en las próximas actualizaciones clínicas del día vigente.</span>
        </span>
      </label>
      <div className="max-h-60 space-y-2 overflow-auto" aria-label="Reglas configuradas">
        {rules.map(rule => <div key={rule.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
          <strong className="w-16">{rule.cie10Code}</strong>
          <span className="min-w-0 flex-1 truncate text-xs" title={setup?.labels[rule.cie10Code] ||
            recordedLabels[rule.cie10Code]}>{setup?.labels[rule.cie10Code] ||
            recordedLabels[rule.cie10Code] || 'Descripción no disponible'}</span>
          <select aria-label={`Regla para ${rule.cie10Code}`} value={rule.kind === 'review' ?
            'review' : rule.specialty} disabled={busy} onChange={event =>
            changeRule(rule.id, event.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1.5">
            {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option =>
              <option key={option} value={option}>{option}</option>)}
            <option value="review">Revisión manual</option>
          </select>
          <button type="button" disabled={busy} onClick={() => setRules(current =>
            current.filter(item => item.id !== rule.id))}
            className="rounded px-2 py-1 text-red-700 hover:bg-red-50">Quitar</button>
        </div>)}
        {!rules.length && <p className="rounded-lg bg-slate-50 p-3 text-slate-500">
          Aún no hay asociaciones automáticas.
        </p>}
      </div>
      <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
        aria-label="Diagnósticos de pacientes hospitalizados">
        <h3 className="font-semibold text-slate-900">Diagnósticos de pacientes hospitalizados</h3>
        <p className="mb-3 text-xs text-slate-600">Censo vigente · {today}. La especialidad actual
          es sólo una referencia clínica: revísala antes de preparar la regla. Nada se publica
          hasta Guardar reglas.</p>
        {currentError && <p role="alert" className="text-amber-800">
          No se pudo leer el censo vigente. Reabre el panel para reintentar.</p>}
        {!currentError && !currentBeds && <p className="text-slate-500">Leyendo censo vigente…</p>}
        {!currentError && currentBeds && !currentDiagnoses.length &&
          <p className="text-slate-500">No hay diagnósticos CIE-10 en pacientes hospitalizados.</p>}
        <div className="max-h-56 space-y-2 overflow-auto">
          {currentDiagnoses.map(diagnosis => {
            const selected = selectedSpecialties[diagnosis.code] ?? diagnosis.suggestedSpecialty;
            const existing = rules.find(rule => rule.cie10Code === diagnosis.code);
            return <div key={diagnosis.code}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
              <strong className="w-16">{diagnosis.code}</strong>
              <span className="min-w-32 flex-1 text-xs">{setup?.labels[diagnosis.code] ||
                diagnosis.description || 'Descripción no disponible'}
                <span className="block text-slate-500">{diagnosis.patients} {diagnosis.patients === 1
                  ? 'paciente' : 'pacientes'} · {existing ? 'regla existente' : 'sin regla'}</span>
              </span>
              <select aria-label={`Especialidad para ${diagnosis.code}`} value={selected}
                disabled={busy || !setup} onChange={event => setSelectedSpecialties(current =>
                  ({ ...current, [diagnosis.code]: event.target.value }))}
                className="rounded border border-slate-300 bg-white px-2 py-1.5">
                <option value="">Elegir especialidad</option>
                {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option =>
                  <option key={option} value={option}>{option}</option>)}
              </select>
              <button type="button" disabled={!selected || busy || !setup ||
                (!existing && rules.length >= 128)}
                onClick={() => stageAssociation(diagnosis.code, selected)}
                className="rounded border border-teal-300 px-2 py-1.5 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50">
                {existing ? 'Actualizar regla' : 'Añadir regla'}
              </button>
            </div>;
          })}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 p-3"
        aria-label="Asociaciones históricas">
        <h3 className="flex items-center gap-1.5 font-semibold text-slate-900">
          <History size={16} aria-hidden="true" /> Asociaciones históricas</h3>
        <p className="mb-3 text-xs text-slate-600">Una especialidad observada junto a un CIE-10
          en censos anteriores no demuestra que sea la regla correcta. Revísala antes de publicarla.
          El historial clínico no se modifica aquí.</p>
        {memory.length > 0 && <div className="mb-3 max-h-44 space-y-2 overflow-auto">
          <p className="text-xs font-semibold text-slate-700">Asociaciones recordadas ·
            {setup?.policy.memoryEnabled ? ' activas' : ' inactivas'}</p>
          {memory.map(item => <div key={item.id}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
            <strong className="w-16">{item.cie10Code}</strong>
            <span className="min-w-0 flex-1 text-xs">{setup?.labels[item.cie10Code] ||
              'Descripción no disponible'}</span>
            <select aria-label={`Asociación recordada para ${item.cie10Code}`}
              value={item.kind === 'review' ? 'review' : item.specialty}
              disabled={busy || memoryPendingDeploy}
              onChange={event =>
                changeMemory(item.id, event.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5">
              {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option =>
                <option key={option} value={option}>{option}</option>)}
              <option value="review">Revisión manual</option>
            </select>
          </div>)}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="specialty-history-month">Mes del censo</label>
          <input id="specialty-history-month" type="month" value={historyMonth}
            max={today.slice(0, 7)} disabled={historyState === 'loading'}
            onChange={event => changeHistoryMonth(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5" />
          <button type="button" disabled={historyState === 'loading'}
            onClick={() => void loadHistory()}
            className="rounded border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">
            {historyState === 'loading' ? 'Leyendo…' : 'Ver diagnósticos históricos'}
          </button>
        </div>
        {historyState === 'error' && <p role="alert" className="mt-2 text-amber-800">
          No se pudo leer ese mes desde el servidor. Reintenta.</p>}
        {historyState === 'ready' && !history.length &&
          <p className="mt-2 text-slate-500">Sin asociaciones CIE-10 y especialidad en ese mes.</p>}
        {history.length > 0 && <div className="mt-3 max-h-56 space-y-2 overflow-auto">
          {history.map(item => <div key={`${item.code}|${item.specialty}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
            <strong className="w-16">{item.code}</strong>
            <span className="min-w-32 flex-1 text-xs">{setup?.labels[item.code] ||
              'Descripción no disponible'}
              <span className="block text-slate-500">{item.specialty} · {item.observations}
                {' '}{item.observations === 1 ? 'observación' : 'observaciones'} ·
                {' '}última {item.lastDate}</span>
            </span>
            <button type="button" disabled={busy || !setup ||
              (!rules.some(rule => rule.cie10Code === item.code) && rules.length >= 128)}
              onClick={() => stageAssociation(item.code, item.specialty)}
              className="rounded border border-teal-300 px-2 py-1.5 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50">
              Usar como regla
            </button>
          </div>)}
        </div>}
      </section>
      <div className="rounded-lg border border-slate-200 p-3">
        <p className="mb-2 font-semibold">Añadir diagnóstico</p>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-44 flex-1">
            <input aria-label="Código CIE-10" value={code} disabled={busy}
              onChange={event => setCode(event.target.value)} placeholder="Ej.: J18.9"
              className="w-full rounded border border-slate-300 px-2 py-1.5" />
            {code && <span className="mt-1 block text-xs text-slate-600">
              {codeLabel || (isValidCode
                ? 'Código válido sin descripción en el catálogo; la regla usará este código exacto.'
                : 'Introduce un código CIE-10 válido.')}
            </span>}
            {suggestions.length > 0 && <div className="mt-1 max-h-28 overflow-auto rounded border border-slate-200 bg-white">
              {suggestions.map(([suggestedCode, label]) => <button key={suggestedCode}
                type="button" onClick={() => setCode(suggestedCode)}
                className="block w-full px-2 py-1 text-left text-xs hover:bg-teal-50">
                <strong>{suggestedCode}</strong> · {label}
              </button>)}
            </div>}
          </div>
          <select aria-label="Especialidad de la nueva regla" value={specialty} disabled={busy}
            onChange={event => setSpecialty(event.target.value)}
            className="h-9 rounded border border-slate-300 bg-white px-2">
            <option value="">Elegir especialidad</option>
            {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option =>
              <option key={option} value={option}>{option}</option>)}
            <option value="review">Revisión manual</option>
          </select>
          <button type="button" disabled={!isValidCode || !specialty || busy ||
            rules.some(rule => rule.cie10Code === normalizedCode)} onClick={addRule}
            className="h-9 rounded bg-teal-700 px-3 font-semibold text-white disabled:opacity-50">
            Añadir
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {message && <p role="status" className="text-teal-800">{message}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" disabled={busy} onClick={onClose}
          className="rounded border border-slate-300 px-4 py-2">Cerrar</button>
        {setup?.policy.aiMode === 'off' && <button type="button" disabled={busy}
          onClick={() => void save(true)}
          className="rounded border border-teal-700 px-4 py-2 font-semibold text-teal-800 disabled:opacity-50">
          Configurar piloto Jev
        </button>}
        <button type="button" disabled={!dirty || busy ||
          (memoryPendingDeploy && setup?.policy.memoryEnabled)} onClick={() => void save()}
          className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? 'Publicando…' : 'Guardar reglas'}
        </button>
      </div>
    </div>
  </BaseModal>;
};
