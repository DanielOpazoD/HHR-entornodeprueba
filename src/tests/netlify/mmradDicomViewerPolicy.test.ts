import { describe, expect, it } from 'vitest';
import { viewerStudyFromHtml } from '../../../netlify/functions/lib/mmrad-dicom-policy';

const viewer = 'https://hhangaroavisor.mmrad.cl:4446/viewer/1.2.3';
const iframe = (src: string) => `<iframe src="${src}"></iframe>`;

describe('MMRAD viewer iframe selection', () => {
  it('finds the approved viewer independently of auxiliary iframe order', () => {
    const auxiliary = iframe('https://ris.mmrad.cl/auxiliary?synthetic=1');
    expect(viewerStudyFromHtml(auxiliary + iframe(viewer))).toBe('1.2.3');
    expect(viewerStudyFromHtml(iframe(viewer) + auxiliary)).toBe('1.2.3');
    expect(viewerStudyFromHtml(iframe('about:blank') + iframe(viewer))).toBe('1.2.3');
  });

  it('rejects ambiguous studies instead of choosing the first', () => {
    expect(() => viewerStudyFromHtml(iframe(viewer) + iframe(`${viewer}.4`))).toThrow();
    expect(viewerStudyFromHtml(iframe(viewer) + iframe(viewer))).toBe('1.2.3');
  });

  it.each([
    'https://evil.example.com/viewer/1.2.3',
    'https://hhangaroavisor.mmrad.cl/viewer/1.2.3',
    'http://hhangaroavisor.mmrad.cl:4446/viewer/1.2.3',
    'https://user@hhangaroavisor.mmrad.cl:4446/viewer/1.2.3',
    `${viewer}?extra=1`,
    `${viewer}#fragment`,
    `${viewer}/extra`,
    'https://hhangaroavisor.mmrad.cl:4446/viewer/not-a-uid',
  ])('keeps the fixed origin and study URL constraints: %s', src => {
    expect(() => viewerStudyFromHtml(iframe(src))).toThrow();
  });

  it('does not treat data-src as a viewer source', () => {
    expect(() => viewerStudyFromHtml(`<iframe data-src="${viewer}"></iframe>`)).toThrow();
  });
});
