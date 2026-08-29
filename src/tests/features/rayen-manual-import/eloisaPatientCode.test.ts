// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  assertEloisaPatientCodeFreshness,
  createEloisaPatientCode,
  parseEloisaPatientCode,
  serializeEloisaPatientPayload,
  type EloisaManualPatientPayload,
} from '@/features/rayen-manual-import/domain/eloisaPatientCode';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const payload: EloisaManualPatientPayload = {
  version: 2,
  capturedAt: '2026-08-28T20:15:00.000Z',
  encounterId: '98765',
  firstName: 'José',
  middleNames: 'Ángel',
  lastName: 'Muñoz',
  secondLastName: 'Rapa Nui',
  rut: '12.345.678-5',
  birthDate: '1980-05-04',
  biologicalSex: 'Masculino',
  admissionDate: '2026-08-28',
  admissionTime: '06:35',
  diagnosis: 'Neumonía adquirida en la comunidad',
  devices: ['VVP', 'CVC'],
  deviceEntries: [
    { name: 'VVP', installationDatetime: '2026-08-28T07:15:00-06:00' },
    { name: 'CVC', installationDatetime: '2026-08-27T19:40:00-06:00' },
  ],
  encounterRoute: 'nurse',
};

const buildUncheckedCode = async (value: unknown, prefix = 'HHR-PACIENTE-2'): Promise<string> => {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const material = `${prefix}.${encoded}`;
  const checksum = Buffer.from(
    await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  ).toString('base64url');
  return `${material}.${checksum}`;
};

describe('eloisa patient code contract', () => {
  it('round-trips deterministic UTF-8 clinical data', async () => {
    const first = await createEloisaPatientCode(payload);
    const second = await createEloisaPatientCode({ ...payload });
    expect(first).toBe(second);
    expect(await parseEloisaPatientCode(first)).toEqual(payload);
    expect(serializeEloisaPatientPayload(payload)).toContain('José');
  });

  it('keeps version 1 codes created before structured device evidence compatible', async () => {
    const {
      deviceEntries: _deviceEntries,
      encounterRoute: _encounterRoute,
      ...currentPayload
    } = payload;
    const legacyPayload = { ...currentPayload, version: 1 };
    const code = await buildUncheckedCode(legacyPayload, 'HHR-PACIENTE-1');

    await expect(parseEloisaPatientCode(code)).resolves.toMatchObject({
      devices: ['VVP', 'CVC'],
      deviceEntries: [],
    });
  });

  it('rejects truncation and accidental modification', async () => {
    const code = await createEloisaPatientCode(payload);
    await expect(parseEloisaPatientCode(code.slice(0, -8))).rejects.toThrow(
      /incompleto|modificado/i
    );
    const changed = `${code.slice(0, 35)}A${code.slice(36)}`;
    await expect(parseEloisaPatientCode(changed)).rejects.toThrow(/modificado/i);
  });

  it('rejects an unknown format version before attempting to import', async () => {
    const code = await createEloisaPatientCode(payload);
    await expect(
      parseEloisaPatientCode(code.replace('HHR-PACIENTE-2', 'HHR-PACIENTE-3'))
    ).rejects.toThrow(/versión/i);
  });

  it('does not log the code or patient payload', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const code = await createEloisaPatientCode(payload);
    await parseEloisaPatientCode(code);
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    spies.forEach(spy => spy.mockRestore());
  });

  it('accepts a recent capture and rejects expired or future codes', () => {
    const now = Date.parse('2026-08-29T01:00:00.000Z');
    expect(() => assertEloisaPatientCodeFreshness(payload, now)).not.toThrow();
    expect(() =>
      assertEloisaPatientCodeFreshness({ ...payload, capturedAt: '2026-08-28T12:59:59.999Z' }, now)
    ).toThrow(/venció/i);
    expect(() =>
      assertEloisaPatientCodeFreshness({ ...payload, capturedAt: '2026-08-29T01:05:00.001Z' }, now)
    ).toThrow(/futuro/i);
  });

  it.each([
    [{ admissionDate: '2026-02-31' }, /obligatorios/i],
    [{ admissionTime: '29:99' }, /obligatorios/i],
    [{ birthDate: 'desconocida' }, /obligatorios/i],
    [{ birthDate: '2026-08-29', admissionDate: '2026-08-28' }, /obligatorios/i],
    [{ admissionDate: '2026-08-29' }, /obligatorios/i],
  ])('rejects semantically invalid demographics %#', async (override, message) => {
    const code = await buildUncheckedCode({ ...payload, ...override });
    await expect(parseEloisaPatientCode(code)).rejects.toThrow(message);
  });
});
