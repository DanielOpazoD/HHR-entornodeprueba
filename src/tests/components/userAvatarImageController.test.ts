import { describe, expect, it } from 'vitest';

import { calculateCenteredAvatarCrop } from '@/components/layout/userAvatarImageController';

describe('userAvatarImageController', () => {
  it('centers a landscape image into a square avatar crop', () => {
    expect(calculateCenteredAvatarCrop({ width: 1200, height: 800 })).toEqual({
      sourceX: 200,
      sourceY: 0,
      sourceSize: 800,
    });
  });

  it('centers a portrait image into a square avatar crop', () => {
    expect(calculateCenteredAvatarCrop({ width: 600, height: 900 })).toEqual({
      sourceX: 0,
      sourceY: 150,
      sourceSize: 600,
    });
  });
});
