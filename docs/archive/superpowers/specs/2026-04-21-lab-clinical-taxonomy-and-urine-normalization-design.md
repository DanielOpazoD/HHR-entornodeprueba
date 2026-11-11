# Lab Clinical Taxonomy and Urine Normalization Design

Date: 2026-04-21
Status: proposed

## Problem

The current `LAB` module parses and presents Syslab data with useful general structure, but it still misses important HHR clinical semantics in three areas:

1. microbiology is too coarse-grained;
2. urine-related findings are incompletely normalized and displayed;
3. `RPC` / `RAC` are not represented as first-class clinical variables.

This causes real information loss when the same lab payload is reused across:

- the microbiology panel;
- the comparison table;
- summary builders;
- future consumers of the laboratory module.

The attached PDFs show the current clinical gap clearly:

- `PCR PANEL RESPIRATORIO #2` should surface as a distinct `PCR 8 virus` card;
- `PCR ARBOVIROSIS` should surface as its own card;
- cultures plus antimicrobial susceptibility need clearer clinical grouping;
- `ORINA FISICO-QUIMICO`, `SEDIMENTO URINARIO`, `Rel. Proteinuria/Creatininuria`, and `Relacion Albumina/Creatininuri(a)` need better normalization and display rules.

## Goal

Upgrade the `LAB` module so these semantics are modeled once in reusable module-level rules and then reused everywhere the data is consumed.

The resulting behavior should be clinically clearer and reusable, not just a UI patch for the current modal.

## Non-goals

- Do not redesign the whole laboratory UI.
- Do not build a separate parser engine outside the current module boundaries.
- Do not special-case only the current three PDFs in UI code.
- Do not create module-local logic that cannot be reused by other `LAB` consumers.

## Recommended approach

Extend the existing `features/laboratory` taxonomy and normalization layer instead of rewriting the module.

This means:

1. refine microbiology categories and labels;
2. improve PDF fallback enrichment for missing microbiology subsections;
3. normalize urine findings and urinary ratios as reusable clinical names;
4. adjust presentation rules so those normalized findings appear correctly in microbiology, comparison, summaries, and future consumers.

This is preferable to a large refactor because the module already has a good shape:

- `labConstants.ts` for clinical config;
- pure controllers for analytics and categorization;
- fallback PDF enrichment for microbiology;
- UI consumers downstream of those controllers.

## Architecture principle

These rules belong to the module’s clinical core, not to a single screen.

Therefore the main implementation target is:

- `constants/`
- `controllers/`
- `services/labMicrobiologyPdfService.ts`

and not the final React components.

React components should only render the improved data model.

## Clinical behavior to enforce

### 1. Microbiology cards

Microbiology must expose clearly separated cards for:

- `PCR 8 virus`
- `PCR arbovirus`
- `Hemocultivo`
- `Urocultivo`
- `Otros cultivos`

Antimicrobial susceptibility must remain attached to the relevant culture card whenever possible, not presented as an unrelated generic microbiology result.

### 2. Urine sediment

`SEDIMENTO URINARIO` must clearly recognize and preserve at least:

- `Eritrocitos`
- `Leucocitos`
- `Bacterias`
- `Cilindros`
- `Placas de pus`

These findings must remain visible as structured clinical variables, not disappear into free text or noisy low-priority rows.

### 3. Urine physical-chemical panel

`ORINA FISICO-QUIMICO` must recognize and show:

- `Cuerpos Cetónicos`
- `Proteínas`
- `Nitritos`
- `pH`
- `Densidad`
- `Leucocitos`

These names should be normalized consistently so the same finding is reusable in comparison and future exports.

### 4. RPC and RAC

The module must normalize:

- `Rel. Proteinuria/Creatininuria` -> `RPC`
- `Relacion Albumina/Creatininuri(a)` and equivalent variants -> `RAC`

Presentation rule:

- display only the ratio value;
- do not surface the component support values (`Proteinuria`, `Microalbuminuria`, `Creatininuria`) as separate first-class values when the ratio is present for the same exam payload.

This is a clinical display rule, not a raw parser deletion rule. The lower-level values may still exist internally if useful, but downstream presentation should prioritize `RPC` and `RAC`.

## Files in scope

Primary:

- `src/features/laboratory/constants/labConstants.ts`
- `src/features/laboratory/controllers/labMicrobiologyAnalyticsController.ts`
- `src/features/laboratory/controllers/labAnalyticsVariableController.ts`
- `src/features/laboratory/controllers/labDetailProcessingController.ts`
- `src/features/laboratory/services/labMicrobiologyPdfService.ts`
- `src/features/laboratory/controllers/labFormattingController.ts`

