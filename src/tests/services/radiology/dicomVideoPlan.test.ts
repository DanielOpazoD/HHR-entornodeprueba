import { describe, expect, it } from 'vitest';
import {
  defaultDicomVideoOptions,
  describeDicomVideoLength,
  dicomVideoBitrate,
  fitDicomVideoSize,
  sequenceDicomPositions,
  sliceDicomPositions,
  turntableDicomAngles,
  turntableDicomCamera,
  validateDicomVideoFrames,
} from '@/services/radiology/dicomVideoPlan';

describe('video frame sequences', () => {
  it('defaults to an anonymous 720p loop', () => {
    expect(defaultDicomVideoOptions()).toEqual({
      sequence: 'loop',
      resolution: '720p',
      fps: 10,
      anonymous: true,
    });
  });
  it('plays an inclusive slice range once, or back and forth without repeating the turns', () => {
    const forward = sliceDicomPositions(2, 5, 10);
    expect(forward).toEqual([2, 3, 4, 5]);
    expect(sequenceDicomPositions(forward, 'loop')).toEqual([2, 3, 4, 5]);
    expect(sequenceDicomPositions(forward, 'pingpong')).toEqual([2, 3, 4, 5, 4, 3]);
    expect(sequenceDicomPositions([7, 8], 'pingpong')).toEqual([7, 8]);
    expect(sequenceDicomPositions([7], 'pingpong')).toEqual([7]);
    expect(sliceDicomPositions(0, 0, 1)).toEqual([0]);
  });
  it.each([
    [-1, 3, 10],
    [4, 3, 10],
    [0, 10, 10],
    [0.5, 3, 10],
    [0, 3, 0],
  ])('rejects the slice range %s–%s of %s', (start, end, total) => {
    expect(() => sliceDicomPositions(start, end, total)).toThrow('intervalo');
  });
  it('turns 360° in equal steps without repeating the start, or rocks around the view', () => {
    expect(turntableDicomAngles(4, 360)).toEqual([0, 90, 180, 270]);
    expect(turntableDicomAngles(5, 90)).toEqual([-45, -22.5, 0, 22.5, 45]);
    const rocking = sequenceDicomPositions(turntableDicomAngles(48, 360), 'pingpong');
    expect(rocking).toHaveLength(94);
    expect(rocking.at(-1)).toBe(7.5);
    expect(() => turntableDicomAngles(3, 360)).toThrow('cuadros');
    expect(() => turntableDicomAngles(361, 360)).toThrow('cuadros');
    expect(() => turntableDicomAngles(12, 30)).toThrow('giro');
  });
  it('counts frames, bounds them and describes the length', () => {
    expect(validateDicomVideoFrames([1, 2, 3], 5)).toBe(3);
    expect(() => validateDicomVideoFrames([1], 12)).toThrow('velocidad');
    expect(() => validateDicomVideoFrames([], 10)).toThrow('cuadros');
    expect(() => validateDicomVideoFrames([Number.NaN], 10)).toThrow('cuadros');
    expect(() => validateDicomVideoFrames(new Array(2049).fill(0), 10)).toThrow('2048');
    expect(describeDicomVideoLength(6, 5)).toBe('6 cuadros · 1,2 s');
    expect(describeDicomVideoLength(1, 10)).toBe('1 cuadro · 0,1 s');
  });
});

describe('video size and level', () => {
  it('keeps even dimensions inside the box, turned for portrait views, never upscaled', () => {
    expect(fitDicomVideoSize(2000, 1200, '720p')).toEqual({ width: 1200, height: 720 });
    expect(fitDicomVideoSize(2000, 1200, '1080p')).toEqual({ width: 1800, height: 1080 });
    expect(fitDicomVideoSize(1000, 1400, '720p')).toEqual({ width: 720, height: 1008 });
    expect(fitDicomVideoSize(901, 601, '1080p')).toEqual({ width: 900, height: 600 });
    expect(fitDicomVideoSize(1, 1, '720p')).toEqual({ width: 2, height: 2 });
    expect(() => fitDicomVideoSize(0, 10, '720p')).toThrow('Imagen');
    for (const [width, height, resolution, macroblocks] of [
      [4000, 2250, '720p', 3600],
      [4000, 2250, '1080p', 8160],
    ] as const) {
      const size = fitDicomVideoSize(width, height, resolution);
      // H.264 level 3.1 allows 3600 macroblocks per frame and level 4 allows 8192.
      expect(Math.ceil(size.width / 16) * Math.ceil(size.height / 16)).toBe(macroblocks);
    }
  });
  it('grows the bitrate with area from 4 to 8 Mbps', () => {
    expect(dicomVideoBitrate(640, 480)).toBe(4_000_000);
    expect(dicomVideoBitrate(1280, 720)).toBe(4_000_000);
    expect(dicomVideoBitrate(1920, 1080)).toBe(8_000_000);
  });
});

describe('turntable camera', () => {
  const camera = {
    focalPoint: [10, 20, 30],
    position: [10, 20, 130],
    viewUp: [0, 1, 0],
    viewPlaneNormal: [0, 0, 1],
  };
  const close = (actual: number[], expected: number[]) =>
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
  it('orbits the focal point about the screen and patient axes, keeping distance and up', () => {
    const vertical = turntableDicomCamera(camera, 'vertical', 90);
    close(vertical.position, [110, 20, 30]);
    close(vertical.viewUp, [0, 1, 0]);
    expect(vertical.focalPoint).toEqual([10, 20, 30]);
    const horizontal = turntableDicomCamera(camera, 'horizontal', 90);
    close(horizontal.position, [10, -80, 30]);
    close(horizontal.viewUp, [0, 0, 1]);
    const craniocaudal = turntableDicomCamera(camera, 'craniocaudal', 90);
    close(craniocaudal.position, [10, 20, 130]);
    close(craniocaudal.viewUp, [-1, 0, 0]);
  });
  it('starts from the saved camera each time, so a full turn returns the original view', () => {
    close(turntableDicomCamera(camera, 'vertical', 360).position, camera.position);
    close(turntableDicomCamera(camera, 'horizontal', -45).viewUp, [0, Math.SQRT1_2, -Math.SQRT1_2]);
    expect(() => turntableDicomCamera({ ...camera, viewUp: [0, 0, 0] }, 'vertical', 10)).toThrow(
      'giro'
    );
  });
});
