import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, ShieldCheck } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { formatRut, isValidRut } from '@/utils/rutUtils';
import {
  assertEloisaPatientCodeFreshness,
  buildEloisaPatientDisplayName,
  parseEloisaPatientCode,
  type EloisaManualPatientPayload,
} from '../domain/eloisaPatientCode';

interface EmptyBedOption {
  id: string;
  label: string;
}

interface EloisaPatientCodeImportModalProps {
  isOpen: boolean;
  emptyBeds: EmptyBedOption[];
  onClose: () => void;
  onConfirm: (payload: EloisaManualPatientPayload, bedId: string) => Promise<string | null>;
}

const formatCapturedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-CL');
};

export const EloisaPatientCodeImportModal: React.FC<EloisaPatientCodeImportModalProps> = ({
  isOpen,
  emptyBeds,
  onClose,
  onConfirm,
}) => {
  const [code, setCode] = useState('');
  const [payload, setPayload] = useState<EloisaManualPatientPayload | null>(null);
  const [bedId, setBedId] = useState('');
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const validationSequence = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    validationSequence.current += 1;
    setCode('');
    setPayload(null);
    setBedId('');
    setError('');
    setValidating(false);
    setSaving(false);
  }, [isOpen]);

  const validate = useCallback(async () => {
    const validationId = ++validationSequence.current;
    const candidateCode = code;
    setValidating(true);
    setError('');
    setPayload(null);
    try {
      const parsed = await parseEloisaPatientCode(candidateCode);
      if (validationId !== validationSequence.current) return;
      assertEloisaPatientCodeFreshness(parsed);
      if (!isValidRut(parsed.rut)) {
        setError('El RUT contenido en el código no es válido.');
        return;
      }
      setPayload(parsed);
    } catch (caught) {
      if (validationId !== validationSequence.current) return;
      setError(caught instanceof Error ? caught.message : 'El código no pudo validarse.');
    } finally {
      if (validationId === validationSequence.current) setValidating(false);
    }
  }, [code]);

  const previewRows = useMemo(() => {
    if (!payload) return [];
    return [
      ['Paciente', buildEloisaPatientDisplayName(payload)],
      ['RUT', formatRut(payload.rut)],
      ['Nacimiento', payload.birthDate || 'No informado'],
      ['Sexo biológico', payload.biologicalSex || 'No informado'],
      [
        'Ingreso',
        `${payload.admissionDate}${payload.admissionTime ? ` · ${payload.admissionTime}` : ''}`,
      ],
      ['Diagnóstico', payload.diagnosis || 'No informado'],
      ['Dispositivos', payload.devices.length ? payload.devices.join(', ') : 'No informados'],
      ['Episodio Eloísa', payload.encounterId],
      ['Capturado', formatCapturedAt(payload.capturedAt)],
    ];
  }, [payload]);

  const confirm = useCallback(async () => {
    if (!payload || !bedId || saving) return;
    try {
      assertEloisaPatientCodeFreshness(payload);
    } catch (caught) {
      setPayload(null);
      setBedId('');
      setError(caught instanceof Error ? caught.message : 'El código ya no está vigente.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const failure = await onConfirm(payload, bedId);
      if (failure) setError(failure);
    } catch {
      setError(
        'No se pudo guardar el paciente. Intenta nuevamente; no se realizó una escritura parcial.'
      );
    } finally {
      setSaving(false);
    }
  }, [bedId, onConfirm, payload, saving]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={saving ? () => undefined : onClose}
      title="Importar código de Eloísa"
      icon={<ClipboardPaste size={18} />}
      size="2xl"
      variant="white"
      closeOnBackdrop={false}
      bodyClassName="space-y-4 p-5"
    >
      <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        Este código contiene datos clínicos codificados, no cifrados. Su verificación detecta daños
        accidentales, pero no autentica el origen. Compáralo con Eloísa antes de confirmar y evita
        conservarlo en notas o mensajería.
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-slate-700">Código copiado desde Eloísa</span>
        <textarea
          value={code}
          onChange={event => {
            validationSequence.current += 1;
            setCode(event.target.value);
            setPayload(null);
            setError('');
            setValidating(false);
          }}
          rows={4}
          autoComplete="off"
          spellCheck={false}
          disabled={validating || saving}
          className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
          placeholder="HHR-PACIENTE-1.…"
        />
      </label>

      <button
        type="button"
        onClick={validate}
        disabled={!code.trim() || validating || saving}
        className="inline-flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ShieldCheck size={16} />
        {validating ? 'Validando…' : 'Validar y revisar'}
      </button>

      {payload ? (
        <section
          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          aria-label="Vista previa del paciente"
        >
          <h3 className="mb-3 text-sm font-bold text-slate-800">Vista previa</h3>
          <dl className="grid grid-cols-1 gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
            {previewRows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </dt>
                <dd className="break-words text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-slate-700">Cama de destino</span>
        <select
          value={bedId}
          onChange={event => setBedId(event.target.value)}
          disabled={!payload || saving}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100"
        >
          <option value="">Selecciona y confirma una cama</option>
          {emptyBeds.map(bed => (
            <option key={bed.id} value={bed.id}>
              {bed.label}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-3 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-3 py-2 text-sm font-bold text-slate-500 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!payload || !bedId || saving}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Guardando…' : 'Confirmar ingreso'}
        </button>
      </div>
    </BaseModal>
  );
};
