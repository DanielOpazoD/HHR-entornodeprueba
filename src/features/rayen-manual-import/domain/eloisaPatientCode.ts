import { z } from 'zod';

export const ELOISA_PATIENT_CODE_PREFIX = 'HHR-PACIENTE-1';
export const ELOISA_PATIENT_CODE_FORMAT_VERSION = 1 as const;
export const ELOISA_PATIENT_CODE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const ELOISA_PATIENT_CODE_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_CODE_LENGTH = 16_384;

const isRealIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const IsoDateSchema = z.string().refine(isRealIsoDate, 'Fecha calendario no válida.');

const EloisaManualPatientSchema = z
  .object({
    version: z.literal(ELOISA_PATIENT_CODE_FORMAT_VERSION),
    capturedAt: z.string().datetime({ offset: true }),
    encounterId: z.string().trim().regex(/^\d+$/),
    firstName: z.string().trim().min(1),
    middleNames: z.string().trim().optional(),
    lastName: z.string().trim().min(1),
    secondLastName: z.string().trim().optional(),
    rut: z.string().trim().min(2),
    birthDate: IsoDateSchema.optional(),
    biologicalSex: z.enum(['Masculino', 'Femenino', 'Indeterminado']).optional(),
    admissionDate: IsoDateSchema,
    admissionTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    diagnosis: z.string().trim().optional(),
    devices: z.array(z.string().trim().min(1)).max(30).default([]),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.birthDate && payload.birthDate > payload.admissionDate) {
      context.addIssue({
        code: 'custom',
        path: ['birthDate'],
        message: 'La fecha de nacimiento no puede ser posterior al ingreso.',
      });
    }
    if (payload.admissionDate > payload.capturedAt.slice(0, 10)) {
      context.addIssue({
        code: 'custom',
        path: ['admissionDate'],
        message: 'La fecha de ingreso no puede ser posterior a la captura.',
      });
    }
  });

export type EloisaManualPatientPayload = z.infer<typeof EloisaManualPatientSchema>;

export type EloisaPatientCodeErrorCode =
  | 'empty'
  | 'incomplete'
  | 'unsupported_version'
  | 'corrupt'
  | 'expired'
  | 'invalid_payload';

export class EloisaPatientCodeError extends Error {
  constructor(
    public readonly code: EloisaPatientCodeErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'EloisaPatientCodeError';
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = canonicalize(entry);
      return result;
    }, {});
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new EloisaPatientCodeError('corrupt', 'El código contiene caracteres no válidos.');
  }
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw new EloisaPatientCodeError('corrupt', 'El código no pudo decodificarse.');
  }
};

const digest = async (value: string): Promise<string> => {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(hash));
};

const equalChecksum = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const serializeEloisaPatientPayload = (payload: EloisaManualPatientPayload): string =>
  JSON.stringify(canonicalize(EloisaManualPatientSchema.parse(payload)));

export const createEloisaPatientCode = async (
  payload: EloisaManualPatientPayload
): Promise<string> => {
  const encoded = toBase64Url(new TextEncoder().encode(serializeEloisaPatientPayload(payload)));
  const material = `${ELOISA_PATIENT_CODE_PREFIX}.${encoded}`;
  return `${material}.${await digest(material)}`;
};

export const parseEloisaPatientCode = async (
  rawCode: string
): Promise<EloisaManualPatientPayload> => {
  const code = String(rawCode || '').trim();
  if (!code) throw new EloisaPatientCodeError('empty', 'Pega el código copiado desde Eloísa.');
  if (code.length > MAX_CODE_LENGTH) {
    throw new EloisaPatientCodeError('invalid_payload', 'El código supera el tamaño permitido.');
  }
  const parts = code.split('.');
  if (parts.length !== 3) {
    throw new EloisaPatientCodeError('incomplete', 'El código está incompleto o fue truncado.');
  }
  const [prefix, encoded, checksum] = parts;
  if (prefix !== ELOISA_PATIENT_CODE_PREFIX) {
    if (/^HHR-PACIENTE-\d+$/.test(prefix)) {
      throw new EloisaPatientCodeError(
        'unsupported_version',
        'Esta versión del código todavía no es compatible con HHR.'
      );
    }
    throw new EloisaPatientCodeError(
      'corrupt',
      'El código no corresponde a un paciente de Eloísa.'
    );
  }
  const material = `${prefix}.${encoded}`;
  if (!equalChecksum(await digest(material), checksum)) {
    throw new EloisaPatientCodeError('corrupt', 'El código está incompleto o fue modificado.');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(encoded)));
  } catch (error) {
    if (error instanceof EloisaPatientCodeError) throw error;
    throw new EloisaPatientCodeError('corrupt', 'El contenido del código no es válido.');
  }
  const result = EloisaManualPatientSchema.safeParse(decoded);
  if (!result.success) {
    throw new EloisaPatientCodeError(
      'invalid_payload',
      'El código no contiene todos los datos obligatorios del paciente.'
    );
  }
  return result.data;
};

export const assertEloisaPatientCodeFreshness = (
  payload: EloisaManualPatientPayload,
  now = Date.now()
): void => {
  const capturedAt = Date.parse(payload.capturedAt);
  if (capturedAt > now + ELOISA_PATIENT_CODE_MAX_FUTURE_SKEW_MS) {
    throw new EloisaPatientCodeError(
      'invalid_payload',
      'La hora de captura del código está en el futuro. Copia un código nuevo desde Eloísa.'
    );
  }
  if (capturedAt < now - ELOISA_PATIENT_CODE_MAX_AGE_MS) {
    throw new EloisaPatientCodeError(
      'expired',
      'El código venció. Copia nuevamente al paciente desde Eloísa antes de importarlo.'
    );
  }
};

export const buildEloisaPatientDisplayName = (payload: EloisaManualPatientPayload): string =>
  [payload.firstName, payload.middleNames, payload.lastName, payload.secondLastName]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
