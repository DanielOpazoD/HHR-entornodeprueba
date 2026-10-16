# Editor MEDIF en HHR

El editor prepara el formulario MEDIF de LATAM a partir de datos escritos manualmente o de una copia del paciente de una cama del censo. Se abre desde **Documentos → Herramientas → Completar MEDIF · LATAM**. También aparece al buscar «MEDIF» en el panel Documentos. La entrada del formulario PDF en blanco continúa disponible en Formularios.

## Uso

1. Elegir **Ingreso manual** o un paciente del censo seleccionado.
2. Completar el formulario en una vista continua y revisar las respuestas clínicas. El icono de configuración abre **Variables** y **Preferencias** para consultar el diccionario y ajustar qué campos se muestran.
3. Descargar **PDF editable** para conservar los casilleros rellenables, o **PDF imprimible** para obtener los valores fijados sobre las tres páginas originales.
4. Para continuar en otra sesión, usar los iconos **Guardar borrador** e **Importar borrador**.

El formulario se presenta en una sola vista con siete bloques funcionales: Paciente y vuelo; Diagnóstico y evaluación; Riesgo y autonomía; Asistencia y acompañante; Tratamiento y traslado; Psiquiatría; Médico y declaraciones. El paciente y el vuelo están al inicio, y el médico y las declaraciones al final. En pantallas amplias, los bloques intermedios pueden colocarse en columnas; en pantallas pequeñas continúan uno debajo de otro. No hay navegación entre diez pantallas para completar el formulario.

El esquema técnico y el diccionario conservan las diez secciones originales para ubicar los campos del PDF. [medifFormLayout.ts](../src/features/clinical-library/domain/medifFormLayout.ts) distribuye sus 57 grupos exactamente una vez entre los siete bloques. El PDF exportado conserva sus tres páginas. Las marcas X se generan a 7,5 puntos (50 % más grandes que antes, de 5 puntos), centradas y ajustadas dentro de los 68 casilleros originales, tanto en la copia editable como en la imprimible.

Se conservan **137 variables** del PDF: **69 campos de texto** y **68 casilleros de texto para `X`**. Los casilleros se presentan como 31 preguntas de selección exclusiva. Cada pregunta puede quedar sin respuesta. El nombre y la edad se muestran una sola vez en el editor y se copian a sus campos de ambas partes del PDF. El nombre del médico se completa una vez en Datos del médico y se copia a Médico autorizado (página 1) y a la declaración médica (página 3). La fecha de Declaración del médico (`p3_fecha_declaracion`) se copia a Declaración del pasajero (`p1_declaracion_fecha`); solo aparece el control de la fecha médica. Los borradores antiguos usan la fecha médica cuando existe, y la del pasajero cuando falta. Las otras preguntas repetidas mantienen respuestas independientes. Las dos preguntas de silla de ruedas conservan valores independientes; la segunda se identifica como evaluación del médico.

El [diccionario completo](medif-variables.md) identifica cada variable, su página, tipo y origen. La vista Variables ofrece el mismo inventario y permite localizar el campo en el formulario continuo; los alias de nombre, edad y médico apuntan a su control único.

## Datos del censo

[MedifTool](../src/features/clinical-library/components/tools/MedifTool.tsx) obtiene el registro diario ya disponible en `DailyRecordContext`. El [adaptador](../src/features/clinical-library/domain/medifPatientPrefill.ts) construye opciones para camas ocupadas y cunas clínicas; excluye CMA, camas bloqueadas y camas extra inactivas. La lista corresponde a la fecha del censo seleccionado, que puede ser histórica.

Al elegir un paciente se copian hasta siete campos:

| Dato del censo                   | Variables MEDIF                            | Revisión                                                                                                            |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `record.beds[bedId].patientName` | `p1_nombre_pasajero`, `p2_nombre_paciente` | Confirmar identidad.                                                                                                |
| `record.beds[bedId].age`         | `p1_edad`, `p2_edad`                       | Conserva la unidad escrita. Si falta, usa `birthDate` y la fecha válida del censo para calcular años, meses o días. |
| `record.beds[bedId].pathology`   | `p2_diagnostico_actual`                    | Borrador editable que requiere revisión médica, incluida resolución o alta cuando corresponda.                      |

También se copian `biologicalSex` a `p2_genero` y la fecha válida de ingreso `admissionDate`, en formato día/mes/año, a `p2_contagiosa_fecha_tipo` (Enfermedad y fecha de inicio), conforme al mapeo solicitado. Ambos datos son editables. Una fecha de ingreso inválida o posterior al censo deja el campo vacío.

Para una cuna clínica se aplica el mismo mapeo a `record.beds[bedId].clinicalCrib`. El formulario conserva la copia cargada mientras se edita: las actualizaciones posteriores del censo no reemplazan lo escrito. Elegir otro paciente, volver al ingreso manual o cargar otro borrador solicita reemplazar todos los datos cuando el formulario contiene información.

