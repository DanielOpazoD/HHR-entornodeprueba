import { describe, expect, it } from 'vitest';
import { mergeClinicalSourceCheckpoint } from '@/features/rayen-import/domain/clinicalIncrementalSync';

describe('clinical incremental checkpoint', () => {
  it('classifies the same source fact as a duplicate without changing the checkpoint', () => {
    const first = mergeClinicalSourceCheckpoint(undefined, 'vitals', [
      { sourceId: 10, watermark: 10, value: { heartRate: 80 } },
    ]);
    const second = mergeClinicalSourceCheckpoint(first.checkpoint, 'vitals', [
      { sourceId: 10, watermark: 10, value: { heartRate: 80 } },
    ]);

    expect(first.metrics).toMatchObject({ newFacts: 1, duplicates: 0, corrections: 0 });
    expect(second.metrics).toMatchObject({ newFacts: 0, duplicates: 1, corrections: 0 });
    expect(second.changed).toBe(false);
    expect(second.checkpoint).toBe(first.checkpoint);
  });

  it('accepts a late correction with the same source identity and keeps no plaintext values', () => {
    const first = mergeClinicalSourceCheckpoint(undefined, 'scales', [
      { sourceId: 'BRADEN:10', watermark: 10, value: { total: 17, author: 'Persona Uno' } },
    ]);
    const corrected = mergeClinicalSourceCheckpoint(first.checkpoint, 'scales', [
      { sourceId: 'BRADEN:10', watermark: 10, value: { total: 11, author: 'Persona Uno' } },
    ]);

    expect(corrected.metrics).toMatchObject({ newFacts: 0, duplicates: 0, corrections: 1 });
    expect(corrected.changed).toBe(true);
    expect(JSON.stringify(corrected.checkpoint)).not.toContain('Persona Uno');
    expect(JSON.stringify(corrected.checkpoint)).not.toContain('BRADEN:10');
  });

  it('invalidates an incompatible checkpoint safely and rebuilds it from source truth', () => {
    const incompatible = {
      version: 99,
      fingerprintVersion: 99,
      sources: {},
    } as never;
    const result = mergeClinicalSourceCheckpoint(incompatible, 'staffing', [
      { watermark: '2026-07-27T08:00:00Z', value: { role: 'TENS' } },
    ]);

    expect(result.changed).toBe(true);
    expect(result.checkpoint).toMatchObject({ version: 2, fingerprintVersion: 1 });
    expect(result.metrics.newFacts).toBe(1);
  });

  it('counts only repeated identities as duplicates and retains the 128 newest facts', () => {
    const facts = Array.from({ length: 200 }, (_, index) => ({
      sourceId: index,
      watermark: index,
      value: { value: index },
    }));
    const first = mergeClinicalSourceCheckpoint(undefined, 'vitals', facts);

    expect(first.metrics).toEqual({
      received: 200,
      newFacts: 200,
      duplicates: 0,
      corrections: 0,
    });
    expect(first.checkpoint.sources.vitals?.facts).toHaveLength(128);
    expect(first.checkpoint.sources.vitals?.watermark).toBe('199');

    const newestRetry = mergeClinicalSourceCheckpoint(first.checkpoint, 'vitals', [facts[199]]);
    expect(newestRetry.metrics).toMatchObject({ newFacts: 0, duplicates: 1, corrections: 0 });
  });

  it('reports duplicate identities inside one source response without treating retention as dedupe', () => {
    const repeated = { sourceId: 10, watermark: 10, value: { heartRate: 80 } };
    const result = mergeClinicalSourceCheckpoint(undefined, 'vitals', [repeated, repeated]);

    expect(result.metrics).toEqual({
      received: 2,
      newFacts: 1,
      duplicates: 1,
      corrections: 0,
    });
  });

  it('preserves retained overlap facts when a later response is partial or empty', () => {
    const first = mergeClinicalSourceCheckpoint(undefined, 'vitals', [
      { sourceId: 10, watermark: 10, value: { heartRate: 80 } },
      { sourceId: 11, watermark: 11, value: { heartRate: 81 } },
    ]);
    const partial = mergeClinicalSourceCheckpoint(first.checkpoint, 'vitals', [
      { sourceId: 11, watermark: 11, value: { heartRate: 81 } },
    ]);
    const empty = mergeClinicalSourceCheckpoint(partial.checkpoint, 'vitals', []);

    expect(partial.checkpoint.sources.vitals?.facts).toHaveLength(2);
    expect(empty.changed).toBe(false);
    expect(empty.checkpoint).toBe(partial.checkpoint);
  });
});
