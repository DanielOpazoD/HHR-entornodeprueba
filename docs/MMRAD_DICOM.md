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

MPR/3D requieren al menos tres cortes CT/MR, orientación compatible, un mismo
marco de referencia y posiciones uniformes sin duplicados ni inclinación. No se
mezclan series ni se descartan cortes volumétricos para fabricar un volumen completo. Los
avisos de incompatibilidad son categorías fijas, sin UID ni valores del estudio.

Una serie CT puede incluir localizadores de planificación que no representan cortes
del volumen. Se excluyen de MPR/3D únicamente cuando el original validado es CT
Image Storage clásico, su modalidad es CT y el tercer valor de Image Type es
exactamente `LOCALIZER`, según [DICOM C.8.2.1.1.1](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.8.2.html).
Original conserva todas las imágenes y MPR/3D muestran un aviso de esa selección.
La identidad y los límites de carga se comprueban también para cada localizador.
No se deduce esta clasificación de nombres, tamaño de matriz, orientación ni
grupos minoritarios; MR, tipos ausentes o ambiguos y otras clases SOP conservan
todas sus imágenes para la validación geométrica. Los cortes restantes deben
superar las mismas comprobaciones de marco, orientación, cobertura y espaciado,
incluido el mínimo de tres cortes. El relleno o escala de un localizador excluido
no afecta la elegibilidad de remuestreo de los cortes volumétricos.

Las matrices heterogéneas se admiten cuando los cuatro bordes del campo físico
coinciden dentro del menor de 0,001 mm y el 0,1 % del píxel más pequeño.
La orientación también debe coincidir dentro de esa tolerancia en los bordes.
Se proyecta sobre los ejes de cada original y se verifica la huella adquirida
antes de limitar la interpolación a los píxeles de borde. El centro del primer píxel, los cosenos de orientación
y PixelSpacing se interpretan según [DICOM C.7.6.2](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html).
El destino tiene el máximo de filas y columnas de los originales sobre ese campo;
la interpolación bilineal opera en coordenadas físicas y unidades calibradas,
sin aplicar dos veces RescaleSlope/Intercept. No se añaden cortes en profundidad.
Sólo se prolonga el píxel de borde dentro de su huella de medio píxel. No se
recorta a una intersección ni se rellenan campos ausentes con aire o ceros.

El remuestreo admite escala lineal MONOCHROME2 de un componente. Se rechazan
relleno de píxeles, LUT de modalidad, mapas Real World Value y grupos funcionales
compartidos o por cuadro (incluso en objetos de un solo cuadro), que requerirían
tratamiento adicional. El volumen Float32 adicional se limita a 256 MB y 4096
píxeles por eje del plano; además debe caber en la caché sin desalojar originales.
La preparación cede el hilo entre bloques y comprueba cancelación. Un fallo libera
las imágenes derivadas, incluso si la creación del volumen quedó a medias.

El aviso visible y la etiqueta de captura identifican el volumen remuestreado;
la interpolación no añade detalle adquirido. Original conserva sus píxeles y
geometría. La identidad se verifica para todos los originales antes de reconstruir.
La separación entre cortes admite una desviación de hasta el 2 % con techo de
0,05 mm y rechaza distancias inferiores a 0,01 mm, incluidos los duplicados.

Los límites locales son 1024 instancias, 128 millones de muestras, 256 MB de
originales y 512 MB de caché decodificada por runtime. Se liberan caché, archivos,
motor gráfico y trabajadores al cerrar; cambiar de serie cancela la anterior.
Las series multicuadro se remiten explícitamente al visor externo en esta versión.
La vista y la captura esperan `IMAGE_RENDERED` de cada plano, con cancelación y
tiempo límite. El aviso inicial de `ResizeObserver` no redimensiona un canvas cuyo
tamaño no cambió; así no se habilita la captura antes de terminar el dibujo.
MPR/3D completan un segundo pase de renderizado tras inicializar la textura
compartida del volumen. La prueba con SwiftShader exige contenido y contraste
correctos en los tres planos y conservación de intensidad al remuestrear; no se modifican los originales DICOM.

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
`src/tests/services/radiology/dicomResampling.test.ts`,
`src/tests/services/radiology/dicomVolume.test.ts`,
`src/tests/services/radiology/dicomSeriesLoader.test.ts`,
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

### Referencia MPR y presentación 3D

MPR mantiene los planos axial, coronal y sagital ortogonales. Con **Planos vinculados**
y **Punto de referencia**, pulsar un punto alinea los otros planos con la misma posición
física. La rueda y los botones de corte actualizan la referencia compartida. Se puede
mostrar como líneas cruzadas o punto compacto; sus coordenadas son LPS (izquierda,
posterior, superior) en milímetros del marco DICOM, no coordenadas de pantalla.
Mover/zoom cambian la presentación, sin rotar los planos ni alterar la geometría adquirida.

Distancia y ángulo son medidas transitorias en MPR. **Borrar medidas**, cambiar de modo,
serie o cerrar el visor las elimina. No se guardan en la historia ni en telemetría;
la captura PNG actual contiene el canvas de imagen, sin estas anotaciones SVG.