MEDIF no escribe sobre camas, fichas ni registros diarios. No realiza nuevas búsquedas de pacientes en servicios remotos. El modo manual permite completar el formulario sin seleccionar una cama. La ruta permanece fija. El campo Género se propone con el sexo registrado por solicitud expresa del usuario. No se equiparan seguro de salud y seguro de viaje, especialidad de hospitalización y especialidad del médico, ni fecha de ingreso y fecha de diagnóstico.

## Check verde de respuestas habituales

El botón **Respuestas habituales** completa únicamente campos vacíos al pulsarlo, tanto en modo manual como con paciente del censo. Conserva el texto ya escrito y cualquier opción previamente marcada dentro de una pregunta, aunque sea distinta del preset. Omite los campos ocultos y puede pulsarse varias veces sin sobrescribir respuestas. Elegir un paciente no marca decisiones clínicas por sí mismo.

- No necesita silla de ruedas, en las preguntas del pasajero y del médico; no tiene patología psiquiátrica.
- Sí puede flectar rodillas y cadera.
- No requiere medicación previa ni durante el vuelo; no utiliza anticoagulante; no requiere coordinación de ambulancia en el aeropuerto.
- Sí requiere hospitalización y hospitalización o ambulancia al llegar al destino.
- Sí es independiente para comer e ir al baño; no presenta alteración de conducta ni del control de esfínter.
- Riesgo vital bajo o sin riesgo; sí está en condiciones de transportarse en avión; no tiene enfermedad contagiosa o transmisible.
- No tiene requerimientos especiales en vuelo; sí puede entender las instrucciones de seguridad.

El preset contiene 20 respuestas de selección. La ruta **Isla de Pascua → Santiago** es fija desde el inicio, no depende del check verde y no tiene controles editables. Se mantiene al importar borradores antiguos y no puede ocultarse; el PDF siempre la incorpora. Solo se muestra **Fecha del vuelo** para el tramo. Los valores fijos por sí solos no activan el aviso de borrador sin guardar. El sexo y la fecha de ingreso se proponen al cargar el paciente según el mapeo anterior. En modo manual estos dos datos se completan manualmente. Todas las respuestas quedan editables antes de emitir el PDF. La implementación está en [medifHabitualAnswers.ts](../src/features/clinical-library/domain/medifHabitualAnswers.ts).

## Preferencias y borradores

Son archivos con propósitos y contenidos diferentes:

| Elemento     | Contenido                                                                                  | Conservación                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferencias | Versión `4` y `hiddenFieldIds`, únicamente identificadores de campos ocultos.              | Se guardan en `localStorage` bajo `hhr.medif.preferences.v1`; se pueden exportar/importar como `medif-preferencias.json`.                                                          |
| Borrador     | Versión `1` y `values`, con los datos escritos en todos los campos, incluidos los ocultos. | Permanece en memoria durante la edición. **Guardar borrador** descarga `medif-borrador.json`; no se guarda automáticamente en almacenamiento del navegador ni en la base de datos. |

La configuración inicial conserva **45 variables seleccionadas para ocultar**, más la alternativa `p2_estable_si`: **46 campos ocultos y 91 visibles** (39 de texto y 52 casilleros de marca). Se ocultan también Prognosis para el viaje y Firma del médico (texto). La interfaz presenta **84 controles** al compartir nombre y edad del paciente, las tres copias del médico y las dos fechas de declaración, y excluir los dos valores fijos de la ruta. No muestra el índice de accesos a bloques ni el rótulo Datos del pasajero. Los campos ocultos siguen disponibles en Preferencias. La selección está en [medifDefaultHiddenFields.ts](../src/features/clinical-library/domain/medifDefaultHiddenFields.ts).

En Preferencias, ocultar una alternativa oculta la pregunta completa; nombre y edad también comparten visibilidad entre ambas páginas. **Mostrar todos** restaura la visibilidad. La configuración inicial puede restablecerse desde Preferencias. Si el navegador impide guardar, el editor informa el problema y permite exportar la configuración.

La clave de almacenamiento continúa siendo `hhr.medif.preferences.v1`; el contenido usa versión `4`. Las preferencias antiguas v1/v2/v3 incorporan una sola vez los dos campos retirados del formulario. V1 también incorpora el preset; v1/v2 restauran la pregunta de instrucciones de seguridad. V3 conserva las decisiones sobre esa pregunta. V4 respeta las reactivaciones posteriores. Las fechas de ambas declaraciones comparten visibilidad y las preferencias no pueden ocultar la ruta fija. La importación explícita de archivos v1/v2/v3/v4 respeta la selección del archivo, normaliza sus unidades y devuelve v4.

Ocultar un campo conserva su valor en la sesión y en el borrador completo. Al generar cualquiera de los dos PDF, el valor oculto se deja en blanco, incluso si antes tenía información. Volver a mostrarlo permite recuperar su valor. La importación de un borrador no reemplaza las preferencias y se presenta sin asociación a una cama.

