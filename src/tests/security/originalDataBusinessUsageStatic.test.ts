// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');

/**
 * `originalData` holds the pre-movement patient snapshot inside completed
 * discharges, transfers, and CMA records so movements can be undone, audited,
 * or matched historically. It must never leak into React UI rendering, shared
 * views/components/context, or live clinical state hooks outside the dedicated
 * movement-undo executor.
 */
const ALLOWED_ORIGINAL_DATA_LAYER_PATTERNS: readonly RegExp[] = [
  /^src\/(types|schemas)\/.+\.ts$/,
  /^src\/(domain|application)\/.+\.ts$/,
  /^src\/services\/.+\.ts$/,
  /^src\/features\/rayen-import\/domain\/.+\.ts$/,
  /^src\/features\/admin\/(services|admission-audit)\/.+\.ts$/,
  /^src\/features\/census\/(controllers|services|email\/controllers)\/.+\.ts$/,
];

const ALLOWED_SINGLE_FILE_EXCEPTIONS = new Set([
  // Integrity scoring checks preserved movement snapshots to avoid misclassifying valid discharges as erasures.
  'src/utils/integrityGuard.ts',
  // Movement undo hook reads the preserved snapshot solely to restore an undone discharge/transfer.
  'src/hooks/usePatientMovementUndoExecutor.ts',
]);

const isAllowedOriginalDataPath = (relativePath: string): boolean =>
  ALLOWED_SINGLE_FILE_EXCEPTIONS.has(relativePath) ||
  ALLOWED_ORIGINAL_DATA_LAYER_PATTERNS.some(pattern => pattern.test(relativePath));

describe('originalData business governance', () => {
  it('confines originalData references to non-UI domain, application, service, audit and undo layers', () => {
    const command =
      'grep -rl "originalData" src --include="*.ts" --include="*.tsx" | grep -v "src/tests/" | grep -v "\\.md$"';
    const rawOutput = execSync(command, { cwd: ROOT, encoding: 'utf8' });
    const referencedFiles = rawOutput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .sort();

    const uiTsxReferences = referencedFiles.filter(file => file.endsWith('.tsx'));
    expect(uiTsxReferences, 'React (.tsx) UI components must never read originalData').toEqual([]);

    const disallowedReferences = referencedFiles.filter(file => !isAllowedOriginalDataPath(file));
    expect(
      disallowedReferences,
      'originalData may only be referenced in approved domain/application/service/audit/undo layers'
    ).toEqual([]);

    // Sanity check that the guard is scanning live files rather than matching nothing.
    expect(referencedFiles.length).toBeGreaterThan(0);
  });
});
