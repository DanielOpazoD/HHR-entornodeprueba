# IEEH PDF Generation Flow

## Overview

The IEEH (Informe Estadístico de Egreso Hospitalario) is filled inside the
epicrisis clinical document and printed on the official MINSAL template. The
census no longer has its own IEEH dialog: the doctor completes the statistical
discharge while writing the epicrisis, and the nurse later records the discharge
time in the census.

### Workflow

1. **Panel**: in epicrisis documents, `ClinicalDocumentSectionList` renders the
   collapsible `ClinicalDocumentIeehPanel` below "Diagnósticos de egreso".
2. **Draft**: the panel edits an `ieehDraft` stored with the document: CIE-10
   diagnosis (terminology search with AI fallback), discharge condition, surgical
   intervention and procedure. Discharge time is intentionally left blank.
3. **Print**: "Imprimir IEEH" builds the patient and discharge data from the
   epicrisis and the workspace patient, lazy-loads `ieehPdfService` and calls
   `printIEEHForm`, which maps the values onto the template coordinates and opens
   the print dialog through `pdfBase.openPdfPrintDialog`.

## Key Components

- [ClinicalDocumentIeehPanel.tsx](../../src/features/clinical-documents/components/ClinicalDocumentIeehPanel.tsx): panel state, terminology search and print action.
- [ClinicalDocumentIeehFormBody.tsx](../../src/features/clinical-documents/components/ClinicalDocumentIeehFormBody.tsx): form fields and discharge-condition options.
- [clinicalDocumentIeehController.ts](../../src/features/clinical-documents/controllers/clinicalDocumentIeehController.ts): pure draft creation and panel state.
- [clinicalDocumentIeehPrintController.ts](../../src/features/clinical-documents/controllers/clinicalDocumentIeehPrintController.ts): builds the printable patient and discharge data from the epicrisis.
- [ieehPdfService.ts](../../src/services/pdf/ieehPdfService.ts): PDF mapping over the official coordinates.
- [pdfBase.ts](../../src/services/pdf/pdfBase.ts): print-opening and save fallback runtime.
