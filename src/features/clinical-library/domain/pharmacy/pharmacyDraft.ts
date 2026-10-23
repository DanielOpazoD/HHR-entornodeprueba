import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { isValidRut } from '@/utils/rutUtils';
import { parseFormDate } from '../forms/clinicalFormDates';
import arsenal from './arsenalHhr2025.json';
import type {
  ArsenalItem,
  PharmacyActDraft,
  PharmacyActKind,
  PharmacyActLine,
  PharmacyProfessional,
} from './pharmacyTypes';

const arsenalById = new Map(arsenal.items.map(item => [item.id, item]));

export const createPharmacyLine = (): PharmacyActLine => ({
  id: crypto.randomUUID(),
  medicationId: '',
  name: '',
  presentation: '',
  quantity: '',
  patient: '',
  reason: '',
  expiry: '',
  disposalCause: '',
});

export const createPharmacyDraft = (
  kind: PharmacyActKind,
  professional: PharmacyProfessional
): PharmacyActDraft => ({
  kind,
  paperSize: 'a4',
  number: '',
  date: getClinicalCalendarDateISO(),
  professional: { ...professional },
  recipient: 'Bodega de Fármacos HHR',
  lines: [createPharmacyLine()],
});

const normalized = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-CL').trim();

export const searchPharmacyArsenal = (
  items: ReadonlyArray<ArsenalItem>,
  query: string
): ArsenalItem[] => {
  const words = normalized(query).split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const text = normalized(`${item.name} ${item.presentation} ${item.observations}`);
    return words.every(word => text.includes(word));
  });
};

export const validatePharmacyDraft = (draft: PharmacyActDraft): string[] => {
  const errors: string[] = [];
  if (draft.kind !== 'return' && draft.kind !== 'disposal')
    errors.push('Selecciona un tipo de acta válido: devolución o eliminación.');
  if (draft.paperSize !== 'a4' && draft.paperSize !== 'letter')
    errors.push('Selecciona un tamaño de papel válido: A4 o Carta.');
  const actDate = parseFormDate(draft.date);
  if (!actDate) errors.push('Indica una fecha válida para el acta.');
  if (draft.kind === 'disposal' && !draft.number.trim())
    errors.push('Indica el número y año del acta de entrega.');
  if (draft.number.trim().length > 80)
    errors.push('El número del acta debe tener como máximo 80 caracteres.');
  if (!draft.professional.name.trim()) errors.push('Completa el nombre del profesional.');
  if (!draft.professional.role.trim()) errors.push('Completa el cargo del profesional.');
  if (!draft.professional.unit.trim()) errors.push('Completa la unidad o servicio.');
  const rut = draft.professional.rut.trim();
  if (rut && (!/^[\d.]+-?[\dkK]$/.test(rut) || !isValidRut(rut)))
    errors.push('El RUT del profesional no es válido. Revisa su dígito verificador.');
  if (!draft.recipient.trim()) errors.push('Completa el destinatario del acta.');
  if (draft.lines.length === 0) errors.push('Agrega al menos un fármaco o insumo.');
  const seenIds = new Set<string>();
  draft.lines.forEach((line, index) => {
    const prefix = `Registro ${index + 1}: `;
    if (!line.id || seenIds.has(line.id)) errors.push(`${prefix}el registro está duplicado.`);
    seenIds.add(line.id);
    if (!line.medicationId.trim() || !line.name.trim())
      errors.push(`${prefix}selecciona un fármaco del arsenal o ingrésalo en modo manual.`);
    if (line.medicationId && line.medicationId !== 'manual') {
      const item = arsenalById.get(line.medicationId);
      if (!item || item.name !== line.name || item.presentation !== line.presentation)
        errors.push(
          `${prefix}el fármaco no coincide con el arsenal. Vuelve a seleccionarlo o utiliza el modo manual.`
        );
    }
    if (!line.presentation.trim()) errors.push(`${prefix}completa la presentación.`);
    const quantity = line.quantity.trim();
    if (
      !/^\d+(?:[.,]\d+)?$/.test(quantity) ||
      !Number.isFinite(Number(quantity.replace(',', '.'))) ||
      Number(quantity.replace(',', '.')) <= 0
    )
      errors.push(
        `${prefix}la cantidad debe ser un número mayor que cero, con coma o punto decimal.`
      );
    if (draft.kind === 'return' && !line.reason.trim())
      errors.push(`${prefix}completa el fundamento de la devolución.`);
    if (
      draft.kind === 'disposal' &&
      line.disposalCause !== 'expired' &&
      line.disposalCause !== 'damaged' &&
      line.disposalCause !== 'unlabelled'
    )
      errors.push(`${prefix}selecciona la causa de eliminación.`);
    const expiryDate = line.expiry ? parseFormDate(line.expiry) : null;
    if (line.expiry && !expiryDate) errors.push(`${prefix}la fecha de vencimiento no es válida.`);
    if (draft.kind === 'disposal' && line.disposalCause === 'expired' && !line.expiry)
      errors.push(`${prefix}indica la fecha de vencimiento del producto expirado.`);
    if (
      draft.kind === 'disposal' &&
      line.disposalCause === 'expired' &&
      actDate &&
      expiryDate &&
      expiryDate.timestamp > actDate.timestamp
    )
      errors.push(
        `${prefix}el vencimiento de un producto expirado no puede ser posterior a la fecha del acta.`
      );
  });
  return errors;
};
