import React from 'react';
import { formatDateDDMMYYYY, formatDateTimeCL } from '@/utils/dateDisplayUtils';
import { admissionVitalRows } from './admissionAuditBook';
import type { AdmissionAuditEntry } from './admissionAuditModel';

export const AdmissionAuditDetails = ({ entry }: { entry: AdmissionAuditEntry }) => (
  <article className="rounded-lg border border-slate-200 bg-white p-4">
    <header className="mb-4">
      <h2 className="text-base font-semibold text-slate-900">{entry.patient.patientName}</h2>
      <p className="text-xs text-slate-500">
        {entry.patient.document} · Episodio {entry.patient.episodeId} · Ingreso{' '}
        {formatDateDDMMYYYY(entry.patient.admissionDate)}{' '}
        {entry.patient.admissionTime || '(hora no informada)'}
      </p>
    </header>
    {entry.readError && (
      <p role="alert" className="mb-4 text-sm text-amber-800">
        No se pudo leer este ingreso: {entry.readError}
      </p>
    )}
    <section aria-label="Primera evolución médica">
      <h3 className="text-sm font-semibold text-slate-700">Primera evolución médica</h3>
      {entry.notes.length ? (
        entry.notes.map((note, i) => (
          <div key={`${note.id}:${i}`} className="mt-2">
            <p className="text-xs text-slate-500">
              {note.author || 'Autor no informado'} · {formatDateTimeCL(note.publishedAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words max-w-prose text-sm leading-relaxed text-slate-800">
              {note.text}
            </p>
          </div>
        ))
      ) : (
        <p className="mt-1 text-sm text-slate-500">Sin evolución médica verificable.</p>
      )}
    </section>
    <section
      aria-label="Signos vitales del ingreso"
      className="mt-5 border-t border-slate-100 pt-3"
    >
      <h3 className="text-sm font-semibold text-slate-700">Signos vitales del ingreso</h3>
      {entry.vitalReadError && (
        <p role="alert" className="mt-1 text-sm text-amber-800">
          {entry.vitalReadError}
        </p>
      )}
      {entry.vital ? (
        <>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTimeCL(entry.vital.recordedAt)} ·{' '}
            {entry.vital.author || 'Autor no informado'}
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {admissionVitalRows(entry.vital).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
          {entry.vital.observations && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
              {entry.vital.observations}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Sin toma verificable desde el ingreso.</p>
      )}
    </section>
    <section aria-label="Primeras indicaciones" className="mt-5 border-t border-slate-100 pt-3">
      <h3 className="text-sm font-semibold text-slate-700">Primeras indicaciones</h3>
      {entry.indications.length ? (
        <ul className="divide-y divide-slate-100">
          {entry.indications.map((n, i) => (
            <li key={`${n.kind}:${n.id}:${i}`} className="py-2 text-sm">
              <p className="font-medium text-slate-800">{n.title}</p>
              <p className="whitespace-pre-wrap break-words text-slate-700">{n.text}</p>
              <p className="text-xs text-slate-500">
                {n.author || 'Autor no informado'} · {formatDateTimeCL(n.publishedAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Sin indicaciones iniciales verificables.</p>
      )}
    </section>
    {entry.issues.length > 0 && (
      <ul className="mt-4 space-y-1 text-xs text-amber-800">
        {entry.issues.map(issue => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    )}
  </article>
);