3D permite elegir apariencia por modalidad (CT: hueso, tejidos blandos, músculo,
grasa, pulmón; RM: general/T2), ajustar opacidad e iluminación, y desplazar los umbrales
CT en HU. Son funciones de transferencia de intensidad, **no segmentación de órganos**.
El recorte por eje LPS y profundidad permite explorar el interior; puede invertirse
el lado o restablecerse completamente. Solo cambia el actor 3D en memoria: Original,
MPR, los píxeles fuente y las comprobaciones de identidad/geometría se conservan.
Los cambios se reinician al cambiar de modo. Las pruebas automatizadas usan exclusivamente
DICOM sintéticos y comprueban navegación enlazada, contenido renderizado y recuperación.

### Espacio de imagen y controles compactos

El visor ocupa la altura disponible y reserva el espacio restante a los planos.
La identificación del paciente y el selector de serie permanecen visibles. Las
herramientas de medidas, inversión y exportación usan iconos con nombre accesible
y ayuda al pasar el cursor. La información sobre medidas temporales se consulta
en el icono de información. **Ajustes 3D** abre un panel superpuesto de apariencia
y recorte; Escape cierra ese panel antes de cerrar el visor. En pantallas estrechas,
los planos se apilan y se recorren con desplazamiento vertical.

### Carga progresiva y espacio de trabajo

Original abre el corte central verificado sin esperar la serie completa. Una cola de
cuatro trabajadores prioriza el corte solicitado y luego sus vecinos; las peticiones
ya en curso terminan normalmente. El selector conserva todas las posiciones: un corte
pendiente muestra su estado y nunca se sustituye silenciosamente por otro disponible.
Se verifica paciente/Study/Series/SOP antes de decodificar y publicar cada imagen.
MPR y 3D esperan todas las imágenes y mantienen la validación geométrica existente.

La descarga continúa en memoria. Cerrar o cambiar de serie cancela la cola y libera
las imágenes cuando terminan las operaciones en curso. Un fallo de identidad o carga
invalida la sesión; no se reconstruyen volúmenes con huecos. La captura de Original
requiere un corte disponible, conserva su posición dentro de la serie completa y se
cancela si cambia la selección durante la captura. No hay persistencia de imágenes.

Cada plano MPR tiene un botón para ampliarlo y volver a los tres. Las otras vistas
permanecen montadas para conservar la referencia compartida. Pantalla completa usa
la API del navegador y permite volver con su botón o Escape; si el navegador la
rechaza, el visor permanece utilizable en su ventana normal.

### HU y ROI en MPR

**Contraste** activa ventana/nivel por arrastre. **HU** mide un punto y **ROI** permite
arrastrar una elipse con área en mm², promedio y desviación estándar (DE) en HU.
Las anotaciones son temporales, se eliminan con «Borrar medidas» o al cambiar/cerrar
la vista y no se incluyen en PNG ni anexos.

Los controles cuantitativos se habilitan únicamente si todos los cortes volumétricos
son CT clásico monocromático, tienen espaciado físico válido y una conversión lineal
HU confirmada, aplicada por el decodificador con la pendiente/intercepto declarados.
HU puede ser explícito en Rescale Type o implícito únicamente en CT ORIGINAL no
localizador y no multienergía, según [DICOM PS3.3 C.8.2](https://dicom.nema.org/medical/Dicom/current/output/chtml/part03/sect_C.8.2.html).
No se asume HU por la modalidad solamente. Relleno de píxeles, LUT, mapas de valores
reales, grupos funcionales o calibración incompleta deshabilitan estas herramientas.
Las ROI vacías, fuera de imagen o no compatibles no muestran estadísticas inventadas.
En volúmenes remuestreados se mide el volumen interpolado, no los píxeles originales.

### Cine y MP4 local

En Original, Cine / MP4 permite seleccionar un intervalo inclusivo de la serie y
5, 10, 15, 20 o 30 cortes/s. Cine espera cada corte verificado y ralentiza la
reproducción si la descarga/render es más lento: no salta cortes para recuperar
el tiempo. Durante el trabajo se bloquea la interacción con la imagen; cancelar
permite volver a navegar. Cambiar de serie/paciente o cerrar aborta el trabajo.

MP4 se habilita al completar la verificación de toda la serie; cine admite carga
progresiva. MP4 usa H.264/WebCodecs con Mediabunny cargado bajo demanda. Se captura un canvas
sin overlays del DOM, se codifica un cuadro por corte con timestamps explícitos,
se valida el conteo y se finaliza antes de ofrecer el archivo. No usa grabación
de pantalla, audio ni servidor externo. Dimensiones pares hasta 1280x720 sin
ampliación, bitrate objetivo 4 Mbps y límite de 64 MiB; no se guarda un archivo
parcial. Cambiar el tamaño de la vista durante el proceso exige reiniciarlo.
Si el navegador no codifica H.264 se explica la incompatibilidad, sin renombrar
WebM como MP4. El módulo de medios no forma parte del arranque del visor.

El video queda temporalmente en memoria con un URL blob revocable. Antes de
activar la descarga, debe poder reproducirse en la vista previa y el usuario
confirma haber revisado todo el video sin identificadores visibles. Esto NO es
anonimización: los originales pueden contener texto identificable incrustado en
píxeles. Descartar/cambiar/cerrar revoca el URL. El nombre de descarga es genérico;
no se agregan identificadores, credenciales ni metadatos clínicos al contenedor.
El MP4 es una copia con contraste fijo y compresión, no sustituye al DICOM.
La CSP permite medios self/blob únicamente para la previsualización local.
