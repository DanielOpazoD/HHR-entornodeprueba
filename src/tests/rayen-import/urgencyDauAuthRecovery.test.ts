// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { harness, hhrSender, selection, type Sender } from './urgencyInlineAuth.fixture';
import '../../../extension/urgency-dau-page.js';
import '../../../extension/urgency-dau-source.js';

type AuthPrompt = { flowId: string; url: string; reason?: 'profile' };
type Native = ReturnType<typeof harness>['auth'] & { readDau: () => Promise<Uint8Array> };
declare global {
  var HhrUrgencyDauSource: {
    create: (deps: { chrome: object; native: Native }) => {
      read: (
        input: typeof selection & { sender: Sender; assertAuthorization: () => Promise<void> }
      ) => Promise<{ bytes?: Uint8Array; auth?: AuthPrompt; error?: string }>;
    };
  };
}

describe('recoverable native DAU profile selection', () => {
  it.each(['facility', 'identity'])(
    'allows another login after a %s rejection without delivering a mismatched PDF',
    async kind => {
      const h = harness(),
        first = await h.begin();
      await first.login();
      const original = await h.auth.sessionFor(hhrSender);
      if (kind === 'facility') h.admission.IdFacility = 99;
      else h.admission.Patient.Rut = '222222222';
      const source = HhrUrgencyDauSource.create({
        chrome: {},
        native: { ...h.auth, readDau: h.readPdf },
      });
      const request = {
        ...selection,
        sender: hhrSender,
        assertAuthorization: vi.fn(async () => {}),
      };
      const result = await source.read(request);
      expect(result).toMatchObject({ auth: { reason: 'profile' }, error: expect.any(String) });
      expect(result.bytes).toBeUndefined();
      expect(h.fetchImpl.mock.calls.some(([url]) => String(url).includes('/reportes/'))).toBe(
        false
      );
      expect(await h.auth.sessionFor(hhrSender)).toBeNull();
      expect(JSON.stringify(h.values)).not.toContain('fake');
      const auth = result.auth;
      if (!auth) throw new Error('Missing synthetic profile recovery');
      expect(auth.flowId).not.toBe(original?.id);
      expect(
        await h.auth.handle(
          {
            flowId: auth.flowId,
            operation: 'login',
            username: 'synthetic.user',
            password: 'example',
            domain: 'synthetic',
          },
          { ...first.sender, url: auth.url }
        )
      ).toMatchObject({ state: 'authenticated' });
      h.admission.IdFacility = 9;
      h.admission.Patient.Rut = '111111111';
      const recovered = await source.read(request);
      expect(new TextDecoder().decode(recovered.bytes)).toMatch(/^%PDF-/);
    }
  );
});
