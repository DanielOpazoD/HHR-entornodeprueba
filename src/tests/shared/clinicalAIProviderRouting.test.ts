import { describe, expect, it } from 'vitest';

import {
  createDefaultClinicalAIProviderRoutingDocument,
  normalizeClinicalAIProviderRoutingDocument,
} from '@/shared/ai/clinicalAIProviderRouting';

describe('clinicalAIProviderRouting', () => {
  it('normalizes only supported action/provider pairs', () => {
    const normalized = normalizeClinicalAIProviderRoutingDocument({
      actions: {
        clinical_document_import: {
          enabled: true,
          provider: 'deepseek',
          model: 'deepseek-chat',
        },
        unknown_action: {
          enabled: true,
          provider: 'gemini',
        },
        cie10_search: {
          enabled: true,
          provider: 'unknown-provider',
        },
        clinical_attachment_name_suggestion: {
          enabled: true,
          provider: 'deepseek',
          model: 'deepseek-chat',
        },
      },
      updatedAt: '2026-05-11T00:00:00.000Z',
      updatedByEmail: 'admin@hospital.cl',
    });

    expect(normalized).toEqual({
      actions: {
        clinical_document_import: {
          enabled: true,
          provider: 'deepseek',
          model: 'deepseek-chat',
        },
        cie10_search: {
          enabled: true,
          provider: null,
          model: null,
        },
        clinical_attachment_name_suggestion: {
          enabled: true,
          provider: 'deepseek',
          model: 'deepseek-chat',
        },
      },
      updatedAt: '2026-05-11T00:00:00.000Z',
      updatedByEmail: 'admin@hospital.cl',
    });
  });

  it('creates default routing without forcing a provider over Netlify env', () => {
    expect(createDefaultClinicalAIProviderRoutingDocument()).toMatchObject({
      actions: {
        clinical_document_import: { enabled: true, provider: null },
        clinical_ai_summary: { enabled: true, provider: null },
        cie10_search: { enabled: true, provider: null },
        clinical_attachment_name_suggestion: { enabled: true, provider: 'deepseek' },
      },
    });
  });
});
