import { describe, expect, it, vi } from 'vitest';
import { parseDicom } from 'dicom-parser';
import { metaData } from '@cornerstonejs/core';
const base = vi.hoisted(() => ({
  metaDataProvider: vi.fn((type: string) =>
    type === 'imagePlaneModule'
      ? {
          rows: 64,
          columns: 64,
          rowPixelSpacing: 1,
          columnPixelSpacing: 1,
          usingDefaultValues: true,
        }
      : undefined
  ),
}));
vi.mock('@cornerstonejs/dicom-image-loader', () => ({ wadouri: { metaData: base } }));
import {
  dicomProjectionCalibration,
  installDicomCalibration,
} from '@/services/radiology/dicomCalibration';
import {
  readDicomSpacingAttributes,
  registerDicomImage,
  releaseDicomImage,
  type DicomSpacingAttributes,
} from '@/services/radiology/dicomImageRegistry';
import { syntheticDicom } from '@/tests/fixtures/syntheticDicom';

const DX = '1.2.840.10008.5.1.4.1.1.1.1';
const CR = '1.2.840.10008.5.1.4.1.1.1';

describe("Cornerstone's projection-radiograph calibration", () => {
  it.each<[string, DicomSpacingAttributes, ReturnType<typeof dicomProjectionCalibration>]>([
    [
      'Imager Pixel Spacing alone is at the detector',
      { sopClass: DX, imagerPixelSpacing: [0.2, 0.2] },
      { spacing: [0.2, 0.2], type: 'Proj' as never },
    ],
    [
      'the magnification factor corrects the detector to the patient',
      { sopClass: DX, imagerPixelSpacing: [0.2, 0.2], magnification: 1.25 },
      { spacing: [0.16, 0.16], type: 'ERMF' as never },
    ],
    [
      'source distances give the magnification when the factor is missing',
      {
        sopClass: CR,
        imagerPixelSpacing: [0.2, 0.2],
        sourceToDetector: 1000,
        sourceToPatient: 800,
      },
      { spacing: [0.16, 0.16], type: 'ERMF' as never },
    ],
    [
      'a Pixel Spacing smaller than the detector is already at the patient',
      { sopClass: DX, imagerPixelSpacing: [0.2, 0.2], pixelSpacing: [0.18, 0.18] },
      { spacing: [0.18, 0.18], type: 'ERMF' as never },
    ],
    [
      'geometry calibration is at the patient',
      { sopClass: DX, pixelSpacing: [0.15, 0.15], calibrationType: 'GEOMETRY' },
      { spacing: [0.15, 0.15], type: 'ERMF' as never },
    ],
    [
      'fiducial calibration is calibrated',
      { sopClass: DX, pixelSpacing: [0.15, 0.15], calibrationType: 'FIDUCIAL' },
      { spacing: [0.15, 0.15], type: 'Calibrated' as never },
    ],
    [
      'Pixel Spacing without Imager Pixel Spacing has no declared place',
      { sopClass: DX, pixelSpacing: [0.15, 0.15] },
      { spacing: [0.15, 0.15], type: 'Unknown' as never },
    ],
  ])('%s', (_, attributes, expected) => {
    const result = dicomProjectionCalibration(attributes);
    expect(result?.type).toBe(expected!.type);
    result!.spacing.forEach((value, axis) => expect(value).toBeCloseTo(expected!.spacing[axis]));
  });

  it('leaves cross-sectional images and images without spacing uncalibrated', () => {
    expect(
      dicomProjectionCalibration({ sopClass: '1.2.840.10008.5.1.4.1.1.2', pixelSpacing: [1, 1] })
    ).toBeUndefined();
    expect(dicomProjectionCalibration({ sopClass: DX })).toBeUndefined();
  });

  it('reads the radiograph tags from the dataset', () => {
    const data = parseDicom(
      syntheticDicom(
        0,
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        { sopClass: DX },
        undefined,
        {
          imagerSpacing: [0.2, 0.2],
          magnification: '1.25',
          omitPixelSpacing: true,
          calibrationType: 'GEOMETRY',
        }
      )
    );
    expect(readDicomSpacingAttributes(data)).toEqual({
      sopClass: DX,
      pixelSpacing: undefined,
      imagerPixelSpacing: [0.2, 0.2],
      calibrationType: 'GEOMETRY',
      magnification: 1.25,
      sourceToDetector: undefined,
      sourceToPatient: undefined,
    });
  });
});

describe('metadata given to Cornerstone for this session', () => {
  const info = (spacing: DicomSpacingAttributes) => ({
    seriesUid: 'synthetic-series',
    seriesNumber: 1,
    index: 0,
    instanceUid: 'synthetic-instance',
    modality: 'DX',
    huCalibrated: false,
    color: false,
    spacing,
  });
  installDicomCalibration();

  it('measures an Imager-Pixel-Spacing radiograph in mm at the detector, not in pixels', () => {
    registerDicomImage('dicomfile:9001', info({ sopClass: DX, imagerPixelSpacing: [0.2, 0.3] }));
    expect(metaData.get('calibratedPixelSpacing', 'dicomfile:9001')).toEqual({ type: 'Proj' });
    // The same object every time: a new one would be a new calibration event.
    expect(metaData.get('calibratedPixelSpacing', 'dicomfile:9001')).toBe(
      metaData.get('calibratedPixelSpacing', 'dicomfile:9001')
    );
    expect(metaData.get('imagePlaneModule', 'dicomfile:9001')).toMatchObject({
      pixelSpacing: [0.2, 0.3],
      rowPixelSpacing: 0.2,
      columnPixelSpacing: 0.3,
      usingDefaultValues: false,
    });
    releaseDicomImage('dicomfile:9001');
    expect(metaData.get('calibratedPixelSpacing', 'dicomfile:9001')).toBeUndefined();
  });

  it('keeps the declared Pixel Spacing module and answers nothing for CT or unknown images', () => {
    registerDicomImage('dicomfile:9002', info({ sopClass: DX, pixelSpacing: [0.15, 0.15] }));
    base.metaDataProvider.mockClear();
    expect(metaData.get('calibratedPixelSpacing', 'dicomfile:9002')).toEqual({ type: 'Unknown' });
    metaData.get('imagePlaneModule', 'dicomfile:9002');
    expect(base.metaDataProvider).not.toHaveBeenCalledWith('imagePlaneModule', 'dicomfile:9002');
    registerDicomImage(
      'dicomfile:9003',
      info({ sopClass: '1.2.840.10008.5.1.4.1.1.2', pixelSpacing: [1, 1] })
    );
    expect(metaData.get('calibratedPixelSpacing', 'dicomfile:9003')).toBeUndefined();
    expect(metaData.get('calibratedPixelSpacing', 'dicomfile:9999')).toBeUndefined();
    releaseDicomImage('dicomfile:9002');
    releaseDicomImage('dicomfile:9003');
  });
});
