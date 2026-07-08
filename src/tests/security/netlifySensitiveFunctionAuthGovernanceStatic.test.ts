import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');

const SENSITIVE_NETLIFY_FUNCTIONS = [
  'netlify/functions/cie10-ai-search.ts',
  'netlify/functions/clinical-attachment-name-suggestion.ts',
  'netlify/functions/clinical-ai-summary.ts',
  'netlify/functions/fhir-api.ts',
  'netlify/functions/mmrad-search.ts',
  'netlify/functions/send-census-email.ts',
  'netlify/functions/send-fuga-notification.ts',
  'netlify/functions/syslab-proxy.ts',
  'netlify/functions/whatsapp-proxy.ts',
];

describe('Netlify sensitive function auth governance', () => {
  it('keeps origin validation and bearer role authorization on every sensitive function', () => {
    const violations = SENSITIVE_NETLIFY_FUNCTIONS.flatMap(file => {
      const contents = readFileSync(path.join(ROOT, file), 'utf8');
      const missingChecks: string[] = [];

      if (!contents.includes('isOriginAllowed')) {
        missingChecks.push('isOriginAllowed');
      }
      if (!contents.includes('extractBearerToken')) {
        missingChecks.push('extractBearerToken');
      }
      if (!contents.includes('authorizeRoleRequest')) {
        missingChecks.push('authorizeRoleRequest');
      }

      return missingChecks.length > 0 ? [`${file}: ${missingChecks.join(', ')}`] : [];
    });

    expect(violations).toEqual([]);
  });
});
