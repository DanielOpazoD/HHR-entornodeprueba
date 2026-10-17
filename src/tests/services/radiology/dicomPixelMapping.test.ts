import { describe, expect, it } from 'vitest';
import { parseDicom } from 'dicom-parser';
import { supportsDicomResampling } from '@/services/radiology/dicomPixelMapping';
import { syntheticDicom, SYNTHETIC_PATIENT_ID } from '@/tests/fixtures/syntheticDicom';

describe('DICOM resampling mapping eligibility', () => {
  it('accepts a conventional linear original', () => {
    expect(supportsDicomResampling(parseDicom(syntheticDicom(0)))).toBe(true);
  });
  it('rejects a nested real-world mapping in a one-frame enhanced object', () => {
    const data = parseDicom(
      syntheticDicom(0, 24, SYNTHETIC_PATIENT_ID, undefined, undefined, {
        rows: 32,
        columns: 32,
        spacing: [2, 2],
        position: [0.5, 0.5],
        functionalGroupMapping: true,
      }),
      { untilTag: 'x7fe00010' }
    );
    expect(data.string('x00280008')).toBe('1');
    expect(data.elements.x00409096).toBeUndefined();
    expect(data.elements.x52009229.items?.[0].dataSet?.elements.x00409096).toBeDefined();
    expect(supportsDicomResampling(data)).toBe(false);
  });
  it.each(['x00280120', 'x00280121', 'x00283000', 'x00409096', 'x52009229', 'x52009230'])(
    'rejects unsupported %s even when calibration details are absent',
    tag => {
      const data = parseDicom(syntheticDicom(0));
      data.elements[tag] = { tag, vr: 'SQ', length: 0, dataOffset: 0 };
      expect(supportsDicomResampling(data)).toBe(false);
    }
  );
});
