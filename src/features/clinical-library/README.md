# `src/features/clinical-library`

## Propósito

Biblioteca de documentos y herramientas del censo diario. El botón «Documentos» de la barra de
fechas abre un panel lateral con:

- **Formularios**: diez documentos con acción **Completar**, además de imprimir o descargar el
  original. MEDIF conserva su editor; los otros nueve comparten el editor de formularios clínicos.
- **Protocolos** e **infografías**: categorías preparadas; se publican agregando archivos y entradas
  al catálogo.
- **Herramientas** en el navegador: editor MEDIF con 137 variables, ingreso manual o copia del
  censo, preferencias de campos y descarga de PDF editable o imprimible; carátula de sobre de traslado (horizontal, oficio o carta, con
  logo, nombre y RUT prellenados desde el censo), hoja rápida de medicamentos críticos (digital e
  imprimible en A4 horizontal, con presentación de dopamina y dobutamina en ampolla de 5 o 10 mL),
  dilución y velocidad de infusión, dosis y antropometría (incluye CKD-EPI 2021) y scores clínicos
  (NEWS2, qSOFA, Glasgow, SAS, CAM-ICU, CURB-65, Wells TEP, Padua, CHA₂DS₂-VASc).

El catálogo es estático y el panel se abre desde el censo diario. Las calculadoras operan con
lo escrito en sus formularios. La carátula y MEDIF pueden copiar datos del censo para editarlos
en memoria. MEDIF persiste únicamente preferencias de visibilidad, sin valores de pacientes;
los borradores con datos se descargan a petición del usuario y no se guardan automáticamente.
La impresión necesita cargar la plantilla pública en blanco de cada formulario. Los Word se
conservan y tienen una exportación PDF verificada con el mismo diseño para la impresión.

La [guía de formularios compartidos](../../../docs/formularios-clinicos.md) documenta el catálogo
común, los mapas de impresión y el modo de ingreso manual o desde una cama/cuna clínica.

El informe del Salvador admite capturas DICOM seleccionadas como anexos al Word.
El [contrato del visor y los anexos](../../../docs/MMRAD_DICOM.md) describe su carga
diferida, vinculación al paciente, memoria temporal y límites de conexión.

La [guía de MEDIF](../../../docs/medif.md) describe los modos manual y censo, las preferencias,
los borradores y los PDF. El [diccionario de variables](../../../docs/medif-variables.md)
detalla las 137 variables distribuidas en diez secciones.

## Estructura

```text
clinical-library/
├── components/
│   ├── ClinicalLibraryQuickAction.tsx   # botón de la barra de fechas; carga el panel bajo demanda
│   ├── ClinicalLibraryDrawer.tsx        # panel: búsqueda, categorías, lista o herramienta activa
│   ├── LibraryEntryList.tsx · LibraryDocumentCard.tsx
│   ├── toolRegistry.tsx                 # id de herramienta → icono + componente
│   └── tools/                           # TransferCover, CriticalMedications, Infusion, Dosing, Scores, Medif
├── controllers/                         # lógica pura de presentación y validación
│   ├── libraryPresentation.ts           # badges, tamaños, números es-CL
│   ├── infusionPresentation.ts          # estado del formulario → resultado presentable
│   ├── transferCoverPrint.ts · criticalMedicationsPrint.ts   # HTML imprimible
│   └── plausibleRanges.ts               # rangos plausibles de peso, talla, edad y creatinina
├── domain/
│   ├── libraryCatalog.ts · librarySearch.ts
│   ├── infusionCalculator.ts · infusionPresets.ts
│   ├── doseCalculator.ts · transferCover.ts · criticalMedications.ts
│   ├── scoreEngine.ts · scoreDefinitions.ts · scores/<score>.ts
│   └── medifSchema.* · medifDraft.ts · medifPreferences.ts · medifPatientPrefill.ts
├── services/libraryDocumentActions.ts   # imprimir PDF (iframe con fallback) y codificar rutas
├── services/printHtmlDocument.ts        # imprimir HTML generado en una pestaña nueva
├── services/medifPdf.ts · medifDownload.ts   # plantilla, validación y descarga local del PDF
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
  puntajes en `scoreDefinitions.test.ts`. Las bandas deben cubrir todos los totales alcanzables;
  `singleItemAlert` (NEWS2) y `resolveBand` (CAM-ICU) cubren reglas no aditivas.
- **Medicamento crítico**: una entrada en `domain/criticalMedications.ts`; el test ancla las
  concentraciones y la variante de ampolla.
- **Herramienta**: id en `libraryCatalogTypes.ts`, entrada en el catálogo y registro en
  `components/toolRegistry.tsx`.

## Reglas

- Textos mínimos: sin avisos genéricos ni pies explicativos. Se conservan sólo los datos clínicos
  (rango habitual del fármaco, notas por fármaco, notas y referencia por score).
- Entradas numéricas con coma o punto, validadas contra rangos plausibles; un valor fuera de rango
  se marca y no se calcula.
- Dentro de una herramienta, Escape y el clic fuera vuelven a la lista; en la lista cierran el
  panel. MEDIF con datos solicita confirmar la salida y permite continuar editando o descartar.
  Para retomarlo en otra sesión se descarga un borrador JSON.
- MEDIF lee una copia del censo al elegir una cama o cuna clínica; no escribe en el registro
  diario. Su modo manual no requiere una cama. La ocultación deja los campos en blanco en el
  PDF, mientras el borrador descargado conserva todos los datos, incluidos los ocultos.
- Consumo externo sólo por `@/features/clinical-library` o `quick-action` desde el shell
  (`scripts/feature-public-api-allowlist.json`).

## Verificación visual

`npm run test:e2e:preview:clinical-library:built` (con `npm run build` previo) recorre el botón, la
búsqueda, un PDF servido, las herramientas y el caso a 375 px; con
`CLINICAL_LIBRARY_SHOTS_DIR=<carpeta>` guarda capturas.

En CI, `ci:preview-smoke:built` ejecuta esta prueba junto al bootstrap del censo en una sola
invocación de Playwright, reutilizando el bundle ya compilado. `ci:preview-gate` usa ese mismo
comando; ambos conservan los informes y capturas en `reports/e2e/preview-bootstrap`.
Esta comprobación protege la navegación e interacción; no sustituye la validación clínica de
las fórmulas ni comprueba una impresión física.

El resumen de GitHub separa navegación adaptable, arranque/recargas y biblioteca, con duración
y ubicación de las pruebas no aprobadas. Se genera desde el mismo JSON incluso si el smoke falla.
Se conservan las tres anchuras, segunda visita y recargas repetidas: cubren escenarios distintos.
La detección de errores de arranque queda en la prueba de carga persistida, sin repetir ese mismo
recorrido en otro test.
