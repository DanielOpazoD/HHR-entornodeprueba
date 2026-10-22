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

Las siglas sistémicas se aplican sólo a resultados no identificados como orina u otros fluidos;
la normalización conserva la sección del informe. Si no hay resultados abreviables, el resumen
mantiene el texto explícito y las unidades, también para muestras no sanguíneas. La fila combinada
de bilirrubinas conserva las fracciones total/directa/indirecta en posiciones independientes,
sin depender del orden de extracción.

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
4. **Unidad:** cada punto se agrupa por su unidad, incluso si un análisis cambia de unidad entre
   órdenes. No se conectan valores de unidades distintas ni se infieren conversiones; una unidad
   ausente permanece separada.
5. **Orden:** si dos órdenes tienen la misma fecha y minuto, las columnas conservan la hora completa
   y el ID de orden. Repetir el mismo detalle no duplica el punto. Las columnas únicas mantienen su
   formato histórico `DD/MM/YYYY HH:MM`.

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

### Vigencia del análisis y del portapapeles

Cambiar de paciente, reiniciar la búsqueda, cerrar el análisis o desmontar el visor
invalida el trabajo pendiente. Una respuesta obsoleta no inicia el siguiente
enriquecimiento PDF, no publica resultados ni errores y no comienza un guardado
o una copia al portapapeles. Una operación externa ya iniciada no se revierte.
El análisis más reciente es el único que puede finalizar su indicador de progreso.

## Lectura de selecciones grandes y diagnóstico (22 octubre 2026)

`syslabService` elige el transporte; `syslabDetailsBatch` programa solicitudes
secuenciales de hasta tres informes, elimina selecciones repetidas y valida que
cada respuesta incluya exactamente los enlaces solicitados, sin errores por informe.
El límite de 24 de la extensión sigue vigente **por solicitud**, no por selección
analizada en HHR. La descarga de PDF combinados conserva su límite independiente.
No se mezclan búsquedas opacas distintas para superar las validaciones de identidad.
Un lote incompleto no publica ni guarda un análisis parcial. No se hacen reintentos
ciegos ni se almacenan resultados adicionales en cachés globales.

El progreso del análisis refleja informes efectivamente leídos. El cierre del visor
o el cambio de paciente impide programar el siguiente lote y publicar el resultado;
una solicitud ya enviada puede terminar en la extensión. La barra de búsqueda aún
es estimativa: no representa el número de documentos leídos.

`labTrendChartModel` prepara filas y dominio del eje de manera pura y testeable.
Conserva decimales pequeños, valores negativos, órdenes distintas y metadatos; los
nombres de analitos no se usan como rutas de acceso de Recharts. Se memoiza el modelo,
se desactivan las animaciones de las curvas y se omiten etiquetas permanentes con
más de seis órdenes o más de dos variables. No se eliminan puntos ni se interpola
una medición nueva; el tooltip mantiene valor, unidad, original y referencia.

### Evaluación crítica y límites

- La separación transporte → controladores puros → componentes es adecuada. Evitar
  duplicar normalización clínica dentro de componentes o agregar reglas al transporte.
- El parseo principal de la extensión y los enriquecimientos de HHR son implementaciones
  distintas: toda nueva regla debe tener un PDF sintético y prueba de paridad antes de
  ampliarse. No inferir que una tabla sin resultados sea un examen normal.
- Los enriquecimientos de microbiología/orina del proxy heredado todavía intentan
  PDFs con concurrencia no limitada y silencian los fallos opcionales. Requieren un
  bloque específico de seguimiento; no se acredita completitud microbiológica por
  el solo hecho de que las curvas numéricas se dibujen.
- La ruta de extensión no expone los buffers PDF a esos enriquecimientos de HHR;
  depende del parser de la extensión. La validación con mocks no prueba la sesión
  hospitalaria, el tiempo de descarga real ni todos los formatos de Syslab.
- El eje horizontal conserva órdenes categóricas, no distancia temporal proporcional.
  El tooltip muestra fecha/hora. No interpretar la pendiente como velocidad temporal.
- El runtime PDF compartido merece medir liberación de documentos/worker en lecturas
  prolongadas. Este cambio no altera ese recurso global ni el parser de la extensión.

Pruebas de carga reproducibles: 26 informes en transporte, interrupción entre lotes,
respuesta incompleta, cambio de búsqueda, 80 puntos sin pérdida y escalas decimales.
Los tests existentes cubren números localizados, unidades, muestras, órdenes coincidentes,
microbiología y paridad del parser. Ejecutar también `test:e2e:laboratory-smoke`.
