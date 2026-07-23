import type { DocumentScanFilterMode } from './documentFilterProfiles';

export interface DocumentScanPoint {
  readonly x: number;
  readonly y: number;
}

export interface DocumentScanCorners {
  readonly topLeftCorner: DocumentScanPoint;
  readonly topRightCorner: DocumentScanPoint;
  readonly bottomLeftCorner: DocumentScanPoint;
  readonly bottomRightCorner: DocumentScanPoint;
}

export interface JscanifyDocumentPage {
  blob: Blob;
  sourceBlob: Blob;
  corners: DocumentScanCorners;
  paperDetected: boolean;
  filterMode: DocumentScanFilterMode;
}

export interface JscanifyDocumentSession {
  readonly pages: JscanifyDocumentPage[];
}

export interface JscanifyDocumentPreview {
  readonly objectUrl: string;
  readonly pageCount: number;
  readonly detectedPageCount: number;
}

export interface DocumentCropEditorState {
  readonly sourceObjectUrl: string;
  readonly corners: DocumentScanCorners;
}

export interface DocumentPageThumbnail {
  readonly pageIndex: number;
  readonly objectUrl: string;
}
