# Excel Cosmetic Sheet Locking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `PACIENTES UPC` and `DETALLE DIARIO UPC` visible as tabs while making them open blank and protected until the user explicitly unprotects them.

**Architecture:** Add a small Excel-only helper that hides rendered rows and columns, then protects the sheet with the internal `HHR` password and row/column formatting disabled. Keep `RESUMEN` on the existing hidden-sheet path and leave the workbook serializer untouched so structure protection continues to work the same way.

**Tech Stack:** TypeScript, `exceljs`, `pizzip`, Vitest

---

### Task 1: Add a cosmetic sheet-protection helper for visible UPC sheets

**Files:**

- Modify: `src/services/exporters/excel/censusHiddenSheetsProtection.ts`
- Modify: `src/services/exporters/excel/censusHiddenSheetsRenderer.ts`
- Test: `src/tests/services/censusHiddenSheetsRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps UPC sheets visible but blank when cosmetic protection is applied', async () => {
  const workbook = new ExcelJS.Workbook();
  const upcSheet = workbook.addWorksheet('PACIENTES UPC MARZO 2026');

  renderUpcPatientsSheet({
    sheet: upcSheet,
    patients: [buildUpcPatient()],
    monthName: 'MARZO',
    year: '2026',
  });

  await applyCosmeticSheetProtection(upcSheet);

  expect(upcSheet.state).toBe('visible');
  expect(upcSheet.getRow(5).hidden).toBe(true);
  expect(upcSheet.getColumn(1).hidden).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/services/censusHiddenSheetsRenderer.test.ts`
Expected: FAIL because `applyCosmeticSheetProtection` does not exist yet and the UPC sheet still serializes as the old hidden-sheet behavior.

- [ ] **Step 3: Write minimal implementation**

```ts
const hideSheetDimensions = (sheet: Worksheet): void => {
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    sheet.getRow(row).hidden = true;
  }

  for (let column = 1; column <= sheet.columnCount; column += 1) {
    sheet.getColumn(column).hidden = true;
  }
};

export const applyCosmeticSheetProtection = async (sheet: Worksheet): Promise<void> => {
  hideSheetDimensions(sheet);
  await sheet.protect(CENSUS_HIDDEN_SHEETS_PASSWORD, {
    ...CENSUS_HIDDEN_SHEET_PROTECTION_OPTIONS,
    selectLockedCells: true,
    selectUnlockedCells: true,
  });
  sheet.state = 'visible';
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/services/censusHiddenSheetsRenderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/exporters/excel/censusHiddenSheetsProtection.ts src/services/exporters/excel/censusHiddenSheetsRenderer.ts src/tests/services/censusHiddenSheetsRenderer.test.ts
git commit -m "feat: make UPC sheets cosmetically protected"
```

### Task 2: Use cosmetic protection only for UPC hidden sheets

**Files:**

- Modify: `src/services/exporters/excel/censusHiddenSheetsBuilder.ts`
- Test: `src/tests/services/censusWorkbookControllers.test.ts`
- Test: `src/tests/services/censusWorkbookSanity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps UPC tabs visible while leaving RESUMEN hidden', async () => {
  const binary = await buildCensusMasterBinary(recordsWithUpc);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(binary as Parameters<typeof workbook.xlsx.load>[0]);

  expect(workbook.getWorksheet('PACIENTES UPC MARZO 2026')?.state).toBe('visible');
  expect(workbook.getWorksheet('DETALLE DIARIO UPC')?.state).toBe('visible');
  expect(workbook.getWorksheet('RESUMEN MARZO 2026')?.state).toBe('hidden');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/services/censusWorkbookControllers.test.ts src/tests/services/censusWorkbookSanity.test.ts`
Expected: FAIL because the builder still marks all support sheets hidden.

- [ ] **Step 3: Write minimal implementation**

```ts
await applyHiddenSheetProtection(summarySheet);
await applyCosmeticSheetProtection(upcSheet);
await applyCosmeticSheetProtection(matrixSheet);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/services/censusWorkbookControllers.test.ts src/tests/services/censusWorkbookSanity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/exporters/excel/censusHiddenSheetsBuilder.ts src/tests/services/censusWorkbookControllers.test.ts src/tests/services/censusWorkbookSanity.test.ts
git commit -m "feat: keep UPC workbook sheets visible"
```

### Task 3: Verify workbook serialization and docs stay aligned

**Files:**

- Modify: `src/services/exporters/excel/README.md`
- Test: `src/tests/services/censusHiddenSheetsRenderer.test.ts`
- Test: `src/tests/services/censusWorkbookControllers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('serializes visible UPC sheets with sheetProtection and hidden rows', async () => {
  const zip = new PizZip(await workbook.xlsx.writeBuffer());
  const upcSheetXml = zip.file('xl/worksheets/sheet2.xml')?.asText() ?? '';

  expect(upcSheetXml).toContain('<sheetProtection');
  expect(upcSheetXml).toContain('state="visible"');
  expect(upcSheetXml).toContain('hidden="1"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/services/censusHiddenSheetsRenderer.test.ts src/tests/services/censusWorkbookControllers.test.ts`
Expected: FAIL if serialization metadata or hidden-dimension behavior is incomplete.

- [ ] **Step 3: Write minimal implementation**

```md
Update the README section for the Excel exporter:

- `RESUMEN` stays hidden by workbook structure.
- `PACIENTES UPC` and `DETALLE DIARIO UPC` are visible tabs with cosmetic locking.
- Users unprotect with `HHR` and then unhide rows/columns to inspect the data.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/services/censusHiddenSheetsRenderer.test.ts src/tests/services/censusWorkbookControllers.test.ts && npm run typecheck && npx eslint src/services/exporters/excel/censusHiddenSheetsProtection.ts src/services/exporters/excel/censusHiddenSheetsBuilder.ts src/tests/services/censusHiddenSheetsRenderer.test.ts src/tests/services/censusWorkbookControllers.test.ts --max-warnings 0`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/exporters/excel/README.md src/services/exporters/excel/censusHiddenSheetsRenderer.ts src/tests/services/censusHiddenSheetsRenderer.test.ts src/tests/services/censusWorkbookControllers.test.ts
git commit -m "docs: describe visible UPC sheet locking"
```
