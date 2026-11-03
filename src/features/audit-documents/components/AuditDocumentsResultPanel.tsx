import React, { useState } from 'react';
import { FileDown } from 'lucide-react';

import { displayRut } from '../domain/auditDocumentsRequest';
import type {
  AuditDocumentsPatientSummary,
  AuditDocumentsResult,
} from '../services/auditDocumentsBridge';
import { saveAuditZip } from '../services/saveAuditZip';

const patientStatus = (patient: AuditDocumentsPatientSummary): string => {
  if (patient.error) return `No se pudo consultar Eloísa: ${patient.error}`;
  const notes = [
    patient.failed > 0 ? `${patient.failed} no descargado(s)` : '',
    patient.reconstructed > 0
      ? `${patient.reconstructed} con días que Eloísa no genera, rehechos desde el resumen diario y un anexo HHR no oficial`
      : '',
    patient.incomplete > 0
      ? `${patient.incomplete} con parte de un día que Eloísa no genera faltante: ver 00 Resumen.csv`
      : '',
    patient.unverified > 0
      ? `${patient.unverified} sin fecha o RUT verificable en Eloísa: revisar allí`
      : '',
  ].filter(Boolean);
  if (patient.hospitalizations === 0 && notes.length === 0) {
    return 'Sin hospitalizaciones en el periodo';
  }
  return notes.length ? notes.join(' · ') : 'Completo';
};

const needsAttention = (patient: AuditDocumentsPatientSummary): boolean =>
  Boolean(patient.error) ||
  patient.failed > 0 ||
  patient.unverified > 0 ||
  patient.reconstructed > 0 ||
  patient.incomplete > 0;

export const AuditDocumentsResultPanel: React.FC<{ result: AuditDocumentsResult }> = ({
  result,
}) => {
  const summary = result.summary ?? [];
  const attention = summary.filter(needsAttention).length;
  const { archive, filename } = result;
  // Tied to this ZIP, so a new search starts clean.
  const [saveState, setSaveState] = useState<{ archive: Blob; savedAs?: string; error?: string }>();
  const current = saveState?.archive === archive ? saveState : undefined;
  const savedAs = current?.savedAs;
  const saveError = current?.error;
  const save = async () => {
    if (!archive || !filename) return;
    try {
      const name = await saveAuditZip(archive, filename);
      setSaveState(name ? { archive, savedAs: name } : { archive, savedAs });
    } catch {
      setSaveState({
        archive,
        error: 'No se pudo guardar el ZIP. Vuelve a intentarlo o elige otra carpeta.',
      });
    }
  };
  const missing = attention
    ? ` Revisa ${attention} RUT con documentos faltantes; el detalle también va en «00 Resumen.csv».`
    : '';
  return (
    <section className="mt-6 rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
      {result.ok ? (
        <div
          className={`rounded-xl p-3 text-sm font-semibold ${
            attention
              ? 'border border-amber-200 bg-amber-50 text-amber-800'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {archive ? (
            <>
              <p role="status">
                El ZIP tiene {result.documentCount} documento(s).{missing}{' '}
                {savedAs ? `Guardado como ${savedAs}.` : 'Elige dónde guardarlo.'}
              </p>
              <button
                type="button"
                onClick={() => void save()}
                className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-white transition hover:bg-black"
              >
                <FileDown size={14} />
                Descargar ZIP
              </button>
              {saveError && (
                <p role="alert" className="mt-2 text-rose-700">
                  {saveError}
                </p>
              )}
            </>
          ) : (
            <p role="status">
              El ZIP {filename} ya quedó en tu carpeta Descargas, con {result.documentCount}{' '}
              documento(s).{missing} Para elegir dónde guardarlo, actualiza la extensión Eloísa.
            </p>
          )}
        </div>
      ) : (
        <p
          role={result.cancelled ? 'status' : 'alert'}
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
        >
          {result.error || 'No se pudo completar la descarga.'}
        </p>
      )}

      {summary.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3">RUT</th>
              <th className="py-2 pr-3">Paciente</th>
              <th className="py-2 pr-3">Hospitalizaciones</th>
              <th className="py-2 pr-3">Documentos</th>
              <th className="py-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.map(patient => (
              <tr key={patient.run}>
                <td className="py-2 pr-3 font-mono">{displayRut(patient.run)}</td>
                <td className="py-2 pr-3">{patient.name || '—'}</td>
                <td className="py-2 pr-3">{patient.error ? '—' : patient.hospitalizations}</td>
                <td className="py-2 pr-3">{patient.error ? '—' : patient.downloaded}</td>
                <td
                  className={`py-2 ${needsAttention(patient) ? 'font-semibold text-rose-700' : 'text-slate-600'}`}
                >
                  {patientStatus(patient)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
