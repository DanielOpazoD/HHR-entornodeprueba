import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { formatAge } from '@/utils/ageDisplayUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

export interface PrintableIndication {
  title: string;
  text: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, character => HTML_ESCAPES[character] ?? character);

const STYLE = `
  @page { size: letter; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 11.5pt; margin: 0; }
  header { border-bottom: 1.5pt solid #0f172a; padding-bottom: 6pt; margin-bottom: 10pt; }
  .hospital { font-size: 9pt; color: #475569; text-transform: uppercase; letter-spacing: .04em; }
  h1 { font-size: 15pt; margin: 2pt 0 0; }
  dl { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 3pt 10pt; margin: 0 0 12pt; font-size: 10.5pt; }
  dt { color: #475569; }
  dd { margin: 0; font-weight: 600; }
  ol { margin: 0; padding-left: 18pt; }
  li { padding: 4pt 0; border-bottom: .5pt solid #cbd5e1; break-inside: avoid; }
  li strong { display: block; }
  li span { display: block; color: #334155; font-size: 10.5pt; }
  footer { margin-top: 14pt; font-size: 8.5pt; color: #475569; }
`;

/**
 * The day's active indications as one printable page. It is a copy of what Ficha Médico shows;
 * the official record stays in Eloísa, and suspended orders are left out.
 */
export const buildIndicationsPrintHtml = ({
  patient,
  date,
  indications,
  printedAt,
}: {
  patient: ClinicalExplorerPatient;
  /** Hospital calendar day, `YYYY-MM-DD`. */
  date: string;
  indications: readonly PrintableIndication[];
  printedAt: Date;
}): string => {
  const { data, bedId } = patient;
  const printed = calendarStampInClinicalTimeZone(printedAt);
  const field = (label: string, value: string): string =>
    `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd>`;
  const items = indications
    .map(
      entry =>
        `<li><strong>${escapeHtml(entry.title)}</strong>${
          entry.text ? `<span>${escapeHtml(entry.text)}</span>` : ''
        }</li>`
    )
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Indicaciones ${escapeHtml(
    formatDateDDMMYYYY(date)
  )}</title><style>${STYLE}</style></head><body>
<header><div class="hospital">Hospital Hanga Roa · Hospitalizados</div><h1>Indicaciones médicas del ${escapeHtml(
    formatDateDDMMYYYY(date)
  )}</h1></header>
<dl>${field('Paciente', data.patientName.trim())}${field('RUT', data.rut.trim())}${field(
    'Edad',
    formatAge(data.age)
  )}${field('Cama', bedId)}${field('Ingreso', formatDateDDMMYYYY(data.admissionDate))}${field(
    'Diagnóstico',
    data.pathology.trim()
  )}</dl>
<ol>${items}</ol>
<footer>Copia de las indicaciones vigentes en Eloísa · Ficha Médico, impresa desde HHR el ${escapeHtml(
    formatDateDDMMYYYY(printed.iso)
  )} a las ${escapeHtml(printed.hhmm)} (hora de Rapa Nui). No incluye indicaciones suspendidas. El registro oficial está en Eloísa.</footer>
</body></html>`;
};

/**
 * Prints a self-contained page from a hidden frame, so the census page itself is not printed.
 * An abort before the frame loads (session or patient change) removes it and prints nothing.
 */
export const printHtmlDocument = (html: string, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Impresión cancelada.', 'AbortError'));
      return;
    }
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '1px',
      height: '1px',
      opacity: '0.01',
      pointerEvents: 'none',
      border: '0',
    });
    let loadTimer: number | undefined;
    let removeTimer: number | undefined;
    const remove = (): void => {
      if (loadTimer !== undefined) clearTimeout(loadTimer);
      if (removeTimer !== undefined) clearTimeout(removeTimer);
      signal?.removeEventListener('abort', onAbort);
      frame.removeEventListener('load', onLoad);
      frame.removeEventListener('error', onError);
      frame.remove();
    };
    function fail(error: Error): void {
      remove();
      reject(error);
    }
    function onAbort(): void {
      fail(new DOMException('Impresión cancelada.', 'AbortError'));
    }
    function onError(): void {
      fail(new Error('print_unavailable'));
    }
    function onLoad(): void {
      const frameWindow = frame.contentWindow;
      if (signal?.aborted || !frameWindow) {
        onError();
        return;
      }
      if (loadTimer !== undefined) clearTimeout(loadTimer);
      // Past this point the dialog belongs to the person who asked for it.
      signal?.removeEventListener('abort', onAbort);
      frameWindow.addEventListener('afterprint', () => setTimeout(remove, 0), { once: true });
      // Some browsers return from print() before the dialog closes: keep the frame meanwhile.
      removeTimer = window.setTimeout(remove, 120_000);
      try {
        frameWindow.focus();
        frameWindow.print();
        resolve();
      } catch {
        onError();
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    frame.addEventListener('load', onLoad, { once: true });
    frame.addEventListener('error', onError, { once: true });
    // A local srcdoc that never loads must release the action so the person can retry.
    loadTimer = window.setTimeout(() => fail(new Error('print_load_timeout')), 30_000);
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
