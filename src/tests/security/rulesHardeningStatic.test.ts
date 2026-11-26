// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const readProjectFile = (relativePath: string): string => {
  const absolutePath = path.resolve(__dirname, '../../../', relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
};

describe('Security hardening static guards', () => {
  it('does not keep hardcoded bootstrap admin allowlists in auth or rules surfaces', () => {
    const EXPECTED_BOOTSTRAP_ADMINS = [
      'daniel.opazo@hospitalhangaroa.cl',
      'd.opazo.damiani@gmail.com',
    ];

    const rules = readProjectFile('firestore.rules');
    const storageRules = readProjectFile('storage.rules');
    const authConfig = readProjectFile('functions/lib/auth/authConfig.js');
    const authShared = readProjectFile('src/services/auth/authShared.ts');
    const netlifyAuth = readProjectFile('netlify/functions/lib/firebase-auth.ts');

    expect(rules).not.toContain('function isBootstrapAdmin(');
    expect(storageRules).not.toContain('function isBootstrapAdmin(');
    expect(authConfig).not.toContain('BOOTSTRAP_ADMIN_EMAILS');
    expect(authShared).not.toContain('BOOTSTRAP_ADMIN_EMAILS');
    expect(netlifyAuth).not.toContain('BOOTSTRAP_ADMIN_EMAILS');

    for (const email of EXPECTED_BOOTSTRAP_ADMINS) {
      expect(rules).not.toContain(email);
      expect(storageRules).not.toContain(email);
      expect(authConfig).not.toContain(email);
      expect(authShared).not.toContain(email);
      expect(netlifyAuth).not.toContain(email);
    }
  });
});
