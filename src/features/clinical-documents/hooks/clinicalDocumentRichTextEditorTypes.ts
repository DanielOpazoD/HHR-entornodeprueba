import type { ClinicalDocumentFormattingCommand } from '@/features/clinical-documents/components/clinicalDocumentSheetShared';

export type ClinicalDocumentRichTextEditorCommand =
  | ClinicalDocumentFormattingCommand
  | 'foreColor'
  | 'hiliteColor';

export interface ClinicalDocumentRichTextEditorActivationApi {
  element: HTMLDivElement | null;
  canUndo: boolean;
  canRedo: boolean;
  applyCommand: (command: ClinicalDocumentRichTextEditorCommand, value?: string) => void;
  insertHtml: (html: string) => void;
}

export interface UploadedClinicalDocumentPastedImage {
  attachmentId: string;
  imageUrl: string;
  storagePath: string;
}
