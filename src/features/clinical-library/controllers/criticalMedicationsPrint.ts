import { escapeHtml, type PrintableHtmlDocument } from '../services/printHtmlDocument';
import {
  CRITICAL_MEDICATIONS,
  CRITICAL_MEDICATIONS_SHEET,
  ROUTE_ALLOWANCE_LABELS,
  presentationFor,
  type AmpouleVariant,
  type CriticalMedication,
} from '../domain/criticalMedications';

const STYLES = `
@page { size: A4 landscape; margin: 9mm 10mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #0f172a; font-size: 8.4px; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 13px; margin: 0; letter-spacing: 0.02em; }
.sub { font-size: 8.5px; color: #475569; margin: 2px 0 6px; }
.notes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px 7px; margin-bottom: 5px; }
.legend { color: #475569; margin-bottom: 5px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #cbd5e1; padding: 3px 4px; vertical-align: top; text-align: left; }
th { background: #f1f5f9; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
td.c { text-align: center; white-space: nowrap; }
.name { font-weight: 700; }
.pres { color: #475569; }
.prep + .prep { margin-top: 2px; }
.lab { font-weight: 600; color: #0369a1; }
.conc { font-weight: 700; }
.grp td { background: #e2e8f0; font-weight: 700; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; }
.formulas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 6px 0 4px; font-weight: 600; }
.alerts { color: #7f1d1d; }
.foot { margin-top: 4px; color: #64748b; font-size: 7.5px; }
`;

const cell = (value: string): string => `<td>${escapeHtml(value)}</td>`;

const allowance = (medication: CriticalMedication): string =>
  `<td class="c">${escapeHtml(ROUTE_ALLOWANCE_LABELS[medication.vvp])}${medication.vvpNote ? `<br><span class="pres">${escapeHtml(medication.vvpNote)}</span>` : ''}</td><td class="c">${escapeHtml(ROUTE_ALLOWANCE_LABELS[medication.cvc])}</td><td>${escapeHtml(ROUTE_ALLOWANCE_LABELS[medication.bolus])}${medication.bolusText ? ` · ${escapeHtml(medication.bolusText)}` : ''}</td>`;

const preparations = (medication: CriticalMedication, variant: AmpouleVariant): string =>
  presentationFor(medication, variant)
    .preparations.map(
      item =>
        `<div class="prep">${item.label ? `<span class="lab">${escapeHtml(item.label)}:</span> ` : ''}${escapeHtml(item.text)}${item.concentration ? ` = <span class="conc">${escapeHtml(item.concentration)}</span>` : ''}</div>`
    )
    .join('');

export const buildCriticalMedicationsDocument = (
  variant: AmpouleVariant
): PrintableHtmlDocument => {
  const sheet = CRITICAL_MEDICATIONS_SHEET;
  const rows = CRITICAL_MEDICATIONS.map(
    medication =>
      `<tr><td><span class="name">${escapeHtml(medication.name)}</span><br><span class="pres">${escapeHtml(presentationFor(medication, variant).text)}</span></td>${allowance(medication)}<td>${preparations(medication, variant)}</td>${cell(medication.dose)}</tr>`
  ).join('');
  return {
    title: sheet.title,
    styles: STYLES,
    body: `<h1>${escapeHtml(sheet.title)} · adultos</h1>
<div class="sub">${escapeHtml(sheet.subtitle)} · ${escapeHtml(sheet.scope)} · dopamina y dobutamina en ampolla de ${variant === 'amp5' ? '5' : '10'} mL</div>
<div class="notes">${sheet.headerNotes.map(note => `<div>${escapeHtml(note)}</div>`).join('')}</div>
<div class="legend">${escapeHtml(sheet.legend)}</div>
<table><thead><tr><th>Medicamento · presentación</th><th>VVP</th><th>CVC</th><th>Bolo IV</th><th>Preparación rápida · concentración final</th><th>Dosis habitual · BIC</th></tr></thead><tbody>${rows}</tbody></table>
<div class="formulas">${sheet.formulas.map(formula => `<div>${escapeHtml(formula)}</div>`).join('')}</div>
<div class="alerts"><strong>Alertas:</strong> ${sheet.alerts.map(escapeHtml).join(' ')}</div>
<div class="foot">Fuentes: ${escapeHtml(sheet.sources)}</div>`,
  };
};
