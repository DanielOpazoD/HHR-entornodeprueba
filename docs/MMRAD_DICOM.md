# Visor DICOM y anexos del Salvador

## Uso y alcance

Desde Radiología, elegir paciente y examen y pulsar **Ver DICOM**. El enlace externo
de MMRAD permanece disponible. Desde Documentos → Informe de traslado Hospital del
Salvador, completar o seleccionar el paciente y abrir **Imágenes MMRAD**. El mismo
visor permite **Añadir al informe**; las capturas seleccionadas se ordenan, describen
y eliminan en **Anexos para Word**. Se insertan después del formulario original,
una por página, al descargar Word. El PDF del formulario conserva su salida existente.

**PNG** ofrece el selector de archivos empezando en Escritorio cuando el navegador
lo admite; en los demás utiliza la descarga normal del navegador. La carpeta final
la decide el usuario o su configuración de descargas.

Las capturas viven sólo en memoria. Cambiar de RUT, cama/episodio o identidad las
descarta; cambiar entre formularios conserva los anexos del Salvador para ese
mismo paciente. El borrador JSON contiene campos, sin imágenes. No se
guardan imágenes en preferencias, Firestore, Storage, IndexedDB ni localStorage.
Se comprueba el RUT nuevamente al exportar Word. No se modifica el censo.

## Carga y reconstrucción

El diálogo se monta por clic. Su importación dinámica separa interfaz y runtime:
`components/radiology/DicomViewerDialog.tsx` → `DicomViewer.tsx` →
`services/radiology/dicomRuntime.ts`. Cornerstone, vtk.js, decodificadores y
trabajadores quedan fuera del arranque y del precache PWA. No hay precarga al pasar
el puntero. Abrir Radiología o el selector de exámenes tampoco carga Cornerstone.

Sólo se descargan los originales de la serie seleccionada, con cuatro solicitudes
simultáneas y progreso real. Se verifican paciente, estudio, serie e instancia en
cada archivo antes de decodificarlo. La vista original recorre los cortes; MPR
ofrece axial, coronal y sagital. La vista 3D utiliza renderizado volumétrico de la
misma serie. No genera segmentaciones ni modelos anatómicos inferidos.

MPR/3D requieren al menos tres cortes CT/MR, dimensiones y orientación compatibles,
un mismo marco de referencia y posiciones uniformes sin duplicados ni inclinación
de adquisición. Una geometría incompatible conserva la alternativa de vista
original. No se reconstruyen volúmenes incompletos ni se mezclan series.

Los límites locales son 1024 instancias, 128 millones de muestras, 256 MB de
originales y 512 MB de caché decodificada por runtime. Se liberan caché, archivos,
motor gráfico y trabajadores al cerrar; cambiar de serie cancela la anterior.
Las series multicuadro se remiten explícitamente al visor externo en esta versión.
La vista y la captura esperan `IMAGE_RENDERED` de cada plano, con cancelación y
tiempo límite. El aviso inicial de `ResizeObserver` no redimensiona un canvas cuyo
tamaño no cambió; así no se habilita la captura antes de terminar el dibujo.
MPR/3D completan un segundo pase de renderizado tras inicializar la textura
compartida del volumen. La prueba con SwiftShader exige contenido y contraste
correctos en los tres planos; no se sustituyen ni alteran los valores DICOM.

Se fija Cornerstone **4.22.13**, compatible con Node 22; la serie 5 consultada
introducía un códec que exige Node 24. No modificar el runtime del proyecto para
resolver ese requisito. Los códecs y WASM se sirven desde el propio despliegue.
La autorización de WASM se limita a la respuesta del trabajador DICOM; la CSP del
shell conserva su restricción contra evaluación de código.
Los códecs fijados usan Emscripten/Embind y necesitan generar sus bindings JavaScript;
`unsafe-eval` queda limitado a ese trabajador, sin acceso a red fuera del mismo origen.
La regla del trabajador debe ir después de `/*`: la comprobación del CDN demostró
que la regla general posterior sustituía su CSP. Verificar el encabezado efectivo
del JavaScript publicado y la CSP estricta del HTML al cambiar el despliegue.

## Protocolo MMRAD y límites del servidor

