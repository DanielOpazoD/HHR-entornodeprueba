# `src/features/radiology`

Imágenes del paciente: la lista de exámenes de MMRAD (búsqueda, informe, PDF) y el visor DICOM.
El contrato del visor, la descarga y los anexos está en [MMRAD_DICOM.md](../../../docs/MMRAD_DICOM.md).

## Qué hay aquí

| Carpeta         | Qué contiene                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------- |
| `components/`   | El visor de imágenes MMRAD (`RadiologyViewerModal`) y su contenido.                          |
| `controllers/`  | Búsqueda de estudios, memoria de la lista de exámenes y reglas puras del visor MMRAD.        |
| `dicom-viewer/` | El visor DICOM: pantallas, controles, hojas de estilo y sus hooks.                           |
| `domain/`       | Geometría, reconstrucción y remuestreo DICOM exclusivos del visor.                           |
| `services/`     | Cliente MMRAD, sello de fecha, entrega de PDF y el motor DICOM (carga, medidas, MPR, video). |

Lo puro que también compila Netlify vive en `src/domain/radiology`: `dicomTypes.ts` (contratos de
transporte y captura) y `mmradReportSupport.ts` (lectura del informe).

## Puertas

Otras áreas entran solo por los módulos declarados en `publicModulesByFeature.radiology` de
`scripts/feature-dependency-matrix.json` (ESLint `hhr/public-import-boundaries`). No hay un
`public.ts` que los reúna: un barril cambia el orden en que se ejecutan esos módulos y, con él, cómo
Rollup los reparte en chunks. Medido en W15-A7: dos chunks precargados de MMRAD se reordenaban y los
documentos clínicos pasaban a cargar `dicomTypes`.

- Se cargan a pedido: `components/RadiologyViewerModal` y `dicom-viewer/DicomViewerDialog`, cada uno
  con el chunk de su nombre, que usan el precache y `scripts/config/onlineOnlyAssets.mjs`.
- Funciones livianas del explorador clínico y de los documentos: búsqueda y cliente MMRAD
  (`services/mmradService`, `controllers/mmradStudySearch`), memoria de la lista
  (`controllers/radiologyExamListMemory`), informe estructurado
  (`controllers/radiologyViewerContentController`), sello de fecha (`services/mmradStamp`), entrega
  del PDF (`services/mmradPdfDelivery`) y caché de revisión DICOM (`dicom-viewer/useDicomReviewCache`).

Quién entra y por qué (aristas de `scripts/feature-dependency-matrix.json`):

- `census`: el explorador clínico lista, descarga y abre imágenes, y la columna «Accesos» abre el
  visor MMRAD.
- `clinical-documents`: el atajo MMRAD copia el informe de un TAC al documento activo.
- `clinical-library`: los formularios abren el visor para elegir capturas DICOM como anexos.
- La barra de fechas del censo (`components/layout`) no puede importar un área: el shell
  autenticado le entrega el visor (`radiologyViewer`), como hace con Laboratorio.