Likely supporting:

- `src/features/laboratory/controllers/labSummaryController.ts`
- `src/features/laboratory/README.md`

Tests:

- `src/tests/features/laboratory/labMicrobiologyPdfService.test.ts`
- `src/tests/features/laboratory/labMicrobiologyAnalyticsController.test.ts`
- `src/tests/features/laboratory/labAnalyticsController.test.ts`
- `src/tests/hooks/laboratory/labAnalyticsFormatting.test.ts`
- any targeted tests needed for comparison-order / exclusion behavior

## Data model changes

### Microbiology categories

Current broad categories are not enough. The category model should expand to include:

- `pcr_8_virus`
- `pcr_arbovirus`
- `hemocultivo`
- `urocultivo`
- `otros_cultivos`

Existing broad categories may need replacement or remapping so the UI no longer collapses clinically different buckets into one generic `PCR panel respiratorio` or `cultivo corriente`.

### Clinical normalization rules

Add explicit normalization aliases for:

- `Rel. Proteinuria/Creatininuria` -> `RPC`
- `Relacion Albumina/Creatininuri(a)` -> `RAC`
- urine variable variants with orthographic or accent differences
- microbiology labels that identify `PCR ARBOVIROSIS` and `PCR PANEL RESPIRATORIO #2`

## Parsing rules

### PDF microbiology fallback

`labMicrobiologyPdfService.ts` must broaden section recognition beyond the current headings.

It should recognize dedicated blocks for:

- respiratory PCR panel / `PCR 8 virus`
- arbovirus PCR
- culture / susceptibility blocks

The fallback must parse these as structured findings instead of leaving them embedded in one generic section.

### Urine sections

Urine sections may come as:

- `ORINA FISICO-QUIMICO`
- `SEDIMENTO URINARIO`
- `QUIMICA/ORINA`
- ratio sections with mixed capitalization or truncated labels

The module should normalize these names early enough that later controllers do not need PDF-specific string hacks.

## Presentation rules

### Microbiology panel

The microbiology panel should render the new categories as separate cards, with labels exactly aligned to clinical use:

- `PCR 8 virus`
- `PCR arbovirus`
- `Hemocultivo`
- `Urocultivo`
- `Otros cultivos`

### Comparison and structured outputs

Urine and ratio variables should be represented so they remain reusable for:

- comparison table;
- clipboard summary;
- possible future insertions or exports.

The key principle is:

- normalize once;
- render many times.

### Ratio priority

If `RPC` exists in an exam payload, downstream presentation should prefer `RPC` over separate `Proteinuria` and `Creatininuria`.

If `RAC` exists, downstream presentation should prefer `RAC` over separate `Microalbuminuria` and `Creatininuria`.

This avoids clutter and follows the clinical intent requested by the user.

## Testing

Required coverage:

1. microbiology PDF parsing
   - `PCR 8 virus`
   - `PCR arbovirus`
   - culture + susceptibility

2. microbiology categorization
   - respiratory PCR and arbovirus must become separate cards
   - `Urocultivo` and other cultures must not collapse into one generic label

3. urine normalization
   - sediment variables preserved
   - physical-chemical urine variables preserved

4. ratio normalization
   - `RPC` generated and preferred
   - `RAC` generated and preferred

5. regression
   - existing panel respiratorio and culture handling must not break for older fixtures

Tests should be inspired directly by the attached PDFs so the rules are grounded in real HHR output, not hypothetical strings.

## Success criteria

- the microbiology tab shows separate cards for `PCR 8 virus`, `PCR arbovirus`, `Hemocultivo`, `Urocultivo`, and `Otros cultivos` when those exam families exist;
- susceptibility findings stay associated with the relevant culture bucket;
- urine sediment preserves `Eritrocitos`, `Leucocitos`, `Bacterias`, `Cilindros`, and `Placas de pus`;
- `ORINA FISICO-QUIMICO` exposes `Cuerpos Cetónicos`, `Proteínas`, `Nitritos`, `pH`, `Densidad`, and `Leucocitos`;
- `RPC` and `RAC` appear with their ratio values and suppress noisy support values in downstream presentation;
- the rules are reusable across the laboratory module rather than trapped in one UI component.

## Rollout

1. extend taxonomy and normalization rules
2. update microbiology fallback parsing
3. update downstream categorization and presentation priorities
4. add regression tests from real HHR-shaped fixtures
5. update module README if the new taxonomy changes the module contract
