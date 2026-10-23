import { describe, expect, it } from 'vitest';
import { planDicomVolume, type SliceGeometry } from '@/domain/radiology/dicomGeometry';
import { resampleDicomVolume } from '@/domain/radiology/dicomResampling';

const mixed = (): SliceGeometry[] =>
  [0, 1, 2].map(i => ({
    imageId: `synthetic-${i}`,
    frame: 'synthetic-frame',
    rows: i === 1 ? 2 : 4,
    columns: i === 1 ? 3 : 6,
    spacing: i === 1 ? [2, 2] : [1, 1],
    position: i === 1 ? [0.5, 0.5, i * 2] : [0, 0, i * 2],
    orientation: [1, 0, 0, 0, 1, 0],
  }));
const signal = () => new AbortController().signal;
const ramp = (slice: SliceGeometry, preScaled = false) => ({
  pixels: Float32Array.from({ length: slice.rows * slice.columns }, (_, i) => {
    const x = slice.position[0] + (i % slice.columns) * slice.spacing[1];
    const y = slice.position[1] + Math.floor(i / slice.columns) * slice.spacing[0];
    const value = x + 10 * y + 100 * slice.position[2];
    return preScaled ? value * 2 - 1024 : value;
  }),
  slope: 2,
  intercept: -1024,
  preScaled,
});

