// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendCensusEmailMock = vi.fn();
const authorizeRoleRequestMock = vi.fn();
const extractBearerTokenMock = vi.fn();
const getFirebaseServerMock = vi.fn();

vi.mock('../../../netlify/functions/lib/gmailClient', () => ({
  sendCensusEmail: (...args: unknown[]) => sendCensusEmailMock(...args),
}));

vi.mock('../../../netlify/functions/lib/firebase-auth', () => ({
  authorizeRoleRequest: (...args: unknown[]) => authorizeRoleRequestMock(...args),
  extractBearerToken: (...args: unknown[]) => extractBearerTokenMock(...args),
}));

vi.mock('../../../netlify/functions/lib/firebase-server', () => ({
  getFirebaseServer: () => getFirebaseServerMock(),
}));

import { handler } from '../../../netlify/functions/send-fuga-notification';
import {
  buildFugaNotificationBody,
  resolveFugaRecipients,
} from '@/domain/census/fugaNotificationPolicy';

describe('send-fuga-notification netlify function', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      DEPLOY_PRIME_URL: '',
      DEPLOY_URL: '',
      SITE_URL: '',
      APP_URL: '',
      FUGA_PSYCHIATRY_RECIPIENTS:
        'angelica.vargas@hospitalhangaroa.cl,mariapaz.ureta@hospitalhangaroa.cl',
    };

    sendCensusEmailMock.mockResolvedValue({ id: 'gmail-fuga-123' });
    extractBearerTokenMock.mockReturnValue('token-123');
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'admin@hospital.cl',
      role: 'admin',
      token: { sub: 'uid-1' },
    });
    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
  });

  it('resuelve destinatarios psiquiatría en modo normal', () => {
    expect(
      resolveFugaRecipients({ specialty: 'Psiquiatría', recipients: ['otro@hospital.cl'] })
    ).toEqual({
      mode: 'automatic',
      recipients: [],
      usesAutomaticPsychiatryRecipients: true,
      displayLabel: 'destinatarios automáticos de Psiquiatría',
    });
  });

  it('resuelve destinatario único en modo prueba', () => {
    expect(
      resolveFugaRecipients({
        specialty: 'Psiquiatría',
        recipients: ['otro@hospital.cl'],
        psychiatryRecipients: ['psiq@hospital.cl'],
        testMode: true,
        testRecipient: 'test@hospital.cl',
      })
    ).toEqual({
      mode: 'test',
      recipients: ['test@hospital.cl'],
      usesAutomaticPsychiatryRecipients: false,
      displayLabel: 'test@hospital.cl',
    });
  });

  it('compone cuerpo final con mensaje automático y nota opcional', () => {
    expect(
      buildFugaNotificationBody({
        automaticMessage: 'Mensaje base',
        note: 'Detalle clínico',
        nursesSignature: 'Enf A / Enf B',
      })
    ).toContain('Enf A / Enf B');

    expect(
      buildFugaNotificationBody({ automaticMessage: 'Solo automático', note: '   ' })
    ).toContain('Enfermería - Servicio Hospitalizados');
  });

  it('envía solo a correo de prueba cuando testMode=true', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        patientName: 'Paciente Uno',
        rut: '1-9',
        diagnosis: 'Diagnóstico',
        bedName: 'A-1',
        specialty: 'Psiquiatría',
        recordDate: '2026-03-31',
        time: '10:00',
        automaticMessage: 'Mensaje editable',
        note: 'Nota',
        testMode: true,
        testRecipient: 'qa@hospital.cl',
      }),
      path: '/.netlify/functions/send-fuga-notification',
    });

    expect(response.statusCode).toBe(200);
    expect(sendCensusEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['qa@hospital.cl'],
        subject: 'Notificación de fuga paciente Paciente Uno - 31-03-2026',
        body: expect.stringContaining('Nota'),
      })
    );
  });

  it('rechaza psiquiatría si no hay destinatarios automáticos configurados', async () => {
    process.env.FUGA_PSYCHIATRY_RECIPIENTS = '';

    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        patientName: 'Paciente Tres',
        rut: '3-5',
        diagnosis: 'Diag',
        bedName: 'A-3',
        specialty: 'Psiquiatría',
        recordDate: '2026-03-31',
        time: '12:00',
        automaticMessage: 'Mensaje editable',
      }),
      path: '/.netlify/functions/send-fuga-notification',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      'No hay destinatarios automáticos configurados para Psiquiatría'
    );
    expect(sendCensusEmailMock).not.toHaveBeenCalled();
  });

  it('rechaza modo prueba si rol no es admin', async () => {
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'nurse@hospital.cl',
      role: 'nurse_hospital',
      token: { sub: 'uid-2' },
    });

    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        patientName: 'Paciente Dos',
        rut: '2-7',
        diagnosis: 'Diag',
        bedName: 'A-2',
        specialty: 'Cirugía',
        recordDate: '2026-03-31',
        time: '11:00',
        automaticMessage: 'Mensaje editable',
        recipients: ['destino@hospital.cl'],
        testMode: true,
        testRecipient: 'qa@hospital.cl',
      }),
      path: '/.netlify/functions/send-fuga-notification',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Solo un usuario admin puede usar modo prueba');
    expect(sendCensusEmailMock).not.toHaveBeenCalled();
  });
});
