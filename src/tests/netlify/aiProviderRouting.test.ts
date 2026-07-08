import { describe, expect, it, vi } from 'vitest';

import {
  loadClinicalAIRoutingConfigFromFirestore,
  parseFirestoreClinicalAIRoutingDocument,
} from '../../../netlify/functions/lib/ai-provider-routing';

describe('ai-provider-routing', () => {
  it('parses the Firestore routing document into action provider rules', () => {
    const config = parseFirestoreClinicalAIRoutingDocument({
      fields: {
        actions: {
          mapValue: {
            fields: {
              clinical_document_import: {
                mapValue: {
                  fields: {
                    enabled: { booleanValue: true },
                    provider: { stringValue: 'deepseek' },
                    model: { stringValue: 'deepseek-chat' },
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(config).toEqual({
      actions: {
        clinical_document_import: {
          enabled: true,
          provider: 'deepseek',
          model: 'deepseek-chat',
        },
      },
    });
  });

  it('loads the routing document with the user bearer token so Firestore rules remain active', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        fields: {
          actions: {
            mapValue: {
              fields: {
                cie10_search: {
                  mapValue: {
                    fields: {
                      enabled: { booleanValue: true },
                      provider: { stringValue: 'gemini' },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    } as Response);

    const config = await loadClinicalAIRoutingConfigFromFirestore({
      bearerToken: 'token-123',
      fetchImpl,
      env: { VITE_FIREBASE_PROJECT_ID: 'hhr-test' } as NodeJS.ProcessEnv,
      hospitalId: 'H1',
    });

    expect(config?.actions?.cie10_search?.provider).toBe('gemini');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://firestore.googleapis.com/v1/projects/hhr-test/databases/(default)/documents/hospitals/H1/settings/aiProviderRouting',
      {
        headers: {
          Authorization: 'Bearer token-123',
        },
      }
    );
  });
});
