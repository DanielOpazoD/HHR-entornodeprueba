import { describe, expect, it } from 'vitest';
import {
  resolvePatientRowMenuAlign,
  shouldRenderEmptyBedsDivider,
} from '@/features/census/controllers/censusTableBodyController';

describe('censusTableBodyController', () => {
  it('resolves top align for early rows and bottom align for last rows', () => {
    expect(resolvePatientRowMenuAlign(0, 10)).toBe('top');
    expect(resolvePatientRowMenuAlign(5, 10)).toBe('top');
    expect(resolvePatientRowMenuAlign(6, 10)).toBe('bottom');
    expect(resolvePatientRowMenuAlign(9, 10)).toBe('bottom');
  });

  it('always resolves bottom when total rows are small', () => {
    expect(resolvePatientRowMenuAlign(0, 1)).toBe('bottom');
    expect(resolvePatientRowMenuAlign(1, 2)).toBe('bottom');
  });

  it('renders empty beds divider only when empty beds exist', () => {
    expect(shouldRenderEmptyBedsDivider(0)).toBe(false);
    expect(shouldRenderEmptyBedsDivider(1)).toBe(true);
  });
});
