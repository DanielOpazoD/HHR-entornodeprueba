/**
 * hhr-lab-request-styles.js
 *
 * Capa visual de la solicitud de exámenes y del acceso a Syslab dentro del Centro HHR.
 *
 * Vive aparte de `hhr-center-styles.js` porque esa hoja concentraba todas las superficies
 * del Centro y sus reglas de laboratorio terminaron escritas en líneas únicas de cientos de
 * caracteres para no crecer de tamaño. Separarla permite escribirlas de forma legible sin
 * subir ningún presupuesto y deja el estilo de esta pantalla donde se busca.
 *
 * Las reglas son las mismas y se instalan después de la hoja del Centro, de modo que el
 * orden de cascada se conserva.
 */
(function (root) {
  'use strict';
  if (root.HhrLabRequestStyles) return;

  const css = `
      #hhr-prescription-print-modal .hhr-syslab-access { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; padding: 10px 12px; border: 1px solid #ead18d; border-radius: 9px; background: #fffaf0; }
      #hhr-prescription-print-modal .hhr-syslab-access[hidden] { display: none; }
      #hhr-prescription-print-modal .hhr-syslab-access > div { display: grid; gap: 3px; min-width: 0; }
      #hhr-prescription-print-modal .hhr-syslab-access strong { color: #594719; font-size: 11.5px; }
      #hhr-prescription-print-modal .hhr-syslab-access-message { color: #765c15; font-size: 10.5px; line-height: 1.35; }
      #hhr-prescription-print-modal .hhr-syslab-access-form { display: flex; gap: 7px; flex: 1 1 420px; justify-content: flex-end; }
      #hhr-prescription-print-modal .hhr-syslab-access-form input { width: min(180px,30%); min-width: 110px; padding: 0 9px; border: 1px solid #d7c58f; border-radius: 7px; background: #fff; color: var(--hhr-ink-900); font: inherit; }
      #hhr-prescription-print-modal .hhr-labreq-content { padding: 18px clamp(32px,3vw,44px) 32px; }
      #hhr-prescription-print-modal .hhr-labreq-count { color: #64716f; font-size: 11.5px; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-labreq-patient { display: grid; gap: 9px; margin-bottom: 12px; padding: 11px 12px; border: 1px solid #dbe8e5; border-radius: 10px; background: #f6fbfa; }
      #hhr-prescription-print-modal .hhr-labreq-patient-source { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      #hhr-prescription-print-modal .hhr-labreq-patient-summary { color: #46534f; font-size: 11.5px; line-height: 1.4; }
      #hhr-prescription-print-modal .hhr-labreq-manual-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px; }
      #hhr-prescription-print-modal .hhr-labreq-manual-fields label { display: grid; gap: 4px; color: #55635f; font-size: 10.5px; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-labreq-manual-fields .is-wide { grid-column: span 2; }
      #hhr-prescription-print-modal .hhr-labreq-manual-fields input { min-width: 0; height: 34px; border: 1px solid #cfd9d7; border-radius: 7px; padding: 0 9px; background: #fff; color: #263331; font: inherit; font-size: 12px; }
      #hhr-prescription-print-modal .hhr-labreq-meta {
        display: grid; gap: 7px; margin: 0 0 14px; padding: 10px 12px; border: 1px solid #e3eae8;
        border-radius: 10px; background: #f8fbfa;
      }
      #hhr-prescription-print-modal .hhr-labreq-meta-group { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
      #hhr-prescription-print-modal .hhr-labreq-meta-label { min-width: 84px; color: #55635f; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
      #hhr-prescription-print-modal .hhr-labreq-chip {
        display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid #d7e0de;
        border-radius: 999px; background: #fff; color: #46534f; cursor: pointer; font-size: 11px; font-weight: 600;
      }
      #hhr-prescription-print-modal .hhr-labreq-chip:has(input:checked) { border-color: var(--hhr-teal-500); background: #e8f4f1; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-labreq-chip input { width: 13px; height: 13px; margin: 0; accent-color: var(--hhr-teal-500); }
      #hhr-prescription-print-modal .hhr-labreq-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      #hhr-prescription-print-modal .hhr-labreq-column { display: grid; gap: 12px; align-content: start; }
      #hhr-prescription-print-modal .hhr-labreq-section { border: 1px solid #dfe7e5; border-radius: 9px; background: #fff; overflow: hidden; }
      #hhr-prescription-print-modal .hhr-labreq-section header {
        padding: 5px 9px; border-bottom: 1px solid #e6ecea; background: #f6f9f8; color: #45524f;
        font-size: 10.5px; font-weight: 700; text-align: center;
      }
      #hhr-prescription-print-modal .hhr-labreq-section header small { display: block; color: #7c8886; font-size: 8.5px; font-weight: 600; }
      #hhr-prescription-print-modal .hhr-labreq-exam { display: flex; align-items: center; gap: 7px; padding: 3px 9px; cursor: pointer; color: #3d4a47; font-size: 10.5px; }
      #hhr-prescription-print-modal .hhr-labreq-exam:hover { background: #f7fbfa; }
      #hhr-prescription-print-modal .hhr-labreq-exam input { width: 14px; height: 14px; margin: 0; flex: 0 0 auto; }
      #hhr-prescription-print-modal .hhr-labreq-footer { display: flex; gap: 8px; margin-top: 12px; }
      #hhr-prescription-print-modal .hhr-labreq-footer input { flex: 1; }
      @media (max-width: 900px) {
        #hhr-prescription-print-modal .hhr-labreq-grid { grid-template-columns: 1fr; }
        #hhr-prescription-print-modal .hhr-labreq-manual-fields { grid-template-columns: 1fr 1fr; }
      }
      @media (max-width: 760px) {
        #hhr-prescription-print-modal .hhr-labreq-content { padding: 12px 16px 18px; }
        #hhr-prescription-print-modal .hhr-syslab-access { align-items: stretch; flex-direction: column; }
        #hhr-prescription-print-modal .hhr-syslab-access-form { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-start; }
        #hhr-prescription-print-modal .hhr-syslab-access-form input { flex: 1 1 140px; width: auto; }
      }
  `;

  root.HhrLabRequestStyles = Object.freeze({ css });
})(typeof globalThis !== 'undefined' ? globalThis : self);
