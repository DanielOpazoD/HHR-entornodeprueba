// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { harness } from './urgencyInlineAuth.fixture';

describe('official DAU through the native API session', () => {
  it('resolves the exact care and uses all five official report parameters', async () => {
    const h = harness(),
      step = await h.begin();
    await step.login();
    expect(new TextDecoder().decode(await h.readPdf())).toMatch(/^%PDF-/);
    const report = h.fetchImpl.mock.calls.find(([url]) => String(url).includes('/reportes/'));
    expect(report).toBeDefined();
    const url = new URL(String(report?.[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      timeDifference: '0',
      nodId: '9',
      iurgId: '7',
      atenId: '8',
      uspId: '42',
    });
    expect(report?.[1]).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Authorization: `SDX-TICKET ${'fake'}` },
    });
    expect(
      h.fetchImpl.mock.calls.every(([url]) => new URL(String(url)).hostname === 'api.saludenred.cl')
    ).toBe(true);
  });

  it.each(['patient', 'care', 'admission', 'facility', 'emergency', 'duplicate'])(
    'rejects a mismatched %s before requesting the PDF',
    async kind => {
      const h = harness(),
        step = await h.begin();
      await step.login();
      if (kind === 'patient') h.admission.Patient.Rut = '222222222';
      if (kind === 'care') h.care.Id = 99;
      if (kind === 'admission') h.care.IdEmergencyAdmission = 99;
      if (kind === 'facility') h.admission.IdFacility = 99;
      if (kind === 'emergency') h.care.IsEmergency = false;
      if (kind === 'duplicate') h.config.duplicate = true;
      await expect(h.readPdf()).rejects.toThrow();
      expect(h.fetchImpl.mock.calls.some(([url]) => String(url).includes('/reportes/'))).toBe(
        false
      );
    }
  );

  it('rejects an HTML response presented as a download', async () => {
    const h = harness(),
      step = await h.begin();
    await step.login();
    h.config.invalidPdf = true;
    await expect(h.readPdf()).rejects.toThrow();
  });

  it('does not deliver bytes after the clinical session changes during the PDF request', async () => {
    const h = harness(),
      step = await h.begin();
    await step.login();
    h.hooks.onPdf = async () => {
      h.clock.owner = 'new-clinical-owner';
    };
    await expect(h.readPdf()).rejects.toThrow(/sesión clínica cambió/);
  });
});
