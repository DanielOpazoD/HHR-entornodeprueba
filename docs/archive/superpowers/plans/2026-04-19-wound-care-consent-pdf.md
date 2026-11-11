# Wound Care Consent PDF Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the wound care consent PDF so the title and body authorize clinical photos and/or audiovisual records of skin lesions, wounds, and other relevant clinical findings in a formal but simple tone.

**Architecture:** Keep the existing one-page PDF structure and header/footer layout. Change only the consent content generator and its focused tests so the document remains easy to read, prints consistently, and reflects the broader clinical scope without introducing new flows.

**Tech Stack:** TypeScript, jsPDF, Vitest

---

### Task 1: Update the PDF text generator

**Files:**

- Modify: `src/features/wound-care/services/consentPdfGenerator.ts`

- [ ] **Step 1: Rewrite the title and body text**

```ts
const title = 'AUTORIZACIÓN PARA REGISTRO CLÍNICO FOTOGRÁFICO Y AUDIOVISUAL';
const subtitle = 'Lesiones cutáneas, heridas y otros hallazgos clínicos';
const bodyText = [
  'Yo, el/la paciente abajo firmante (o su representante legal), declaro que he sido informado/a por el equipo de salud del Hospital Hanga Roa sobre lo siguiente:',
  '',
  '1. Durante mi hospitalización, el equipo de salud podrá tomar fotografías y, cuando sea necesario, realizar registros audiovisuales breves de lesiones cutáneas, heridas, curaciones, exámenes físicos u otros hallazgos clínicos relevantes, con el fin de documentar mi evolución y apoyar mi atención.',
  '',
  '2. Este material se utilizará únicamente como parte de mi registro clínico y ficha de hospitalización, para facilitar el seguimiento, la continuidad del cuidado y la comunicación entre los distintos integrantes del equipo de salud.',
  '',
  '3. Las imágenes y registros NO serán utilizados con fines académicos, de investigación, publicación científica ni difusión de ningún tipo, salvo autorización expresa y separada.',
  '',
  '4. El material será almacenado en un sistema digital seguro, con acceso restringido únicamente al personal clínico autorizado del Hospital Hanga Roa.',
  '',
  '5. Puedo revocar esta autorización en cualquier momento, informando al equipo de salud a cargo de mi atención.',
];
```

- [ ] **Step 2: Remove the location line**

```ts
// Do not render a location line below the date; the form stays shorter and the location is implicit in the header.
```

- [ ] **Step 3: Keep the visual structure stable**

```ts
doc.text(title, pageWidth / 2, y, { align: 'center' });
doc.text(subtitle, pageWidth / 2, y, { align: 'center' });
```

### Task 2: Update PDF tests

**Files:**

- Modify: `src/tests/features/wound-care/consentPdfGenerator.test.ts`

- [ ] **Step 1: Add assertions for the new title/subtitle/body**

```ts
expect(textCalls).toContain('AUTORIZACIÓN PARA REGISTRO CLÍNICO FOTOGRÁFICO Y AUDIOVISUAL');
expect(textCalls).toContain('Lesiones cutáneas, heridas y otros hallazgos clínicos');
expect(textCalls).toContain('exámenes físicos');
expect(textCalls).toContain('NO serán utilizados con fines académicos');
```

- [ ] **Step 2: Add an assertion that the location line is no longer rendered**

```ts
expect(textCalls).not.toContain('Lugar: Hospital Hanga Roa, Rapa Nui');
```

- [ ] **Step 3: Re-run the focused test file**

Run: `npx vitest run src/tests/features/wound-care/consentPdfGenerator.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Re-run typecheck**

Run: `npm run typecheck`
Expected: passes with no TypeScript errors.

---
