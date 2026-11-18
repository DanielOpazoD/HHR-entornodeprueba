/**
 * MMRAD's Universitas viewer serves a 515 KB CT original in about 440 ms and keeps that pace
 * with up to 12 requests at once: 7.5 originals/s with 4, 12.3/s with 8 and 16.1/s with 12
 * (measured from Chile, 2026-11-03). The queue still halves on any throttling or server error.
 */
export const DICOM_DEFAULT_DOWNLOADS = 6;
export const DICOM_DOWNLOAD_LIMITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
