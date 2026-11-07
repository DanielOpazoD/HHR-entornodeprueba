import { escapeHtml as e } from '@/utils/htmlEscape';
import { formatDateDDMMYYYY, formatDateTimeCL } from '@/utils/dateDisplayUtils';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import {
  groupAdmissionAuthors,
  UNATTRIBUTED_DOCTOR,
  type AdmissionAuditEntry,
} from './admissionAuditModel';
import type { AdmissionAuditReport } from './useAdmissionAudit';

export const admissionVitalRows = (v: PatientVitalSigns | null): Array<[string, string]> => {
  if (!v) return [];
  const result: Array<[string, string]> = [];
  result.push([
    'PA',
    v.systolic == null && v.diastolic == null
      ? '—'
      : `${v.systolic ?? '—'}/${v.diastolic ?? '—'} mmHg`,
  ]);
  for (const [label, value, unit] of [
    ['PAM', v.meanArterialPressure, 'mmHg'],
    ['FC', v.heartRate, 'lpm'],
    ['FR', v.respiratoryRate, 'rpm'],
    ['SatO₂', v.spo2, '%'],
    ['Temperatura', v.temperature, '°C'],
    ['EVA', v.painEva, ''],
    ['HGT', v.hgt, 'mg/dL'],
  ] satisfies Array<[string, number | null | undefined, string]>)
    result.push([label, value == null ? '—' : `${value} ${unit}`.trim()]);
  return result;
};
const paragraphs = (
  entry: AdmissionAuditEntry
) => `${entry.readError ? `<p class="notice">Lectura no disponible: ${e(entry.readError)}</p>` : ''}
<h3>Primera evolución médica</h3>${entry.notes.length ? entry.notes.map(n => `<p>${e(n.author || 'Autor no informado')} · ${e(formatDateTimeCL(n.publishedAt))}</p><pre>${e(n.text)}</pre>`).join('') : '<p>Sin primera evolución médica verificable.</p>'}
<h3>Signos vitales del ingreso</h3>${
  entry.vitalReadError ? `<p class="notice">${e(entry.vitalReadError)}</p>` : ''
}${
  entry.vital
    ? `<p>${e(formatDateTimeCL(entry.vital.recordedAt))} · ${e(entry.vital.author || 'Autor no informado')}</p><dl>${admissionVitalRows(
        entry.vital
      )
        .map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`)
        .join(
          ''
        )}</dl>${entry.vital.observations ? `<pre>${e(entry.vital.observations)}</pre>` : ''}`
    : '<p>Sin toma verificable desde el ingreso.</p>'
}
<h3>Primeras indicaciones</h3>${entry.indications.length ? entry.indications.map(n => `<div class="order"><b>${e(n.title)}</b><pre>${e(n.text)}</pre><small>${e(n.author || 'Autor no informado')} · ${e(formatDateTimeCL(n.publishedAt))}</small></div>`).join('') : '<p>Sin indicaciones iniciales verificables.</p>'}
${entry.issues.map(issue => `<p class="notice">${e(issue)}</p>`).join('')}`;

/** Self-contained, escaped, network-free book with linked doctor/admission index and print CSS. */
export const buildAdmissionAuditBook = (
  report: AdmissionAuditReport,
  doctor: string | null
): string => {
  const entries = doctor ? report.entries.filter(row => row.doctor === doctor) : report.entries;
  if (!entries.some(row => !row.readError))
    throw new Error('No hay lecturas clínicas actualizadas para exportar.');
  const authorLabels = new Map(
    groupAdmissionAuthors(entries).map(({ name, count, total }) => [
      name,
      name === UNATTRIBUTED_DOCTOR
        ? `${name} · ${total} ${total === 1 ? 'episodio' : 'episodios'}`
        : `${name} · ${count}/${total} ingresos verificados`,
    ])
  );
  const doctors = [...authorLabels.keys()].sort((a, b) => a.localeCompare(b, 'es'));
  const unresolved = entries.filter(
    row => row.readError || row.vitalReadError || !row.notes.length || row.doctor === 'Sin atribuir'
  ).length;
  const period = `${formatDateDDMMYYYY(report.period.from)} al ${formatDateDDMMYYYY(report.period.to)}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Ingresos médicos · ${e(period)}</title><style>
body{max-width:1000px;margin:40px auto;padding:0 24px;color:#0f172a;font:14px/1.5 system-ui,sans-serif}h1{font-size:26px}h2{margin-top:32px}h3{font-size:15px;margin-bottom:4px}pre{max-width:80ch;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:4px 0 12px}a{color:#0f766e}small,.meta{color:#475569}.notice{color:#92400e}article{border-top:1px solid #cbd5e1;margin-top:28px;padding-top:12px}dl{display:flex;flex-wrap:wrap;gap:16px}dt{color:#475569}dd{margin:0;font-weight:600}.order{margin:12px 0}nav li{margin:6px 0}@media print{body{margin:0;max-width:none;padding:0}button{display:none}article,.doctor{break-before:page}.doctor>article:first-of-type{break-before:auto}h2,h3{break-after:avoid}a{color:inherit;text-decoration:none}@page{size:A4;margin:18mm}}
</style></head><body><header><h1>Libro de ingresos médicos</h1><p>${e(period)}${doctor ? ` · ${e(doctor)}` : ''}</p><p class="meta">Hospitalizaciones registradas en HHR. Atribución al autor documentado de la primera evolución médica vigente del episodio. ${report.indicationScope === 'first-day' ? 'Indicaciones del primer día con órdenes registradas.' : 'Primer conjunto de indicaciones con la misma fecha-hora.'} Horario de Rapa Nui.</p><p class="notice">${unresolved} episodio(s) del libro sin lectura, evolución o atribución verificable. Los recuentos corresponden a la documentación disponible.</p><button onclick="window.print()">Imprimir / guardar como PDF</button></header><nav id="indice" aria-label="Índice"><h2>Índice</h2><ol>${doctors
    .map(
      (name, i) =>
        `<li><a href="#medico-${i}">${e(authorLabels.get(name) ?? name)}</a><ol>${entries
          .filter(row => row.doctor === name)
          .map(
            row =>
              `<li><a href="#ingreso-${entries.indexOf(row)}">${e(formatDateDDMMYYYY(row.patient.admissionDate))} · ${e(row.patient.patientName)}</a></li>`
          )
          .join('')}</ol></li>`
    )
    .join('')}</ol></nav>${doctors
    .map(
      (name, i) =>
        `<section class="doctor" id="medico-${i}"><h2>${e(authorLabels.get(name) ?? name)}</h2>${entries
          .filter(row => row.doctor === name)
          .map(
            row =>
              `<article id="ingreso-${entries.indexOf(row)}"><h2>${e(row.patient.patientName)}</h2><p>${e(row.patient.document)} · Episodio ${e(row.patient.episodeId)} · Ingreso ${e(formatDateDDMMYYYY(row.patient.admissionDate))} ${e(row.patient.admissionTime || '(hora no informada)')}</p>${paragraphs(row)}<p><a href="#indice">Volver al índice</a></p></article>`
          )
          .join('')}</section>`
    )
    .join('')}</body></html>`;
};
