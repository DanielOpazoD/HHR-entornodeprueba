import { useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import type { SpecialtyCatalogRule, SpecialtyRoundSetup } from '@/services/specialty/specialtyJevClient';

export const SpecialtyRulesWindow = ({ onClose }: { onClose: () => void }) => {
  const beds = useDailyRecordBeds();
  const [setup, setSetup] = useState<SpecialtyRoundSetup | null>(null);
  const [rules, setRules] = useState<SpecialtyCatalogRule[]>([]);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [code, setCode] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const dirty = Boolean(setup && (autoEnabled !== setup.policy.autoEnabled ||
    JSON.stringify(rules) !== JSON.stringify(setup.policy.rules)));

  useEffect(() => {
    mountedRef.current = true;
    void import('@/services/specialty/specialtyJevClient')
      .then(service => service.loadSpecialtyRoundSetup())
      .then(next => {
        if (!mountedRef.current) return;
        setSetup(next);
        setRules(next.policy.rules);
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
    const patients = Object.values(beds ?? {}).flatMap(bed => [bed, bed.clinicalCrib]);
    return Object.fromEntries(patients.filter(patient => patient?.cie10Code &&
      patient.cie10Description).map(patient => [patient!.cie10Code!.trim().toUpperCase(),
      patient!.cie10Description!.trim()]));
  }, [beds]);
  const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '');
  const codeLabel = setup?.labels[normalizedCode] || recordedLabels[normalizedCode];
  const suggestions = useMemo(() => {
    if (normalizedCode.length < 2 || !setup) return [];
    return Object.entries(setup.labels).filter(([entryCode, label]) =>
      entryCode.startsWith(normalizedCode) || label.toLowerCase().includes(code.toLowerCase())
    ).slice(0, 8);
  }, [code, normalizedCode, setup]);
  const isValidCode = /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(normalizedCode) &&
    Boolean(codeLabel);
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
    setCode('');
    setSpecialty('');
    setMessage('');
  };
  const changeRule = (id: string, value: string) => setRules(current => current.map(rule =>
    rule.id === id && (rule.kind === 'review' ? 'review' : rule.specialty) !== value
      ? { ...rule, kind: value === 'review' ? 'review' : 'assign',
      specialty: value === 'review' ? undefined : value, revision: rule.revision + 1 } : rule));
  const save = async (activateJev = false) => {
    if (!setup || busy || (!dirty && !activateJev)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const service = await import('@/services/specialty/specialtyJevClient');
      await service.saveSpecialtyRules(setup.policy, rules, autoEnabled, activateJev);
      const next = await service.loadSpecialtyRoundSetup();
      setSetup(next);
      setRules(next.policy.rules);
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
      <div className="rounded-lg border border-slate-200 p-3">
        <p className="mb-2 font-semibold">Añadir diagnóstico</p>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-44 flex-1">
            <input aria-label="Código CIE-10" value={code} disabled={busy}
              onChange={event => setCode(event.target.value)} placeholder="Ej.: J18.9"
              className="w-full rounded border border-slate-300 px-2 py-1.5" />
            {code && <span className="mt-1 block text-xs text-slate-600">
              {codeLabel || 'Código sin descripción CIE-10 registrada'}
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
        <button type="button" disabled={!dirty || busy} onClick={() => void save()}
          className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? 'Publicando…' : 'Guardar reglas'}
        </button>
      </div>
    </div>
  </BaseModal>;
};
