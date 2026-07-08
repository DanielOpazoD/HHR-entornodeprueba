import type { jsPDF } from 'jspdf';

export interface HandoffPdfPageMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const HANDOFF_PDF_PAGE_LAYOUT = {
  orientation: 'portrait',
  unit: 'mm',
  format: 'a4',
  margin: {
    top: 14,
    right: 16,
    bottom: 18,
    left: 16,
  },
  logoSize: 10,
  footerBaselineFromBottom: 8,
} as const;

export const getHandoffPdfTableMargin = (
  margin: HandoffPdfPageMargin = HANDOFF_PDF_PAGE_LAYOUT.margin
): HandoffPdfPageMargin => ({
  top: margin.top,
  right: margin.right,
  bottom: margin.bottom,
  left: margin.left,
});

export const getHandoffPdfContentBottomY = (
  doc: jsPDF,
  margin: HandoffPdfPageMargin = HANDOFF_PDF_PAGE_LAYOUT.margin
): number => doc.internal.pageSize.height - margin.bottom;

export const getHandoffPdfUsableWidth = (
  doc: jsPDF,
  margin: HandoffPdfPageMargin = HANDOFF_PDF_PAGE_LAYOUT.margin
): number => doc.internal.pageSize.width - margin.left - margin.right;
