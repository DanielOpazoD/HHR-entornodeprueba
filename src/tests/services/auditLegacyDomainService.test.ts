import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('auditLegacyDomainService migration surface', () => {
  it('removes the legacy audit facade files after migration to AuditContext', () => {
    expect(existsSync(resolve(repoRoot, 'src/services/admin/auditLegacyDomainService.ts'))).toBe(
      false
    );
    expect(existsSync(resolve(repoRoot, 'src/services/admin/auditDomainLoggers.ts'))).toBe(false);
  });
});
