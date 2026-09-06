# `src/features/clinical-library`

## Propósito

Biblioteca de documentos y herramientas del censo diario. El botón «Documentos» de la barra de
fechas abre un panel lateral con:

- **Formularios**: una versión imprimible (PDF) por formulario de `Formularios/`, servida con sus
  bytes originales. Cada fila tiene un solo botón: imprimir.
- **Protocolos** e **infografías**: categorías preparadas; se publican agregando archivos y entradas
  al catálogo.
- **Herramientas** sin conexión: dilución y velocidad de infusión, dosis y antropometría, y scores
  clínicos (qSOFA, Glasgow, CURB-65, Wells TEP, Padua, CHA₂DS₂-VASc).

El módulo no persiste nada ni contiene datos de pacientes: el catálogo es estático y las
calculadoras operan sólo con lo escrito en el formulario. Sólo existe en el censo diario.

## Estructura

```text
clinical-library/
├── components/
│   ├── ClinicalLibraryQuickAction.tsx   # botón de la barra de fechas; carga el panel bajo demanda
│   ├── ClinicalLibraryDrawer.tsx        # panel: búsqueda, categorías, lista o herramienta activa
│   ├── LibraryEntryList.tsx · LibraryDocumentCard.tsx
│   ├── toolRegistry.tsx                 # id de herramienta → icono + componente
│   └── tools/                           # InfusionCalculatorTool, DosingCalculatorTool, ScoresTool
├── controllers/                         # lógica pura de presentación y validación
│   ├── libraryPresentation.ts           # badges, tamaños, números es-CL
│   ├── infusionPresentation.ts          # estado del formulario → resultado presentable
│   └── plausibleRanges.ts               # rangos plausibles de peso, talla, edad y creatinina
├── domain/
│   ├── libraryCatalog.ts · librarySearch.ts
│   ├── infusionCalculator.ts · infusionPresets.ts
│   ├── doseCalculator.ts
│   ├── scoreEngine.ts · scoreDefinitions.ts · scores/<score>.ts
├── services/libraryDocumentActions.ts   # abrir, imprimir (iframe con fallback) y codificar rutas
├── public.ts · index.ts · quick-action.ts
```

## Cómo agregar

- **Documento**: copiar el archivo a `public/docs/biblioteca/` y agregar una entrada en
  `domain/libraryCatalog.ts`. `libraryCatalog.test.ts` verifica que el archivo exista, que el tamaño
  coincida y que no haya identificadores de pacientes. Sólo material en blanco: el repositorio es
  público.
- **Preset de infusión**: una entrada en `domain/infusionPresets.ts` y su fila en la tabla dorada de
  `infusionCalculator.test.ts`.
- **Score**: un archivo en `domain/scores/`, su registro en `scoreDefinitions.ts` y su fila de
  puntajes en `scoreDefinitions.test.ts`. Las bandas deben cubrir todos los totales alcanzables.
- **Herramienta**: id en `libraryCatalogTypes.ts`, entrada en el catálogo y registro en
  `components/toolRegistry.tsx`.

## Reglas

- Textos mínimos: sin avisos genéricos ni pies explicativos. Se conservan sólo los datos clínicos
  (rango habitual del fármaco, notas por fármaco, notas y referencia por score).
- Entradas numéricas con coma o punto, validadas contra rangos plausibles; un valor fuera de rango
  se marca y no se calcula.
- Dentro de una herramienta, Escape y el clic fuera vuelven a la lista sin perder lo escrito; en la
  lista cierran el panel.
- Consumo externo sólo por `@/features/clinical-library` o `quick-action` desde el shell
  (`scripts/feature-public-api-allowlist.json`).

## Verificación visual

`npm run test:e2e:preview:clinical-library:built` (con `npm run build` previo) recorre el botón, la
búsqueda, un PDF servido, las tres herramientas y el caso a 375 px; con
`CLINICAL_LIBRARY_SHOTS_DIR=<carpeta>` guarda capturas. No corre en CI.
