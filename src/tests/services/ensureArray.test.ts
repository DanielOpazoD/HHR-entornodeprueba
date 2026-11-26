// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { docToRecord, ensureArray } from '@/services/storage/firestore/firestoreShared';

describe('ensureArray Logic', () => {
  describe('with array input', () => {
    it('should return the array unchanged if correct length', () => {
      const input = ['Nurse 1', 'Nurse 2'];
      const result = ensureArray(input, 2);
      expect(result).toEqual(['Nurse 1', 'Nurse 2']);
    });

    it('should pad array with empty strings if shorter than defaultLength', () => {
      const input = ['Nurse 1'];
      const result = ensureArray(input, 2);
      expect(result).toEqual(['Nurse 1', '']);
    });

    it('should truncate array if longer than defaultLength', () => {
      const input = ['A', 'B', 'C', 'D'];
      const result = ensureArray(input, 2);
      expect(result).toEqual(['A', 'B']);
    });

    it('should handle empty array', () => {
      const result = ensureArray([], 3);
      expect(result).toEqual(['', '', '']);
    });
  });

  describe('with object input (corrupted data from dot-notation patches)', () => {
    it('should convert object with numeric keys to array', () => {
      const input = { '0': 'Nurse 1', '1': 'Nurse 2' };
      const result = ensureArray(input, 2);
      expect(result).toEqual(['Nurse 1', 'Nurse 2']);
    });

    it('should handle sparse object (missing keys)', () => {
      const input = { '0': 'TENS 1', '2': 'TENS 3' };
      const result = ensureArray(input, 3);
      expect(result).toEqual(['TENS 1', '', 'TENS 3']);
    });

    it('should handle object with only one key', () => {
      const input = { '1': 'Only Second' };
      const result = ensureArray(input, 2);
      expect(result).toEqual(['', 'Only Second']);
    });

    it('should handle empty object', () => {
      const input = {};
      const result = ensureArray(input, 2);
      expect(result).toEqual(['', '']);
    });
  });

  describe('with null/undefined input', () => {
    it('should return default array for null', () => {
      const result = ensureArray(null, 2);
      expect(result).toEqual(['', '']);
    });

    it('should return default array for undefined', () => {
      const result = ensureArray(undefined, 3);
      expect(result).toEqual(['', '', '']);
    });
  });

  describe('for nurse arrays (length 2)', () => {
    it('should correctly handle day shift nurses', () => {
      const corrupted = { '0': 'María', '1': 'Juan' };
      const result = ensureArray(corrupted, 2);
      expect(result).toEqual(['María', 'Juan']);
    });
  });

  describe('for TENS arrays (length 3)', () => {
    it('should correctly handle day shift TENS', () => {
      const corrupted = { '0': 'TENS A', '1': 'TENS B', '2': 'TENS C' };
      const result = ensureArray(corrupted, 3);
      expect(result).toEqual(['TENS A', 'TENS B', 'TENS C']);
    });

    it('should correctly handle partial TENS data', () => {
      const corrupted = { '0': 'Only First' };
      const result = ensureArray(corrupted, 3);
      expect(result).toEqual(['Only First', '', '']);
    });
  });
});

describe('Staff Array Sync Integration', () => {
  // These tests verify the expected behavior of how staff arrays should be stored
  // and retrieved, ensuring the fix for dot-notation corruption works end-to-end.

  it('should maintain array integrity when updating nurse selections', () => {
    // Simulate the flow: UI selects nurse -> patchRecord sends complete array
    const currentRecord: Record<'nursesDayShift' | 'nursesNightShift', string[]> = {
      nursesDayShift: ['', ''],
      nursesNightShift: ['', ''],
    };

    // Simulating the selector's slot update
    const selectNurse = (shift: 'day' | 'night', index: number, name: string) => {
      const field: 'nursesDayShift' | 'nursesNightShift' =
        shift === 'day' ? 'nursesDayShift' : 'nursesNightShift';
      const currentArray = [...currentRecord[field]];
      currentArray[index] = name;
      return { [field]: currentArray };
    };

    // First nurse selected
    const patch1 = selectNurse('day', 0, 'María López');
    expect(patch1).toEqual({ nursesDayShift: ['María López', ''] });

    // Apply patch
    currentRecord.nursesDayShift = patch1.nursesDayShift;

    // Second nurse selected
    const patch2 = selectNurse('day', 1, 'Juan Pérez');
    expect(patch2).toEqual({ nursesDayShift: ['María López', 'Juan Pérez'] });
  });

  it('should maintain array integrity when updating TENS selections', () => {
    const currentRecord: Record<'tensDayShift' | 'tensNightShift', string[]> = {
      tensDayShift: ['', '', ''],
      tensNightShift: ['', '', ''],
    };

    const selectTens = (shift: 'day' | 'night', index: number, name: string) => {
      const field: 'tensDayShift' | 'tensNightShift' =
        shift === 'day' ? 'tensDayShift' : 'tensNightShift';
      const currentArray = [...currentRecord[field]];
      currentArray[index] = name;
      return { [field]: currentArray };
    };

    // Add TENS in sequence
    currentRecord.tensDayShift = selectTens('day', 0, 'TENS 1').tensDayShift;
    currentRecord.tensDayShift = selectTens('day', 2, 'TENS 3').tensDayShift;
    currentRecord.tensDayShift = selectTens('day', 1, 'TENS 2').tensDayShift;

    expect(currentRecord.tensDayShift).toEqual(['TENS 1', 'TENS 2', 'TENS 3']);
  });

  it('promotes legacy nurses into canonical staffing when reading a record', () => {
    const record = docToRecord(
      {
        date: '2026-03-07',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-03-07T12:00:00.000Z',
        nurses: ['María', 'Juan'],
        nurseName: 'Nombre legacy',
        nursesNightShift: ['Carla'],
      },
      '2026-03-07'
    );

    expect(record.nursesDayShift).toEqual(['María', 'Juan']);
    expect(record.nurses).toEqual(['María', 'Juan']);
    expect(record.nursesNightShift).toEqual(['Carla']);
  });
});
