import { describe, expect, it } from 'vitest';

import {
  groupPhotosByDate,
  hospitalTakenAt,
  resolvePhotoWallClock,
} from '@/application/wound-care/woundCarePhotoTime';
import type { WoundCarePhoto } from '@/types/domain/woundCare';

// Tests run on a mainland (Santiago) device clock; the hospital is in Rapa Nui (UTC-5 in March).
const photo = (id: string, takenAt: string, uploadedAt: string): WoundCarePhoto =>
  ({ id, takenAt, uploadedAt }) as WoundCarePhoto;

describe('wound care photo time', () => {
  it('reads a time typed in the form exactly as the nurse entered it', () => {
    expect(
      resolvePhotoWallClock(photo('typed', '2026-03-03T15:00:00.000Z', '2026-03-03T20:12:41.512Z'))
    ).toEqual({ date: '2026-03-03', time: '15:00' });
  });

  it('reads photos saved without a time of their own on the hospital clock', () => {
    // takenAt === uploadedAt: the upload instant, 21:30 at the hospital (02:30 UTC next day).
    const lateUpload = '2026-03-04T02:30:00.000Z';
    expect(resolvePhotoWallClock(photo('fallback', lateUpload, lateUpload))).toEqual({
      date: '2026-03-03',
      time: '21:30',
    });
    expect(resolvePhotoWallClock({ uploadedAt: lateUpload } as WoundCarePhoto)).toEqual({
      date: '2026-03-03',
      time: '21:30',
    });
  });

  it('never throws on an unreadable stored value', () => {
    expect(resolvePhotoWallClock(photo('broken', 'sin-fecha', 'sin-fecha'))).toEqual({
      date: 'sin-fecha',
      time: '',
    });
  });

  it('keeps a late-evening upload in the session of its hospital day, in time order', () => {
    const sessions = groupPhotosByDate([
      photo('evening-fallback', '2026-03-04T02:30:00.000Z', '2026-03-04T02:30:00.000Z'),
      photo('afternoon-typed', '2026-03-03T15:00:00.000Z', '2026-03-03T20:12:41.512Z'),
      photo('next-morning', '2026-03-04T08:15:00.000Z', '2026-03-04T13:20:00.000Z'),
    ]);

    expect(sessions.map(session => [session.date, session.photos.map(p => p.id)])).toEqual([
      ['2026-03-04', ['next-morning']],
      ['2026-03-03', ['afternoon-typed', 'evening-fallback']],
    ]);
  });

  it('writes new times in the stored wall-clock format', () => {
    expect(hospitalTakenAt(new Date('2026-11-01T04:30:00.000Z'))).toBe('2026-10-31T23:30:00.000Z');
  });
});
