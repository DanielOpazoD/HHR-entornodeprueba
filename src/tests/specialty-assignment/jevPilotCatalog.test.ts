import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import pilot from '../../../config/specialty-jev-pilot.hhr-pruebas.json';
import catalog from '../../../public/data/cie10_spanish.json';

const require = createRequire(import.meta.url);
const { validatePolicy } = require('../../../functions/lib/specialtyRules.js');
const { getCie10Label } = require('../../../functions/lib/specialtyCie10Catalog.js');

describe('hhr-pruebas Jev pilot catalog', () => {
  it('packages the complete browser CIE-10 catalog for server-side Jev validation', () => {
    expect(validatePolicy(pilot)).toBe(true);
    expect(pilot.autoEnabled).toBe(false);
    expect(pilot.memoryEnabled).toBe(false);
    expect(pilot.aiMode).toBe('consultative');
    for (const entry of catalog) expect(getCie10Label(entry.code)).toBe(entry.description);
    expect(getCie10Label('J18.9999')).toBeNull();
  });
});
