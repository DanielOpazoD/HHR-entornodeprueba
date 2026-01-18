import { z } from 'zod';

/**
 * Input Validation Schemas
 * 
 * Used for real-time form validation before performing operations.
 * Complements the data schemas in zodSchemas.ts which validate state.
 */

// ============================================================================
// Patient Input
// ============================================================================

export const PatientInputSchema = z.object({
    patientName: z.string()
        .min(1, 'El nombre es requerido')
        .max(100, 'Nombre demasiado largo (máx 100 caracteres)')
        .refine(val => val.trim().length > 0, 'El nombre no puede estar vacío'),

    rut: z.string()
        .max(20, 'Identificación demasiado larga')
        .optional()
        .or(z.literal('')),

    age: z.string()
        .regex(/^[0-9]*[adm]?$/, 'Formato de edad inválido (ej: 45, 10d, 5m)')
        .max(5, 'Edad demasiado larga')
        .optional()
        .or(z.literal('')),

    pathology: z.string()
        .max(500, 'El diagnóstico/patología es demasiado largo')
        .optional()
        .or(z.literal('')),

    birthDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha de nacimiento inválido')
        .refine(val => {
            if (!val) return true;
            return new Date(val) <= new Date();
        }, 'La fecha de nacimiento no puede ser en el futuro')
        .optional()
        .or(z.literal('')),
});

// ============================================================================
// Bed Operations
// ============================================================================

export const BedBlockSchema = z.object({
    reason: z.string()
        .min(1, 'El motivo es requerido para bloquear una cama')
        .max(100, 'El motivo es demasiado largo (máx 100 caracteres)'),
});

// ============================================================================
// Staff / Nursing Input
// ============================================================================

export const StaffNameSchema = z.string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(50, 'El nombre es demasiado largo');

// ============================================================================
// Discharge / Transfer Details
// ============================================================================

export const ActionNoteSchema = z.string()
    .max(1000, 'La nota es demasiado larga');

export const TimeSchema = z.string()
    .regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, 'Formato de hora inválido (HH:mm)');