describe('physical DICOM matrix normalization', () => {
  it('uses pixel-edge coverage, finest spacing and ascending patient-space slices', () => {
    const plan = planDicomVolume(mixed().reverse());
    expect(plan.resampled).toBe(true);
    expect(plan.dimensions).toEqual([6, 4, 3]);
    expect(plan.spacing).toEqual([1, 1, 2]);
    expect(plan.origin).toEqual([0, 0, 0]);
    expect(plan.slices.map(s => s.imageId)).toEqual(['synthetic-0', 'synthetic-1', 'synthetic-2']);
  });
  it('preserves calibrated intensities and physical alignment without modifying originals', async () => {
    const plan = planDicomVolume(mixed());
    const sources = plan.slices.map((s, i) => ramp(s, i === 1));
    const copies = sources.map(s => s.pixels.slice());
    const result = await resampleDicomVolume(plan, (_, i) => sources[i], signal());
    // Interior of coarse plane: x=2,y=1,z=2, not array-index interpolation.
    expect(result[24 + 6 + 2]).toBe(2 * (2 + 10 + 200) - 1024);
    expect(result[6 + 2]).toBe(2 * (2 + 10) - 1024);
    expect(result[48 + 6 + 2]).toBe(2 * (2 + 10 + 400) - 1024);
    // Edge extends only to its acquired half-pixel footprint; never invents air.
    expect(result[24]).toBe(2 * (0.5 + 5 + 200) - 1024);
    expect(sources.map(s => s.pixels)).toEqual(copies);
  });
  it('supports oblique planes and anisotropic rectangular matrices without swapping axes', () => {
    const slices = mixed().map(s => ({
      ...s,
      orientation: [0, 1, 0, 0, 0, 1],
      position: [s.position[2], s.position[0] * 3, s.position[1] * 2],
      spacing: [s.spacing[0] * 2, s.spacing[1] * 3],
    }));
    const plan = planDicomVolume(slices.reverse());
    expect(plan.dimensions).toEqual([6, 4, 3]);
    expect(plan.spacing).toEqual([3, 2, 2]);
    expect(plan.direction).toEqual([0, 1, 0, 0, 0, 1, 1, 0, 0]);
    expect(plan.origin).toEqual([0, 0, 0]);
  });
  it.each(['coverage', 'offset', 'frame', 'gap', 'duplicate', 'orientation', 'spacing', 'size'])(
    'rejects unsafe %s without silently cropping or dropping images',
    reason => {
      const slices = mixed();
      if (reason === 'coverage') slices[1].columns++;
      if (reason === 'offset') slices[1].position[0] += 1;
      if (reason === 'frame') slices[1].frame = 'other-frame';
      if (reason === 'gap') slices[2].position[2] = 8;
      if (reason === 'duplicate') slices[2].position[2] = 2;
      if (reason === 'orientation') slices[1].orientation = [0, 1, 0, 1, 0, 0];
      if (reason === 'spacing') slices[1].spacing[0] = NaN;
      if (reason === 'size') slices[1].rows = 2.5;
      expect(() => planDicomVolume(slices)).toThrow();
    }
  );
  it('rejects duplicated thin slices even when the old absolute gap tolerance would hide them', () => {
    const slices = mixed();
    slices[1].position[2] = 0;
    slices[2].position[2] = 0.04;
    expect(() => planDicomVolume(slices)).toThrow(/repetidos/);
  });
  it('uses physical coordinates in a non-axis-aligned plane', async () => {
    const q = Math.SQRT1_2;
    const slices = mixed().map(s => ({
      ...s,
      orientation: [q, q, 0, -q, q, 0],
      position: [
        (s.position[0] - s.position[1]) * q,
        (s.position[0] + s.position[1]) * q,
        s.position[2],
      ],
    }));
    const result = await resampleDicomVolume(
      planDicomVolume(slices),
      (_, i) => ramp(mixed()[i]),
      signal()
    );
    expect(result[24 + 6 + 2]).toBeCloseTo(2 * (2 + 10 + 200) - 1024, 4);
  });
  it('rejects tiny angular differences that move large-field edges', () => {
    const slices = mixed().map(s => ({ ...s, rows: s.rows * 256, columns: s.columns * 256 }));
    const angle = 0.00009;
    slices[1].orientation = [
      Math.cos(angle),
      Math.sin(angle),
      0,
      -Math.sin(angle),
      Math.cos(angle),
      0,
    ];
    expect(() => planDicomVolume(slices)).toThrow(/orientaciones/);
  });
  it('rejects submillimeter field shifts that span high-resolution pixels', () => {
    const slices = mixed().map(s => ({
      ...s,
      spacing: s.spacing.map(v => v * 0.05),
      position: s.position.map((v, i) => (i < 2 ? v * 0.05 : v)),
    }));
    slices[1].position[0] += 0.09;
    expect(() => planDicomVolume(slices)).toThrow(/campos físicos/);
  });
  it('checks acquired footprints independently before edge replication', async () => {
    const plan = planDicomVolume(mixed());
    plan.origin[0] -= 0.6;
    await expect(resampleDicomVolume(plan, s => ramp(s), signal())).rejects.toThrow(
      /excede el campo adquirido/
    );
  });
  it('rejects excessive output allocation before reading pixels', () => {
    const slices = mixed().map(s => ({ ...s, rows: s.rows * 2048, columns: s.columns * 2048 }));
    expect(() => planDicomVolume(slices)).toThrow(/memoria/);
  });
  it('rejects missing or non-finite decoded samples and invalid scaling', async () => {
    const plan = planDicomVolume(mixed());
    for (const failure of ['length', 'nan', 'slope', 'overflow']) {
      const source = ramp(plan.slices[0]);
      if (failure === 'length') source.pixels = new Float32Array(1);
      if (failure === 'nan') source.pixels[0] = NaN;
      if (failure === 'slope') source.slope = 0;
      if (failure === 'overflow') source.intercept = 1e100;
      await expect(resampleDicomVolume(plan, () => source, signal())).rejects.toThrow();
    }
  });
  it('cancels before reading pixels and between chunks', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      resampleDicomVolume(
        planDicomVolume(mixed()),
        () => {
          throw new Error('must not read pixels');
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    const during = new AbortController();
    const plan = planDicomVolume(mixed());
    await expect(
      resampleDicomVolume(
        plan,
        s => {
          during.abort();
          return ramp(s);
        },
        during.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
