// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type BuildClinicalAge = (birthDate: string, referenceDate: Date) => string;

const loadBuildClinicalAge = (): BuildClinicalAge => {
  const source = readFileSync(new URL('../../../extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('const buildClinicalAge =');
  const end = source.indexOf('\n\nconst parseJsonResponseSafely', start);
  if (start < 0 || end < 0) throw new Error('No se encontró buildClinicalAge.');
  const context = vm.createContext({});
  vm.runInContext(
    `
    'use strict';
    ${source.slice(start, end)}
    globalThis.__buildClinicalAge = buildClinicalAge;
  `,
    context
  );
  return (context as unknown as { __buildClinicalAge: BuildClinicalAge }).__buildClinicalAge;
};

describe('extension clinical age encoding', () => {
  const buildClinicalAge = loadBuildClinicalAge();

  it('keeps calendar-age components non-negative across a short month', () => {
    const age = buildClinicalAge('2025-01-31', new Date(2025, 2, 1, 0, 0, 0));

    expect(age).toBe('0010100');
    expect(age).toMatch(/^\d+$/);
    expect(age).not.toContain('-');
  });

  it('rejects future and malformed birth dates', () => {
    const reference = new Date(2025, 2, 1, 0, 0, 0);

    expect(buildClinicalAge('2026-01-01', reference)).toBe('');
    expect(buildClinicalAge('fecha inválida', reference)).toBe('');
    expect(buildClinicalAge('2025-02-31', reference)).toBe('');
  });
});
