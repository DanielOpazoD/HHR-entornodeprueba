import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import pilot from '../../../config/specialty-jev-pilot.hhr-pruebas.json';
import catalog from '../../../public/data/cie10_spanish.json';

const require = createRequire(import.meta.url);
const { validatePolicy } = require('../../../functions/lib/specialtyRules.js');

describe('hhr-pruebas Jev pilot catalog', () => {
  it('uses exact local CIE-10 labels and stays consultative without automatic writes', () => {
    expect(validatePolicy(pilot)).toBe(true);
    expect(pilot.autoEnabled).toBe(false);
    expect(pilot.memoryEnabled).toBe(false);
    expect(pilot.aiMode).toBe('consultative');
    for (const [code, label] of Object.entries(pilot.diagnosisLabels)) {
      expect(catalog).toContainEqual(expect.objectContaining({ code, description: label }));
    }
  });
});
