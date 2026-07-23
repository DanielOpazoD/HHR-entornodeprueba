# Laboratory Module

Visor de exámenes de laboratorio del sistema Syslab (Hospital Hanga Roa).

## Arquitectura

```
features/laboratory/
├── public.ts                 # API pública — importar desde aquí
├── constants/                # Config clínica separada por dominio (progress, trend, comparison, exam, chart)
├── controllers/
│   ├── labFormattingController.ts  # Puro: parsing, formateo, validación, utilidades compartidas
│   ├── labNumericParser.ts         # Puro: números localizados con contexto de unidad/rango
│   ├── labSpecimenController.ts    # Puro: clasificación sangre/orina/otros fluidos
│   ├── labAnalyticsController.ts   # Puro: buildAnalysisData + helpers
│   ├── labComparisonController.ts  # Puro: texto compacto de comparación para clipboard
│   └── labSummaryController.ts     # Puro: resumen con siglas clínicas para documentos
├── components/               # Componentes React + helpers locales de charts
│   ├── LabResultsViewerModal.tsx
│   ├── LabViewerControls.tsx
│   ├── LabViewerExamList.tsx (con filtro por categoría)
│   ├── LabViewerAnalyzeBar.tsx
│   ├── LabViewerPdf.tsx
│   ├── LabViewerAnalysis.tsx
│   ├── LabViewerMicrobiologyPanel.tsx
│   ├── LabViewerTrendCharts.tsx
│   ├── LabTrendGroupCard.tsx
│   ├── LabTrendChartHelpers.ts
│   ├── LabTrendChartRenderers.tsx
│   ├── labTrendChartExport.ts
│   ├── LabViewerComparisonTable.tsx
│   ├── LabExportConfigDialog.tsx
│   ├── LabViewerEmptyState.tsx
│   ├── LabViewerProgress.tsx
│   └── LabChartErrorBoundary.tsx
├── hooks/
│   ├── useLabViewer.ts          # Fachada pública del visor
│   ├── useLabViewerQuery.ts     # Búsqueda, cache y selección de paciente
│   ├── useLabViewerSelection.ts # Filtros y selección de órdenes
│   └── useLabViewerAnalysis.ts  # Análisis, clipboard y progreso
├── services/
│   ├── labExcelService.ts    # Exportación Excel con resumen + datos de identificación
│   └── labFirestoreService.ts # Persistencia Firestore
└── types/labViewerTypes.ts   # Tipos internos UI
```

## Integración con otros módulos

### Documentos clínicos

Botón "Lab" en la toolbar del documento clínico (junto a PDF) que inserta
un resumen compacto de laboratorio con siglas clínicas:

```
Laboratorio (08/04/2026 14:00): Hb 13 HTO 40% RGB 7.000 PMN 70% Creat 1 ...
```

Archivos: `ClinicalDocumentLabInsertDialog.tsx`, `ClinicalDocumentFormattingToolbar.tsx`

## Exportación Excel

La exportación de comparación genera una hoja `Comparación Lab` con:

- título `Resumen de laboratorio`
- nombre del paciente
- RUT
- fecha de nacimiento
- tabla comparativa de variables por fecha

## Mejoras clínicas actuales

- normalización de alias frecuentes (`Leucocitos`, `Plaquetas`, `PCR`, etc.) para evitar duplicados
- panel `Microbiología / Cultivos` como pestaña separada del visor
- fallback desde el PDF original para completar microbiología cuando Syslab `details` no trae todas las subsecciones
- taxonomía microbiológica explícita para `PCR 8 virus`, `PCR arbovirus`, `Hemocultivo`, `Urocultivo` y `Otros cultivos`
- normalización urinaria reutilizable para `SEDIMENTO URINARIO`, `ORINA FISICO-QUIMICO`, `RPC` y `RAC`

## Integridad de tendencias

Las curvas se construyen con tres contratos explícitos:

1. **Muestra:** sangre, orina y otros fluidos no se mezclan aunque Syslab repita el mismo nombre
   de análisis. `RPC` y `RAC` son las únicas tendencias urinarias habilitadas.
2. **Número localizado:** la coma es decimal. Un valor como `1.071` en `U/L`, con rango entero,
   se interpreta como `1071`; en una unidad escalada como `x10^3/uL`, `7.280` se interpreta
   como `7,28`.
3. **Trazabilidad:** cada punto conserva el texto original y la sección del PDF. El tooltip muestra
   esa procedencia y el rango propio del análisis.

Una banda verde de referencia sólo se dibuja cuando todas las variables del subgráfico comparten
exactamente el mismo rango. Las líneas son rectas entre mediciones; no se suavizan valores clínicos.

La regresión de referencia está desidentificada en
`src/tests/features/laboratory/fixtures/syslabGoldenLabFixtures.ts` y cubre colisiones de albúmina,
leucocitos y segmentados entre perfil sanguíneo y orina, además de FA/GGT sobre 1.000 U/L.

## Flujo de datos

```
Paciente del censo HHR
  ↓ episodio clínico + RUN
Extensión Eloísa
  ↓ sesión institucional en la red local
Syslab (10.4.69.90)
  ↓ lote opaco con caducidad y RUN verificado
syslabService.ts
  ↓ TanStack Query cache (10 min staleTime)
useLabViewer hook
  ↓ Controllers puros para transformar
labAnalyticsController / labSummaryController
  ↓
Componentes UI + Firestore persistence (background)
```

## Uso desde otros módulos

```ts
import {
  LabResultsViewerModal,
  buildLabSummaryText,
  getLabResults,
  formatLabResult,
  parseLocalizedNumber,
  parseScientificValue,
} from '@/features/laboratory/public';
```

## Boundary de imports

- El consumo externo debe entrar por `@/features/laboratory` o `@/features/laboratory/public`.
- Los deep imports hacia `components/`, `controllers/`, `hooks/`, `services/` o `types/` desde
  fuera de la feature están prohibidos.
- La gobernanza estática del repo bloquea nuevos accesos laterales a internals del módulo.

## Configuración

- El flujo principal requiere la extensión Eloísa 0.37.0 o posterior y una sesión Syslab activa.
- `VITE_SYSLAB_API_URL` — URL opcional y explícita del proxy Express heredado; no tiene valor por defecto.
- HHR en `localhost:3000` nunca debe tratarse como proxy de Syslab.
- `Buscar por RUT externo` no tiene un episodio Eloísa verificable: usa el fallback Netlify/Express
  solo cuando está configurado. En Vite local sin proxy muestra una instrucción guiada y no intenta
  interpretar el HTML de HHR como JSON.

## Tests

```bash
npx vitest run src/tests/services/laboratory/ src/tests/hooks/laboratory/ src/tests/components/laboratory/ src/tests/features/laboratory/
```
