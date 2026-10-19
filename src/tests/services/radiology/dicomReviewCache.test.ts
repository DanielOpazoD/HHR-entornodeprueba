import { describe, expect, it } from 'vitest';
import { createDicomReviewCache } from '@/services/radiology/dicomReviewCache';

const study = { uid: 'study-a', patientId: '12.345-6', date: '', series: [] };
const series = {
  uid: 'series-a',
  number: 1,
  description: '',
  modality: 'CT',
  rows: 1,
  columns: 1,
  instances: [],
};
const instance = { uid: 'instance-a', number: 1, frames: 1, ticket: 'old-ticket' };
describe('patient review original cache', () => {
  it('uses verified identities, not expiring tickets, and separates studies', () => {
    const cache = createDicomReviewCache('123456');
    const value = new Uint8Array([1, 2]);
    cache.put(study, series, instance, value);
    expect(cache.get(study, series, { ...instance, ticket: 'renewed-ticket' })).toBe(value);
    expect(cache.get({ ...study, uid: 'study-b' }, series, instance)).toBeUndefined();
    expect(() => cache.get({ ...study, patientId: 'other' }, series, instance)).toThrow();
  });
  it('evicts least recently used originals for foreground, but background cannot evict', () => {
    const cache = createDicomReviewCache('123456', 4);
    const b = { ...instance, uid: 'b' },
      c = { ...instance, uid: 'c' };
    cache.put(study, series, instance, new Uint8Array(2));
    cache.put(study, series, b, new Uint8Array(2));
    cache.get(study, series, instance);
    cache.put(study, series, c, new Uint8Array(2), false);
    expect(cache.get(study, series, c)).toBeUndefined();
    cache.put(study, series, c, new Uint8Array(2));
    expect(cache.get(study, series, b)).toBeUndefined();
    expect(cache.get(study, series, instance)).toBeDefined();
    expect(cache.remaining()).toBe(0);
  });
  it('releases all originals and rejects late access when the patient review closes', () => {
    const cache = createDicomReviewCache('123456', 4);
    cache.put(study, series, instance, new Uint8Array(2));
    cache.dispose();
    expect(cache.active()).toBe(false);
    expect(cache.remaining()).toBe(4);
    expect(() => cache.get(study, series, instance)).toThrow();
    expect(() => cache.put(study, series, instance, new Uint8Array(2))).toThrow();
  });
});
