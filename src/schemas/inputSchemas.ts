import * as z from 'zod/mini';
import { isValidRut } from '@/utils/rutUtils';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

/**
 * Input Validation Schemas
 *
 * Used for real-time form validation before performing operations.
 * Complements the data schemas in zodSchemas.ts which validate state.
 */

// ============================================================================
// Patient Input
// ============================================================================

const hasValidClinicalAgeParts = (value: string): boolean => {
  if (!value) return true;

  const wholeYears = /^(\d+)a?$/i.exec(value);
  if (wholeYears) return Number(wholeYears[1]) <= 130;

  const days = /^(\d+)d$/i.exec(value);
  if (days) return Number(days[1]) <= 130 * 366;

  const months = /^(\d+)m$/i.exec(value);
  if (months) return Number(months[1]) >= 1 && Number(months[1]) <= 130 * 12;

  const monthDays = /^(\d+)m\s+(\d+)d$/i.exec(value);
  if (monthDays) {
    const monthValue = Number(monthDays[1]);
    const dayValue = Number(monthDays[2]);
    return monthValue >= 1 && monthValue <= 5 && dayValue <= 31;
  }

  const yearMonths = /^(\d+)a\s+(\d+)m$/i.exec(value);
  if (yearMonths) {
    const yearValue = Number(yearMonths[1]);
    return yearValue >= 2 && yearValue <= 3 && Number(yearMonths[2]) <= 11;
  }

  return false;
};

export const PatientInputSchema = z.object({
  firstName: z.union([
    z.optional(z.string().check(z.maxLength(60, 'Primer nombre demasiado largo'))),
    z.literal(''),
  ]),

  lastName: z.union([
    z.optional(z.string().check(z.maxLength(60, 'Primer apellido demasiado largo'))),
    z.literal(''),
  ]),

  secondLastName: z.union([
    z.optional(z.string().check(z.maxLength(60, 'Segundo apellido demasiado largo'))),
    z.literal(''),
  ]),

  patientName: z.string().check(
    z.minLength(1, 'El nombre es requerido'),
    z.maxLength(100, 'Nombre demasiado largo (máx 100 caracteres)'),
    z.refine(val => val.trim().length > 0, 'El nombre no puede estar vacío')
  ),

  rut: z.union([
    z.optional(
      z.string().check(
        z.maxLength(20, 'Identificación demasiado larga'),
        z.refine(val => {
          if (!val || val === '') return true;
          if (val === '-') return true;
          // Note: This only validates if it's a RUT.
          // If it's a passport, it should pass this or we should check documentType.
          // But for now we just apply the mathematical check if something is written.
          return isValidRut(val);
        }, 'El RUT ingresado es incorrecto')
      )
    ),
    z.literal(''),
  ]),

  age: z.union([
    z.optional(
      z
        .string()
        .check(
          z.regex(
            /^(?:\d+|\d+[adm]|\d+a\s+\d+m|\d+m\s+\d+d)?$/i,
            'Formato de edad inválido (ej: 20d, 3m 8d, 18m, 2a 4m, 45)'
          ),
          z.maxLength(8, 'Edad demasiado larga'),
          z.refine(hasValidClinicalAgeParts, 'Los componentes de la edad están fuera de rango')
        )
    ),
    z.literal(''),
  ]),

  pathology: z.union([
    z.optional(z.string().check(z.maxLength(500, 'El diagnóstico/patología es demasiado largo'))),
    z.literal(''),
  ]),

  birthDate: z.union([
    z.optional(
      z.string().check(
        z.regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha de nacimiento inválido'),
        // A birth date is a calendar day; "today" is the hospital's (TIME-02). ISO days compare as text.
        z.refine(
          val => !val || val <= getClinicalCalendarDateISO(),
          'La fecha de nacimiento no puede ser en el futuro'
        )
      )
    ),
    z.literal(''),
  ]),
});

// ============================================================================
// Bed Operations
// ============================================================================

export const BedBlockSchema = z.object({
  reason: z
    .string()
    .check(
      z.minLength(1, 'El motivo es requerido para bloquear una cama'),
      z.maxLength(100, 'El motivo es demasiado largo (máx 100 caracteres)')
    ),
});

// ============================================================================
// Staff / Nursing Input
// ============================================================================

export const StaffNameSchema = z
  .string()
  .check(
    z.minLength(2, 'El nombre debe tener al menos 2 caracteres'),
    z.maxLength(50, 'El nombre es demasiado largo')
  );

// ============================================================================
// Discharge / Transfer Details
// ============================================================================

export const TimeSchema = z
  .string()
  .check(z.regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, 'Formato de hora inválido (HH:mm)'));
