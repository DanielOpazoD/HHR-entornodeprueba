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

### Carga adaptativa y diagnóstico temporal

La sesión mantiene una cola única por índice de corte. El corte solicitado precede
al trabajo pendiente, seguido por vecinos con preferencia en la dirección del
scroll. Las solicitudes ya iniciadas terminan; no se cancelan para desperdiciar
transferencias al desplazarse. No hay peticiones duplicadas para un mismo corte.
Descarga y decodificación tienen capacidad separada: hasta 4 descargas por defecto,
un máximo ajustable entre 1 y 6, y 2 preparaciones simultáneas. La cola de originales
por preparar está acotada; si se llena, deja de aceptar trabajo de fondo.

Ante red interrumpida, timeout, 408, 429, 500, 502, 503 o 504, la concurrencia se
reduce a la mitad (mínimo 1), se aplica una pausa global y se hacen como máximo dos
reintentos automáticos con backoff y jitter. Se respeta Retry-After; pausas superiores
a dos minutos requieren reintento manual, sin adelantar el plazo del servidor.
Ocho descargas correctas permiten recuperar un nivel de concurrencia hasta el límite.
Los errores de identidad, autenticación, estructura, decodificación o límites no se
reintentan: invalidan la sesión. El proxy distingue un original inválido/demasiado
grande (422) de un fallo transitorio de transporte. No se amplían roles ni cuotas.

Tras agotar reintentos transitorios, los cortes verificados siguen navegables.
«Reintentar cortes fallidos» solo vuelve a solicitar los fallidos; no vuelve a cargar
la serie. MPR, 3D y MP4 siguen exigiendo todos los cortes verificados. El cine parcial
requiere un intervalo continuo ya preparado, seleccionado explícitamente; no omite
huecos ni presenta ese intervalo como serie completa. Cerrar o cambiar de serie
aborta red y esperas, y libera los recursos después de drenar decodificaciones.

La caché es exclusiva de la sesión y solo en memoria: originales hasta 256 MiB,
máximo 128 millones de muestras y caché decodificada de Cornerstone de 512 MiB.
No hay persistencia en disco, Service Worker ni caché compartida entre pacientes.
El presupuesto de originales no representa toda la memoria GPU/volumen del navegador.

«Carga y conexión» muestra descargas, preparaciones, disponibilidad, reintentos,
concurrencia efectiva y tiempos sin UID, ticket, paciente, URL ni contenido de imagen.
Las métricas permanecen en memoria y no se envían a analítica ni consola. Son sumas de
trabajos que se solapan, no partes sumables de la duración total. La espera de respuesta
incluye autenticación, proxy y red; la transferencia al navegador se mide después de
las cabeceras. `Server-Timing: upstream;dur=...` mide el tramo MMRAD→proxy completo,
no el procesamiento interno de MMRAD. La preparación incluye espera del decodificador
y decodificación; la construcción del volumen se mide al solicitar MPR/3D. No se
atribuye una lentitud al proveedor ni se promete una aceleración del estudio real sin
medirlo en ese equipo/conexión.

### Controles compactos y precarga del estudio

Ventana, inversión de grises y cine comparten la barra. El icono de actividad abre
las métricas: la velocidad media es bytes recibidos por red / tiempo transcurrido
(MiB/s); reutilizar originales precargados no aumenta ese contador. El contador
principal representa imágenes preparadas. Los detalles separan descarga y preparación.

La cabecera muestra el nombre del paciente seleccionado, cuando está disponible,
su documento y fecha del estudio. El informe disponible se descarga solo al pulsar
su botón, con autenticación, `no-store`, nombre de archivo genérico y cancelación
al cerrar. Los datos de cabecera no se añaden a PNG ni MP4.

Tras completar la serie seleccionada, se precargan las otras series en el orden del
estudio, una solicitud a la vez. Se comprueba paciente/estudio/serie/instancia antes
de guardar cada original en una caché exclusiva de la sesión, limitada a 64 MiB
adicionales. La lectura de cada respuesta se corta si excede el espacio reservado;
se reserva también espacio para ensamblar los fragmentos recibidos. No se decodifican ni construyen volúmenes en segundo plano. Al llegar
al límite o ante un fallo se detiene la precarga. Cambiar de serie cancela y drena
la petición pendiente, consume los originales disponibles sin repetir la descarga
y vuelve a verificarlos con el cargador normal. Cerrar el visor vacía la caché.

Con el foco en un plano: arriba/abajo recorre cortes, Re Pág/Av Pág avanza diez,
izquierda/derecha cambia el foco entre los tres planos, y Ctrl/⌘ Z elimina la última
medición del visor. El menú Teclado permite desactivar estos atajos y ofrece el
botón equivalente. Los campos de formulario conservan su manejo de teclado nativo.

