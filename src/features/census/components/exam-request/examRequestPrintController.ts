export interface ExamRequestPrintRuntime {
  documentRef?: Document;
  windowRef?: Window;
  modalTitleId?: string;
  printDelayMs?: number;
  restoreDelayMs?: number;
}

interface ExamRequestPrintSnapshot {
  originalTitle: string;
  modalTitleElement: HTMLElement | null;
  originalModalTitle: string | null;
}

const DEFAULT_MODAL_TITLE_ID = 'modal-title';
const DEFAULT_PRINT_DELAY_MS = 150;
const DEFAULT_RESTORE_DELAY_MS = 1000;

export const runExamRequestPrint = ({
  documentRef = document,
  windowRef = window,
  modalTitleId = DEFAULT_MODAL_TITLE_ID,
  printDelayMs = DEFAULT_PRINT_DELAY_MS,
  restoreDelayMs = DEFAULT_RESTORE_DELAY_MS,
}: ExamRequestPrintRuntime = {}): void => {
  const snapshot = captureExamRequestPrintSnapshot(documentRef, modalTitleId);
  applyExamRequestPrintSnapshot(snapshot, documentRef);

  windowRef.setTimeout(() => {
    windowRef.print();

    windowRef.setTimeout(() => {
      restoreExamRequestPrintSnapshot(snapshot, documentRef);
    }, restoreDelayMs);
  }, printDelayMs);
};

export const captureExamRequestPrintSnapshot = (
  documentRef: Document,
  modalTitleId: string
): ExamRequestPrintSnapshot => {
  const modalTitleElement = documentRef.getElementById(modalTitleId);
  return {
    originalTitle: documentRef.title,
    modalTitleElement,
    originalModalTitle: modalTitleElement?.textContent ?? null,
  };
};

export const applyExamRequestPrintSnapshot = (
  snapshot: ExamRequestPrintSnapshot,
  documentRef: Document
): void => {
  documentRef.title = '';
  if (snapshot.modalTitleElement) {
    snapshot.modalTitleElement.textContent = '';
  }
};

export const restoreExamRequestPrintSnapshot = (
  snapshot: ExamRequestPrintSnapshot,
  documentRef: Document
): void => {
  documentRef.title = snapshot.originalTitle;
  if (snapshot.modalTitleElement && snapshot.originalModalTitle !== null) {
    snapshot.modalTitleElement.textContent = snapshot.originalModalTitle;
  }
};