Los HAR privados suministrados permitieron reconocer dos flujos: `examenZip`
prepara un archivo ZIP; el visor enumera originales con SockJS/DDP
`GetStudyMetadata`. Un HAR pequeño de preparación no indica el tamaño del estudio
ni contiene necesariamente el ZIP. Esta integración usa los originales del visor,
sin enviar un ZIP completo por una Function.

El `patientId` de los metadatos MMRAD es un ID interno y no se proyecta al RUT.
El contexto solicitado se contrasta con `PatientID` de **cada original DICOM**,
además de los tres UID, antes de decodificar o mostrar cualquier corte. No se usa
la coincidencia de nombres como sustituto de un documento diferente.

`mmrad-dicom` reutiliza la sesión RIS y la autorización Firebase/rol canónica de
`mmrad-search`; no añade credenciales al frontend. El servidor valida el iframe
del visor y cada URL WADO contra destinos institucionales exactos. El destino PACS
anidado sólo se transmite como parámetro al proxy HTTPS del proveedor, nunca se
consulta directamente desde el navegador o la Function. Las cookies RIS sólo
viajan a RIS, sin reenviarse al host del visor.

La página RIS puede incluir un iframe auxiliar antes del visor. Se examinan sus
atributos `src` y se acepta únicamente el origen HTTPS y la ruta de estudio del
visor institucional, sin credenciales, query ni fragmento. La ausencia de un
estudio válido o la presencia de dos estudios distintos se rechaza; no se elige
el primer iframe por posición. La validación de `PatientID` y los tres UID de cada
original sigue siendo obligatoria antes de decodificarlo.

`GetStudyMetadata` entrega `wadouri` como ruta relativa (`/__wado_proxy?...`). Se
resuelve contra el origen fijo del visor antes de validar destino, parámetros y
los tres UID. Una URL absoluta o relativa hacia otro host sigue siendo rechazada.

Las instancias requieren una capacidad HMAC de 30 minutos, ligada al usuario,
estudio, serie y SOP; no admite URLs arbitrarias. Se transporta por POST, sin
identificadores clínicos en la URL de la Function. El acceso exige el mismo Bearer
y rol en cada petición. Se usa el secreto MMRAD existente con separación de dominio
para firmar capacidades; no se requiere otra variable de despliegue.

Para un `403 Origin not allowed` en un Deploy Preview, aplicar el
[runbook de orígenes de Functions](CI_GATES_AND_FAILURE_RUNBOOKS.md#functions-preview-rechazado-por-origen).

El servidor limita a 3,5 MB cada original para respetar el máximo de respuesta
serverless, a 100 series/8000 instancias los metadatos y a 25 s su consulta. Las
cuotas de metadatos (10/min) e imágenes (1500/min) son independientes de la búsqueda
RIS existente. Las respuestas tienen `no-store`; no se registran identificadores,
capacidades, cookies, originales ni metadatos clínicos en telemetría.

## Verificación y continuidad

Pruebas: `src/tests/netlify/mmradDicom.test.ts`,
`src/tests/services/radiology/dicomGeometry.test.ts`,
`src/tests/services/radiology/saveDicomPng.test.ts`,
`src/tests/features/clinical-library/clinicalFormAnnexes.test.ts` y
`e2e/dicom-viewer.spec.ts`. Los datos DICOM se generan en
`src/tests/fixtures/syntheticDicom.ts`; no proceden de los HAR.

Para la prueba del navegador usar el build E2E y el arnés de preview del repo:

```sh
PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 npx playwright test -c playwright.preview.config.ts e2e/dicom-viewer.spec.ts --project=chromium
```

Esa prueba intercepta la conexión y ejercita el renderer real con imágenes
sintéticas. No acredita una consulta clínica de extremo a extremo al proveedor.
Una comprobación privada adicional recuperó un original MMRAD por HTTPS y verificó
sus tres UID y la presencia de píxeles. Confirmó que el ID del portal es interno.
Eso acredita la descarga directa; no acredita todavía el recorrido completo de un
estudio del proveedor dentro de un despliegue autenticado. Registrar esa prueba
aparte cuando se realice. No publicar HAR ni capturas reales en el repositorio o CI.