### Comparación de series

`Comparar` abre dos paneles cuando la serie principal está completa y verificada.
La opción inicial, `Misma serie · dos ventanas`, comparte los originales y las
imágenes decodificadas: no inicia otra descarga ni otro volumen. Cada panel
conserva su ventana, desplazamiento y zoom durante la navegación. El panel activo
se elige con clic, foco o rueda; las flechas arriba/abajo recorren cortes y las
flechas izquierda/derecha cambian el foco.

La segunda serie pertenece exclusivamente al mismo estudio verificado. Su carga
es progresiva, limitada a dos descargas simultáneas, con los mismos controles de
PatientID, Study/Series/SOP Instance UID, límites de memoria y reintentos del
cargador normal. La precarga especulativa se pausa durante la comparación.
Cambiar la segunda serie cancela y drena sus tareas; cerrar libera sus recursos.
No se persisten imágenes, tickets, posiciones ni preferencias del estudio.

El menú de cadena permite vincular posición (predeterminado), zoom y ventana
(ambos independientes inicialmente). La posición usa ImagePositionPatient,
ImageOrientationPatient, PixelSpacing y FrameOfReferenceUID, nunca el índice de
corte. Se espera a la geometría completa de la segunda serie para evitar elegir
un corte incorrecto durante una descarga parcial. Se rechazan datos incompletos,
marcos distintos, planos no paralelos, localizadores mezclados y posiciones fuera
de la cobertura; los paneles siguen navegables por separado. Esto no registra
estudios ni corrige movimiento del paciente. El zoom vinculado comparte escala
física sin copiar el centro anatómico de la cámara. La ventana entre series exige
TAC con calibración HU válida; la misma serie permite compartirla directamente.

Entre planos no paralelos del mismo marco se dibuja una línea discontinua de
intersección en coordenadas físicas, limitada al rectángulo de la imagen destino.
No se dibujan líneas para planos paralelos o marcos incompatibles. Las vistas MPR
vinculadas existentes continúan disponibles al salir de comparación. La comparación
no incorpora exportaciones combinadas: los controles de captura/cine y privacidad
permanecen en el visor individual.

Validación: geometría sintética (espaciados, orden inverso, matrices, cobertura,
marcos y líneas) y Chromium con dos ventanas sin nuevas solicitudes, navegación
bidireccional por coordenadas, enlace opcional de ventana/zoom, independencia de
marcos incompatibles y rechazo de una segunda serie de otro paciente.

### MPR oblicuo y espesor

El menú contextual «Reconstrucción MPR» activa los tiradores de rotación de las
líneas, conservando su intersección en coordenadas LPS. «Punto» sigue sirviendo
para trasladar la referencia; durante la rotación se usan líneas completas.
Cada pane identifica si su orientación es oblicua y actualiza las letras LPS.

El espesor se expresa como anchura **total** en milímetros (0: corte fino;
0,5–50 mm: promedio, MIP o MinIP), centrada en cada plano. Core 4.22 define
sus clipping planes como focalPoint ± slabThickness: se entrega la mitad del
valor de interfaz. Las proyecciones reutilizan el volumen en GPU sin nuevas
transferencias. «Parcial» indica que la franja solicitada excede el volumen en
el centro del plano; fuera de los límites adquiridos no se inventan muestras.
La cobertura puede variar hacia los bordes de un plano oblicuo.

Se conserva la validación física de `planDicomVolume`: marco compartido,
orientación ortonormal y consistente, espaciado positivo uniforme, ausencia de
cortes duplicados/huecos/desplazamiento lateral, y campo físico equivalente
para matrices heterogéneas. Una serie rechazada no obtiene controles ni una
reconstrucción aparentemente válida. No se añade corrección de gantry tilt.

Distancias y ángulos son medidas del plano central en espacio físico. HU y ROI
se bloquean y sus anotaciones se ocultan mientras exista un plano oblicuo o
una proyección con espesor: las estadísticas actuales de Cornerstone no son
estadísticas de una proyección ni de una elipse oblicua. Las anotaciones no se
borran y reaparecen al volver a corte fino ortogonal. Restablecer MPR recupera
orientaciones y espesor iniciales; el contraste se conserva. Las capturas
incluyen el modo/espesor y condición oblicua, sin incorporar las mediciones.
Datos y herramientas son transitorios; no cambian la verificación del paciente
ni se persisten datos adicionales. La prueba automatizada usa solo DICOM sintético.
