import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetlifyEventLike } from '../../../netlify/functions/lib/http';

const { authorize, server, fetcher } = vi.hoisted(() => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  return { authorize: vi.fn(), server: vi.fn(), fetcher };
});
vi.mock('../../../netlify/functions/lib/firebase-server', () => ({ getFirebaseServer: server }));
vi.mock('../../../netlify/functions/lib/firebase-auth', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../netlify/functions/lib/firebase-auth')>()),
  authorizeRoleRequest: authorize,
}));
vi.mock('../../../netlify/functions/lib/ai-provider', () => ({
  resolveClinicalAIProviderConfig: () => ({
    provider: 'openai',
    model: 'synthetic-model',
    apiKey: 'synthetic',
  }),
  listClinicalAIProviderAvailability: () => [],
  generateClinicalAIText: () => Promise.resolve('OK'),
}));
vi.mock('../../../netlify/functions/lib/ai-provider-routing', () => ({
  loadClinicalAIRoutingConfigFromFirestore: () => Promise.resolve(null),
}));

import { handler as status } from '../../../netlify/functions/admin-ai-provider-status';
import { handler as test } from '../../../netlify/functions/admin-ai-provider-test';
import { handler as cie10 } from '../../../netlify/functions/cie10-ai-search';
import { handler as document } from '../../../netlify/functions/clinical-document-ai-import';
import { handler as attachment } from '../../../netlify/functions/clinical-attachment-name-suggestion';
import { handler as census } from '../../../netlify/functions/send-census-email';
import { handler as fuga } from '../../../netlify/functions/send-fuga-notification';
import { handler as syslab } from '../../../netlify/functions/syslab-proxy';
import { handler as mmrad } from '../../../netlify/functions/mmrad-search';
import { handler as whatsapp } from '../../../netlify/functions/whatsapp-proxy';

const functions = [
  ['admin-status', status, 'GET'],
  ['admin-test', test, 'POST'],
  ['cie10', cie10, 'POST'],
  ['document', document, 'POST'],
  ['attachment', attachment, 'POST'],
  ['census', census, 'POST'],
  ['fuga', fuga, 'POST'],
  ['syslab', syslab, 'GET'],
  ['mmrad', mmrad, 'GET'],
  ['whatsapp', whatsapp, 'POST'],
] as const;
const cases = [
  ['missing', {}, null],
  ['malformed', { authorization: 'Basic synthetic' }, null],
  ['invalid', { authorization: 'Bearer invalid' }, 'Malformed Firebase ID token.'],
  ['forbidden', { authorization: 'Bearer synthetic' }, "Access denied for role 'unauthorized'."],
  ['authorized', { authorization: 'Bearer synthetic' }, null],
  ['uppercase', { Authorization: 'Bearer synthetic' }, null],
  ['other-case-ignored', { AUTHORIZATION: 'Bearer synthetic' }, null],
  ['lowercase-wins', { authorization: 'Basic synthetic', Authorization: 'Bearer synthetic' }, null],
  ['non-error-rejection', { authorization: 'Bearer synthetic' }, 'non-error'],
] as const;
let requestNumber = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('URL', 'https://app.example.com');
  vi.stubEnv('WHATSAPP_BOT_URL', 'https://bot.example.com');
  vi.stubEnv('SYSLAB_PROXY_URL', 'https://bridge.example.com');
  server.mockReturnValue({ db: {} });
  authorize.mockResolvedValue({
    email: 'synthetic@example.test',
    role: 'admin',
    token: { sub: 'synthetic' },
  });
  fetcher.mockImplementation(
    async () =>
      new Response('synthetic', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const [name, handler, method] of functions) {
  describe(name, () => {
    for (const [scenario, headers, error] of cases) {
      it(`preserves complete response for ${scenario}`, async () => {
        if (error) authorize.mockRejectedValue(error === 'non-error' ? null : new Error(error));
        const event: NetlifyEventLike = {
          httpMethod: method,
          headers: {
            origin: 'https://app.example.com',
            ...headers,
            'x-nf-client-connection-ip': `synthetic-${++requestNumber}`,
          },
          body: '{}',
          rawQuery: 'action=unknown',
          path: '/.netlify/functions/whatsapp-proxy/synthetic',
        };
        const response = await handler(event);
        expect(response).toMatchSnapshot();
        if (scenario === 'authorized' || scenario === 'uppercase')
          expect(authorize).toHaveBeenCalledOnce();
        if (['missing', 'malformed', 'other-case-ignored', 'lowercase-wins'].includes(scenario))
          expect(authorize).not.toHaveBeenCalled();
      });
    }
  });
}
