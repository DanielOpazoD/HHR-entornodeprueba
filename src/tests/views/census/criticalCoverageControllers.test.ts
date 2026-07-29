import { describe, expect, it } from 'vitest';

import {
  buildAuthorizedSharedAccessUser,
  resolveSharedCensusPathInfo,
} from '@/features/census/controllers/sharedCensusModeController';
import {
  buildDefaultFugaAutomaticMessage,
  buildFugaNotificationBody,
  normalizeRecipientList,
  parseFugaRecipientConfig,
  resolveFugaRecipients,
  validateFugaNotificationRequest,
} from '@/features/census/controllers/fugaNotificationPolicyController';
import { getUndoMovementErrorMessage } from '@/features/census/controllers/patientMovementUndoErrorPresentation';
import {
  buildIeehInitialDraftValues,
  buildIeehPrintDischargeData,
  buildPersistedIeehData,
} from '@/features/census/controllers/ieehFormDataController';
import type { DischargeFormData } from '@/services/pdf/ieehPdfService';

describe('criticalCoverageControllers', () => {
  describe('sharedCensusModeController', () => {
    it('normalizes empty and nested shared census paths', () => {
      expect(resolveSharedCensusPathInfo('')).toEqual({
        isSharedCensusMode: false,
        invitationId: null,
      });
      expect(resolveSharedCensusPathInfo('/censo-compartido/')).toEqual({
        isSharedCensusMode: true,
        invitationId: null,
      });
      expect(resolveSharedCensusPathInfo('/censo-publico/invitacion-1/detalle')).toEqual({
        isSharedCensusMode: true,
        invitationId: 'invitacion-1',
      });
    });

    it('builds shared access users with normalized email and fallback display name', () => {
      const now = new Date('2026-03-01T12:00:00.000Z');

      expect(
        buildAuthorizedSharedAccessUser({
          uid: 'viewer-1',
          email: 'Viewer@Hospital.cl',
          now,
        })
      ).toMatchObject({
        id: 'viewer-1',
        email: 'viewer@hospital.cl',
        displayName: 'Viewer',
        role: 'viewer',
        createdAt: now,
        createdBy: 'local-auth',
        isActive: true,
      });
    });
  });

  describe('fugaNotificationPolicyController', () => {
    it('normalizes recipient input from arrays and strings', () => {
      expect(normalizeRecipientList([' A@hospital.cl ', '', 'B@hospital.cl'])).toEqual([
        'a@hospital.cl',
        'b@hospital.cl',
      ]);
      expect(
        parseFugaRecipientConfig('uno@hospital.cl; dos@hospital.cl\ntres@hospital.cl')
      ).toEqual(['uno@hospital.cl', 'dos@hospital.cl', 'tres@hospital.cl']);
    });

    it('builds automatic and signed fuga messages', () => {
      expect(
        buildDefaultFugaAutomaticMessage({
          patientName: 'Paciente Demo',
          rut: '11.111.111-1',
          time: '08:30',
          bedName: 'B-12',
          diagnosis: 'Observación',
          specialty: '',
          recordDateLabel: '15/03/2026',
        })
      ).toContain('Especialidad: No especificada');

      const withoutNote = buildFugaNotificationBody({
        automaticMessage: 'Mensaje base',
        nursesSignature: 'Enf. Uno / Enf. Dos',
      });
      const withNote = buildFugaNotificationBody({
        automaticMessage: 'Mensaje base',
        note: 'Detalle extra',
      });

      expect(withoutNote).not.toContain('Nota complementaria');
      expect(withNote).toContain('Nota complementaria (ingresada por enfermería)');
      expect(withNote).toContain('Hospital Hanga Roa');
    });

    it('resolves test, automatic psychiatry and manual recipients', () => {
      expect(
        resolveFugaRecipients({
          specialty: 'Psiquiatría',
          psychiatryRecipients: ['psiq@hospital.cl'],
          testMode: true,
          testRecipient: 'QA@hospital.cl',
        })
      ).toEqual({
        mode: 'test',
        recipients: ['qa@hospital.cl'],
        usesAutomaticPsychiatryRecipients: false,
        displayLabel: 'qa@hospital.cl',
      });

      expect(
        resolveFugaRecipients({
          specialty: 'Interconsulta Psiquiatrica',
          psychiatryRecipients: ['psiq@hospital.cl', 'guardia@hospital.cl'],
        })
      ).toEqual({
        mode: 'automatic',
        recipients: ['psiq@hospital.cl', 'guardia@hospital.cl'],
        usesAutomaticPsychiatryRecipients: true,
        displayLabel: 'destinatarios automáticos de Psiquiatría',
      });

      expect(
        resolveFugaRecipients({
          specialty: 'Cirugía',
          manualRecipientsInput: 'manual@hospital.cl otro@hospital.cl',
        })
      ).toEqual({
        mode: 'manual',
        recipients: ['manual@hospital.cl', 'otro@hospital.cl'],
        usesAutomaticPsychiatryRecipients: false,
        displayLabel: 'manual@hospital.cl, otro@hospital.cl',
      });
    });

    it('validates message, recipients and invalid email combinations', () => {
      expect(
        validateFugaNotificationRequest({
          automaticMessage: '   ',
          resolvedRecipients: resolveFugaRecipients({ manualRecipientsInput: 'uno@hospital.cl' }),
        })
      ).toEqual({
        isValid: false,
        error: 'El mensaje automático es obligatorio.',
        hasInvalidEmails: false,
      });

      expect(
        validateFugaNotificationRequest({
          automaticMessage: 'Mensaje',
          resolvedRecipients: resolveFugaRecipients({
            specialty: 'Psiquiatría',
            psychiatryRecipients: [],
          }),
          requireAutomaticRecipients: false,
        })
      ).toEqual({
        isValid: true,
        hasInvalidEmails: false,
      });

      expect(
        validateFugaNotificationRequest({
          automaticMessage: 'Mensaje',
          resolvedRecipients: resolveFugaRecipients({ testMode: true }),
        })
      ).toEqual({
        isValid: false,
        error: 'Debes ingresar un correo de prueba válido.',
        hasInvalidEmails: false,
      });

      expect(
        validateFugaNotificationRequest({
          automaticMessage: 'Mensaje',
          resolvedRecipients: resolveFugaRecipients({
            manualRecipientsInput: 'invalido otro@hospital.cl',
          }),
        })
      ).toEqual({
        isValid: false,
        error: 'Uno o más correos ingresados no son válidos.',
        hasInvalidEmails: true,
      });
    });
  });

  describe('patientMovementUndoErrorPresentation', () => {
    const descriptor = {
      patientName: 'Paciente Demo',
      bedName: 'B-12',
    };

    it('maps discharge error codes to the expected messages', () => {
      expect(getUndoMovementErrorMessage('discharge', 'MAIN_BED_OCCUPIED', descriptor)).toContain(
        'cama B-12 ya está ocupada por otro paciente'
      );
      expect(getUndoMovementErrorMessage('discharge', 'MAIN_BED_EMPTY', descriptor)).toContain(
        'primero debe estar ocupada la cama principal'
      );
      expect(
        getUndoMovementErrorMessage('discharge', 'CLINICAL_CRIB_OCCUPIED', descriptor)
      ).toContain('ya existe una cuna RN ocupada');
      expect(getUndoMovementErrorMessage('discharge', 'BED_NOT_FOUND', descriptor)).toContain(
        'cama asociada ya no existe'
      );
      expect(
        getUndoMovementErrorMessage('discharge', 'ORIGINAL_DATA_MISSING', descriptor)
      ).toContain('faltan datos originales');
      expect(getUndoMovementErrorMessage('discharge', 'UNKNOWN_CODE' as never, descriptor)).toBe(
        'No se pudo deshacer el alta.'
      );
    });

    it('maps transfer error codes to the expected messages', () => {
      expect(getUndoMovementErrorMessage('transfer', 'MAIN_BED_OCCUPIED', descriptor)).toContain(
        'cama B-12 ya está ocupada.'
      );
      expect(getUndoMovementErrorMessage('transfer', 'MAIN_BED_EMPTY', descriptor)).toContain(
        'cama principal.'
      );
      expect(
        getUndoMovementErrorMessage('transfer', 'CLINICAL_CRIB_OCCUPIED', descriptor)
      ).toContain('ya existe una cuna RN ocupada.');
      expect(getUndoMovementErrorMessage('transfer', 'BED_NOT_FOUND', descriptor)).toContain(
        'cama asociada ya no existe'
      );
      expect(
        getUndoMovementErrorMessage('transfer', 'ORIGINAL_DATA_INVALID', descriptor)
      ).toContain('faltan datos originales');
      expect(getUndoMovementErrorMessage('transfer', 'UNKNOWN_CODE' as never, descriptor)).toBe(
        'No se pudo deshacer el traslado.'
      );
    });
  });

  describe('ieehFormDataController', () => {
    const patient = {
      cie10Description: 'Diagnóstico base',
      pathology: 'Patología base',
      cie10Code: 'A00',
    } as Parameters<typeof buildIeehInitialDraftValues>[0];

    it('builds draft values from saved IEEH data and patient fallback values', () => {
      expect(buildIeehInitialDraftValues(patient)).toMatchObject({
        diagnosticoPrincipal: 'Diagnóstico base',
        cie10Code: 'A00',
        condicionEgreso: '1',
        tieneIntervencion: false,
        tieneProcedimiento: false,
      });

      expect(
        buildIeehInitialDraftValues(patient, {
          diagnosticoPrincipal: 'Nuevo diagnóstico',
          cie10Code: 'B00',
          condicionEgreso: '2',
          intervencionQuirurgica: '1',
          intervencionQuirurgDescrip: 'Cirugía',
          procedimiento: '1',
          procedimientoDescrip: 'Procedimiento',
          tratanteApellido1: 'Pérez',
          tratanteApellido2: 'Gómez',
          tratanteNombre: 'Ana',
          tratanteRut: '12.345.678-9',
        })
      ).toMatchObject({
        diagnosticoPrincipal: 'Nuevo diagnóstico',
        cie10Code: 'B00',
        condicionEgreso: '2',
        tieneIntervencion: true,
        tieneProcedimiento: true,
        tratanteApellido1: 'Pérez',
        tratanteRut: '12.345.678-9',
      });
    });

    it('persists optional intervention and procedure data only when enabled', () => {
      expect(
        buildPersistedIeehData({
          diagnosticoPrincipal: '',
          cie10Code: '',
          cie10Display: '',
          condicionEgreso: '1',
          tieneIntervencion: false,
          intervencionDescrip: 'No debería persistirse',
          tieneProcedimiento: false,
          procedimientoDescrip: 'No debería persistirse',
          tratanteApellido1: '',
          tratanteApellido2: '',
          tratanteNombre: '',
          tratanteRut: '',
        })
      ).toEqual({
        diagnosticoPrincipal: undefined,
        cie10Code: undefined,
        condicionEgreso: '1',
        intervencionQuirurgica: '2',
        intervencionQuirurgDescrip: undefined,
        procedimiento: '2',
        procedimientoDescrip: undefined,
        tratanteApellido1: undefined,
        tratanteApellido2: undefined,
        tratanteNombre: undefined,
        tratanteRut: undefined,
      });
    });

    it('merges persisted IEEH data into print payloads', () => {
      const baseDischargeData = {
        patientName: 'Paciente Demo',
      } as DischargeFormData;

      expect(
        buildIeehPrintDischargeData(baseDischargeData, {
          diagnosticoPrincipal: 'Diagnóstico final',
          cie10Code: 'C00',
          cie10Display: 'Diagnóstico final',
          condicionEgreso: '3',
          tieneIntervencion: true,
          intervencionDescrip: 'Pabellón',
          tieneProcedimiento: true,
          procedimientoDescrip: 'Procedimiento',
          tratanteApellido1: 'Pérez',
          tratanteApellido2: 'Soto',
          tratanteNombre: 'Ana',
          tratanteRut: '12.345.678-9',
        })
      ).toMatchObject({
        patientName: 'Paciente Demo',
        diagnosticoPrincipal: 'Diagnóstico final',
        intervencionQuirurgica: '1',
        procedimiento: '1',
        tratanteNombre: 'Ana',
      });
    });
  });
});
