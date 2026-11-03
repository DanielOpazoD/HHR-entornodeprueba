import { Enums, metaData, utilities, type Types } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { dicomImageInfo, type DicomSpacingAttributes } from './dicomImageRegistry';

export interface DicomProjectionCalibration {
  /** Row and column spacing in mm that Cornerstone chose for a projection radiograph. */
  spacing: [number, number];
  /** Cornerstone's calibration label: ERMF, Calibrated, Proj or Unknown. */
  type: Enums.CalibrationTypes;
}

/**
 * Projection radiographs follow Cornerstone's own rules (`getPixelSpacingInformation`):
 * Pixel Spacing at the patient (ERMF or fiducial calibration), Imager Pixel Spacing at the
 * detector (Proj), or corrected by the magnification factor (ERMF). Cross-sectional images
 * return nothing and keep their Pixel Spacing. Without any spacing there is no calibration.
 */
export const dicomProjectionCalibration = (
  attributes: DicomSpacingAttributes
): DicomProjectionCalibration | undefined => {
  const result = utilities.getPixelSpacingInformation({
    SOPClassUID: attributes.sopClass,
    PixelSpacing: attributes.pixelSpacing,
    ImagerPixelSpacing: attributes.imagerPixelSpacing,
    PixelSpacingCalibrationType: attributes.calibrationType,
    EstimatedRadiographicMagnificationFactor: attributes.magnification,
    DistanceSourceToDetector: attributes.sourceToDetector,
    DistanceSourceToPatient: attributes.sourceToPatient,
  } as Parameters<typeof utilities.getPixelSpacingInformation>[0]);
  const spacing = result?.PixelSpacing as number[] | undefined;
  if (
    !result?.isProjection ||
    spacing?.length !== 2 ||
    !spacing.every(value => Number.isFinite(value) && value > 0)
  )
    return undefined;
  return { spacing: [spacing[0], spacing[1]], type: result.type };
};

type Projection = { spacing: [number, number]; calibration: Types.IImageCalibration };
const calibrations = new WeakMap<object, Projection | null>();
const projection = (imageId: string) => {
  const info = dicomImageInfo(imageId);
  if (!info) return undefined;
  let found = calibrations.get(info);
  if (found === undefined) {
    const result = dicomProjectionCalibration(info.spacing);
    // A stable object: Cornerstone treats a new calibration object as a new calibration event.
    found = result ? { spacing: result.spacing, calibration: { type: result.type } } : null;
    calibrations.set(info, found);
  }
  return found ? { info, ...found } : undefined;
};

/** Answers only for this session's registered images, before the wadouri provider. */
const provider = (type: string, imageId: string) => {
  if (typeof imageId !== 'string') return undefined;
  if (type !== 'calibratedPixelSpacing' && type !== Enums.MetadataModules.IMAGE_PLANE)
    return undefined;
  const found = projection(imageId);
  if (!found) return undefined;
  if (type === 'calibratedPixelSpacing') return found.calibration;
  const { spacing } = found;
  const declared = found.info.spacing.pixelSpacing;
  // Keep the wadouri module when Cornerstone keeps the declared Pixel Spacing.
  if (declared?.[0] === spacing[0] && declared[1] === spacing[1]) return undefined;
  const base = wadouri.metaData.metaDataProvider(type, imageId) as Record<string, unknown>;
  return base
    ? {
        ...base,
        pixelSpacing: spacing,
        rowPixelSpacing: spacing[0],
        columnPixelSpacing: spacing[1],
        usingDefaultValues: false,
      }
    : undefined;
};

let installed = false;
export const installDicomCalibration = () => {
  if (installed) return;
  metaData.addProvider(provider, 10_000);
  installed = true;
};
