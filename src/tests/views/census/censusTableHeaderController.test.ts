import { describe, expect, it } from 'vitest';
import {
  buildCensusHeaderCellModels,
  CENSUS_HEADER_COLUMNS,
} from '@/features/census/controllers/censusTableHeaderController';

describe('censusTableHeaderController', () => {
  it('builds header models with diagnosis kind only for diagnosis column', () => {
    const models = buildCensusHeaderCellModels();
    const diagnosisModel = models.find(model => model.key === 'diagnosis');
    const standardModels = models.filter(model => model.key !== 'diagnosis');

    expect(models).toHaveLength(CENSUS_HEADER_COLUMNS.length);
    expect(diagnosisModel?.kind).toBe('diagnosis');
    expect(standardModels.every(model => model.kind === 'standard')).toBe(true);
  });

  it('keeps className/title metadata in generated models', () => {
    const models = buildCensusHeaderCellModels();
    const upc = models.find(model => model.key === 'upc');
    const dmi = models.find(model => model.key === 'dmi');

    expect(upc?.className).toBe('border-r-0');
    expect(dmi?.title).toBe('Dispositivos médicos invasivos');
  });
});
