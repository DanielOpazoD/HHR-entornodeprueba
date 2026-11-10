import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../');
const SRC_ROOT = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DAILY_RECORD_ROOT_IMPORTS = [
  '@/types/domain/dailyRecord',
  '@/types/domain/dailyRecordPatch',
  '@/types/domain/dailyRecordSlices',
  '@/types/domain/dailyRecordMedicalHandoff',
];

const toPosix = (value: string) => value.split(path.sep).join('/');

const walkFiles = (dirPath: string): string[] => {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('DailyRecord root import governance', () => {
  it('keeps root DailyRecord imports confined to governed application, hook and service surfaces', () => {
    const files = walkFiles(SRC_ROOT).filter(filePath => {
      const extension = path.extname(filePath);
      return SOURCE_EXTENSIONS.has(extension) && !filePath.endsWith('.d.ts');
    });

    const violations: string[] = [];

    for (const filePath of files) {
      const relative = toPosix(path.relative(ROOT, filePath));
      const source = fs.readFileSync(filePath, 'utf8');

      const importsDailyRecordRoot = DAILY_RECORD_ROOT_IMPORTS.some(importPath =>
        source.includes(importPath)
      );
      if (!importsDailyRecordRoot) continue;

      const isTestFile =
        relative.includes('/tests/') || relative.includes('.test.') || relative.includes('.spec.');
      const isApplicationBypass =
        relative === 'src/application/shared/dailyRecordContracts.ts' ||
        relative === 'src/application/shared/dailyRecordBedContracts.ts' ||
        relative === 'src/application/shared/dailyRecordCoreContracts.ts' ||
        relative === 'src/application/shared/dailyRecordMedicalContracts.ts' ||
        relative === 'src/application/shared/dailyRecordStaffContracts.ts' ||
        isTestFile;
      const isHookBypass = isTestFile;
      const isServiceBypass =
        relative === 'src/services/contracts/dailyRecordServiceContracts.ts' ||
        relative.startsWith('src/services/repositories/') ||
        relative.startsWith('src/services/storage/') ||
        isTestFile;

      if (relative.startsWith('src/application/') && !isApplicationBypass) {
        violations.push(relative);
      }

      if (relative.startsWith('src/hooks/') && !isHookBypass) {
        violations.push(relative);
      }

      if (relative.startsWith('src/services/') && !isServiceBypass) {
        violations.push(relative);
      }
    }

    expect(violations.sort()).toEqual([]);
  });
});