Los archivos de preferencias se validan estrictamente: no aceptan datos de pacientes, propiedades adicionales ni identificadores desconocidos. Los borradores sí contienen información del formulario; la importación valida nombres de campo conocidos, valores de texto, marcas `X` o vacías, opciones compatibles y coincidencia del nombre y la edad entre ambas partes.

El panel solicita confirmar la salida de un MEDIF con datos. La continuidad entre sesiones depende de descargar y volver a cargar el borrador; una recarga de la aplicación no recupera automáticamente el formulario.

## Plantilla y PDF

La plantilla de generación es [medif-latam-rellenable.pdf](../public/docs/biblioteca/medif-latam-rellenable.pdf). Procede del archivo `FORMULARIO_MEDIF_ES copia.pdf` facilitado para esta implementación y de su versión con 137 campos AcroForm de texto, `FORMULARIO_MEDIF_ES_rellenable.pdf`. La copia incorporada conserva los bytes de esa versión rellenable; SHA-256:

```text
961661b4835ffdf2f8aa5d3646cdf890dbda3a75c82263ee68f00c7d9b2ceec7
```

El PDF en blanco ya presente en el catálogo, [medif-latam.pdf](../public/docs/biblioteca/medif-latam.pdf), es un recurso separado. Las imágenes de referencia se encuentran en `public/images/forms/medif/page-1.png` a `page-3.png`; muestran la plantilla sin los datos de la sesión.

[medifPdf.ts](../src/features/clinical-library/services/medifPdf.ts) utiliza `pdf-lib` en el navegador. Antes de escribir verifica que la plantilla tenga tres páginas y los 137 nombres esperados. Parte de la plantilla y vuelve a escribir todos los casilleros, incluidos los ocultos con valor vacío. Actualiza las apariencias para reflejar los valores exportados.

- **PDF editable** conserva los campos interactivos de texto.
- **PDF imprimible** fija los campos sobre las páginas mediante `flatten`; después puede imprimirse desde el visor de PDF.

[medifDownload.ts](../src/features/clinical-library/services/medifDownload.ts) descarga el resultado localmente. Su caché en memoria contiene únicamente la plantilla pública en blanco. La primera carga de la plantilla debe estar disponible; si falla, se informa y se permite reintentar. El módulo no envía el formulario a LATAM ni a otro destinatario.

## Validaciones y límites

La exportación normaliza el texto a NFC y los saltos de línea. Usa Helvetica estándar; si un carácter no puede representarse en esa fuente, identifica el campo y detiene la generación. Los casilleros de una sola línea rechazan saltos de línea.

Para acomodar el texto al espacio original, el tamaño se ajusta entre 8 y 4 puntos; las marcas comienzan en 5 puntos. El ajuste comprueba ancho y altura, también en campos multilínea. Si el contenido no cabe, muestra un error con la etiqueta del campo para que se abrevie: no se trunca automáticamente ni se agrega contenido fuera del formulario. Los textos extensos pueden necesitar un documento adjunto independiente.

Estas comprobaciones cubren la estructura y el ajuste al PDF. No establecen aptitud para volar, riesgo, dosis, requerimiento de oxígeno ni aceptación por la aerolínea. Los campos de firma siguen siendo texto: escribir un nombre no genera una firma electrónica. La declaración y el contenido clínico requieren revisión del responsable que emitirá el formulario.

## Archivos y comprobaciones de mantenimiento

- [medifSchema.json](../src/features/clinical-library/domain/medifSchema.json) y [medifSchema.ts](../src/features/clinical-library/domain/medifSchema.ts): inventario, geometría, secciones y grupos.
- [medifFormLayout.ts](../src/features/clinical-library/domain/medifFormLayout.ts): siete bloques continuos, etiquetas de contexto y controles únicos de nombre y edad.
- [medifDraft.ts](../src/features/clinical-library/domain/medifDraft.ts): valores, alias, selección exclusiva e importación/exportación de borradores.
- [medifPreferences.ts](../src/features/clinical-library/domain/medifPreferences.ts): visibilidad y persistencia de identificadores.
- [MedifEditor.tsx](../src/features/clinical-library/components/tools/medif/MedifEditor.tsx): edición, reemplazo, navegación y descargas.

Pruebas focales disponibles:

```sh
npm exec -- vitest run src/tests/features/clinical-library/medifFormLayout.test.ts src/tests/features/clinical-library/medifSchema.test.ts src/tests/features/clinical-library/medifPreferences.test.ts src/tests/features/clinical-library/medifPatientPrefill.test.ts src/tests/features/clinical-library/medifPdf.test.ts src/tests/features/clinical-library/MedifEditor.test.tsx
```

Al cambiar la plantilla deben revisarse juntos los nombres de campo, el esquema, las imágenes de referencia y el diccionario. Las pruebas de dominio no sustituyen la inspección del PDF generado ni una comprobación de impresión en el visor utilizado.
