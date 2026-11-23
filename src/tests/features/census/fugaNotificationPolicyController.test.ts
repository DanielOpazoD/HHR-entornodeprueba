// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildFugaNotificationBody,
  isPsychiatrySpecialty,
  normalizeRecipientList,
  parseFugaRecipientConfig,
  resolveFugaRecipients,
  validateFugaNotificationRequest,
} from '@/domain/census/fugaNotificationPolicy';

describe('fugaNotificationPolicyController', () => {
  it('detects psychiatry specialties with and without accents', () => {
    expect(isPsychiatrySpecialty('Psiquiatría')).toBe(true);
    expect(isPsychiatrySpecialty('psiquiatria')).toBe(true);
    expect(isPsychiatrySpecialty('Interconsulta Psiquiatrica')).toBe(true);
    expect(isPsychiatrySpecialty('Cirugía')).toBe(false);
  });

  it('normalizes recipient lists from mixed separators', () => {
    expect(
      normalizeRecipientList('A@HOSPITAL.CL; b@hospital.cl\nc@hospital.cl  d@hospital.cl')
    ).toEqual(['a@hospital.cl', 'b@hospital.cl', 'c@hospital.cl', 'd@hospital.cl']);
  });

  it('uses test recipient over manual and automatic recipients', () => {
    expect(
      resolveFugaRecipients({
        specialty: 'Psiquiatría',
        recipients: ['otro@hospital.cl'],
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
  });

  it('validates missing psychiatry config when automatic recipients are required', () => {
    const resolvedRecipients = resolveFugaRecipients({
      specialty: 'Psiquiatría',
      psychiatryRecipients: parseFugaRecipientConfig(''),
    });

    expect(
      validateFugaNotificationRequest({
        automaticMessage: 'Mensaje',
        resolvedRecipients,
        requireAutomaticRecipients: true,
      })
    ).toEqual({
      isValid: false,
      error: 'No hay destinatarios automáticos configurados para Psiquiatría.',
      hasInvalidEmails: false,
    });
  });

  it('builds final body with note and signature', () => {
    expect(
      buildFugaNotificationBody({
        automaticMessage: 'Mensaje base',
        note: 'Detalle clínico',
        nursesSignature: 'Enf Uno / Enf Dos',
      })
    ).toContain('Nota complementaria');
  });
});
