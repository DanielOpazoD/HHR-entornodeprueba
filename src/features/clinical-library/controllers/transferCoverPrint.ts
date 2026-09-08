import { escapeHtml, type PrintableHtmlDocument } from '../services/printHtmlDocument';
import {
  TRANSFER_COVER_CONTENTS,
  formatCoverDate,
  type TransferCoverData,
} from '../domain/transferCover';

const PAGE_SIZE: Record<TransferCoverData['paper'], string> = {
  oficio: 'legal landscape',
  carta: 'letter landscape',
};

const STYLES = (paper: TransferCoverData['paper']): string => `
@page { size: ${PAGE_SIZE[paper]}; margin: 14mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { display: flex; flex-direction: column; height: 100vh; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0369a1; padding-bottom: 10px; }
.brand { display: flex; align-items: center; gap: 14px; }
.brand img { height: 52px; width: auto; }
.brand .name { font-size: 15px; font-weight: 700; letter-spacing: 0.02em; }
.brand .service { font-size: 12px; color: #475569; margin-top: 2px; }
.kind { font-size: 28px; font-weight: 800; letter-spacing: 0.14em; color: #0369a1; text-transform: uppercase; }
.patient { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 10px; }
.patient .label { font-size: 12px; letter-spacing: 0.24em; text-transform: uppercase; color: #64748b; }
.patient .name { font-size: 46px; font-weight: 800; line-height: 1.1; max-width: 90%; }
.patient .rut { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; color: #1e293b; }
.patient .meta { font-size: 14px; color: #475569; margin-top: 4px; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px 24px; border-top: 1px solid #cbd5e1; padding-top: 12px; }
.field .k { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #64748b; }
.field .v { font-size: 15px; font-weight: 600; margin-top: 2px; min-height: 20px; }
.contents { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; margin-top: 4px; }
.contents .item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #1e293b; }
.contents .box { width: 14px; height: 14px; border: 1.5px solid #334155; border-radius: 3px; flex: none; }
.foot { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 10px; }
`;

const field = (label: string, value: string): string =>
  `<div class="field"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`;

export const buildTransferCoverDocument = (cover: TransferCoverData): PrintableHtmlDocument => {
  const contents = TRANSFER_COVER_CONTENTS.map(
    item => `<div class="item"><span class="box"></span>${escapeHtml(item)}</div>`
  ).join('');
  const meta = [
    cover.age.trim() ? `${escapeHtml(cover.age.trim())} años` : '',
    cover.bedId.trim() ? `Cama ${escapeHtml(cover.bedId.trim())}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    title: `Traslado · ${cover.patientName.trim()}`,
    styles: STYLES(cover.paper),
    body: `<div class="sheet">
  <div class="top">
    <div class="brand">
      <img src="/images/logos/logo_HHR.png" alt="" />
      <div><div class="name">Hospital Hanga Roa</div><div class="service">${escapeHtml(cover.origin)}</div></div>
    </div>
    <div class="kind">Traslado</div>
  </div>
  <div class="patient">
    <div class="label">Paciente</div>
    <div class="name">${escapeHtml(cover.patientName.trim())}</div>
    <div class="rut">RUT ${escapeHtml(cover.rut.trim())}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>
  <div class="grid">
    ${field('Destino', cover.destination)}
    ${field('Fecha de ingreso a Hospital Hanga Roa', formatCoverDate(cover.admissionDate))}
    ${field('Responsable del envío', '')}
    <div class="contents">${contents}</div>
  </div>
  <div class="foot"><span>Documentación confidencial del paciente. Entregar únicamente al equipo receptor.</span><span>Hospital Hanga Roa</span></div>
</div>`,
  };
};
