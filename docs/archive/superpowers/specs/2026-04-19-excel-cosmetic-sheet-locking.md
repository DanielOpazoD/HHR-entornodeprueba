# Excel Cosmetic Sheet Locking Implementation Spec

**Goal:** Make `PACIENTES UPC` and `DETALLE DIARIO UPC` stay visible as tabs while opening blank, protected sheets that require unprotecting before rows and columns can be revealed.

**Architecture:** Keep the existing workbook structure protection for genuinely hidden support sheets such as `RESUMEN`. Add a separate cosmetic protection path for the two UPC sheets that are still visible in the tab bar but have their rendered rows and columns hidden after generation. The sheet protection password remains internal (`HHR`) and only controls the cosmetic reveal flow, not file-opening security.

**Scope:**

- `PACIENTES UPC [MES] [AÑO]` becomes a visible sheet with all rendered rows and columns hidden.
- `DETALLE DIARIO UPC` becomes a visible sheet with all rendered rows and columns hidden.
- `RESUMEN [MES] [AÑO]` remains hidden by workbook structure, as it is today.
- The workbook structure password and existing day-sheet behavior do not change.

**Behavioral Requirements:**

- The UPC sheets must remain visible as tabs.
- The UPC sheets must look blank on first open because their rendered rows and columns are hidden.
- The UPC sheets must be protected with password `HHR` and protection options that prevent formatting rows and columns until unprotected.
- Users can reveal the data manually by unprotecting the sheet, then unhiding rows and columns.
- Hidden support sheets that are meant to stay hidden structurally must continue using the existing hidden-sheet protection path.

**Implementation Notes:**

- Add a cosmetic protection helper in the Excel export layer instead of changing the workbook serializer.
- Apply the helper only after the UPC sheets have been fully rendered.
- Hide all rows that contain rendered data and all columns used by the sheet.
- Keep workbook view/active tab logic unchanged so the most recent visible census sheet remains the landing sheet.

**Testing Expectations:**

- Verify the UPC sheets serialize with `sheetState="visible"` and `sheetProtection` metadata present.
- Verify the UPC sheets have hidden rows and columns after rendering.
- Verify `RESUMEN` still serializes as hidden.
- Verify the workbook still opens on the latest visible day sheet.

**Non-goals:**

- Do not implement real security or encryption for individual sheets.
- Do not change the password that protects workbook structure.
- Do not alter visible day-sheet rendering beyond current workbook navigation.
