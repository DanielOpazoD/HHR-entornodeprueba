import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');
const SRC_ROOT = path.join(ROOT, 'src');

const ALLOWED_LEGACY_HYDRATION_BOUNDARIES = new Set([
  'src/application/ports/clinicalDocumentCompatibilityPort.ts',
  'src/domain/clinical-documents/compatibility.ts',
  'src/features/clinical-documents/controllers/clinicalDocumentCompatibilityController.ts',
]);

const collectSourceFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }

    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
};

describe('Clinical documents import governance', () => {
  it('keeps external modules out of deep clinical-documents imports', () => {
    const command =
      'grep -R "@/features/clinical-documents/" src --include="*.ts" --include="*.tsx" ' +
      '| grep -v "src/features/clinical-documents/" ' +
      '| grep -v "src/tests/" ' +
      '| grep -v "from \'@/features/clinical-documents/internal\'" ' +
      '| grep -v "from \\"@/features/clinical-documents/internal\\"" ' +
      '| grep -v "from \'@/features/clinical-documents/public\'" ' +
      '| grep -v "from \\"@/features/clinical-documents/public\\""';

    let rawOutput = '';
    try {
      rawOutput = execSync(command, { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch (error) {
      const execError = error as { status?: number; stdout?: string | Buffer };
      const stdout = String(execError.stdout || '').trim();
      if (execError.status === 1 && stdout.length === 0) {
        rawOutput = '';
      } else {
        throw error;
      }
    }

    expect(rawOutput).toBe('');
  });

  it('keeps legacy clinical-document hydration behind the compatibility port', () => {
    const violations = collectSourceFiles(SRC_ROOT)
      .map(file => {
        const relativePath = path.relative(ROOT, file);
        if (
          relativePath.includes('/tests/') ||
          relativePath.includes('.test.') ||
          /^src\/features\/clinical-documents\/(public|internal)\.ts$/.test(relativePath) ||
          ALLOWED_LEGACY_HYDRATION_BOUNDARIES.has(relativePath)
        ) {
          return null;
        }

        const content = fs.readFileSync(file, 'utf8');
        return /\bhydrateLegacyClinicalDocument\b/.test(content) ? relativePath : null;
      })
      .filter(Boolean)
      .sort();

    expect(violations).toEqual([]);
  });
});
