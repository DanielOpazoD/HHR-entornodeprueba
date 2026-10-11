import { PdfButton } from '../DateStripButtonControls';
export const PdfButtons = ({ onExportPDF }: { onExportPDF?: () => void }) =>
  onExportPDF ? <PdfButton onExportPDF={onExportPDF} /> : null;
