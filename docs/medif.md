# Editor MEDIF en HHR

El editor prepara el formulario MEDIF de LATAM a partir de datos escritos manualmente o de una copia del paciente de una cama del censo. Se abre desde **Documentos → Herramientas → Completar MEDIF · LATAM**. También aparece al buscar «MEDIF» en el panel Documentos. La entrada del formulario PDF en blanco continúa disponible en Formularios.

## Uso

1. Elegir **Ingreso manual / paciente externo** o un paciente del censo seleccionado.
2. Completar el formulario en una vista continua y revisar las respuestas clínicas. **Variables** y **Preferencias** permiten consultar el diccionario y ajustar qué campos se muestran.
3. Descargar **PDF editable** para conservar los casilleros rellenables, o **PDF imprimible** para obtener los valores fijados sobre las tres páginas originales.
4. Para continuar en otra sesión, descargar **Guardar borrador** y después recuperarlo con **Cargar**.

El formulario se presenta en una sola vista con siete bloques funcionales: Paciente y vuelo; Diagnóstico y evaluación; Riesgo y autonomía; Asistencia y acompañante; Tratamiento y traslado; Psiquiatría; Médico y declaraciones. El paciente y el vuelo están al inicio, y el médico y las declaraciones al final. En pantallas amplias, los bloques intermedios pueden colocarse en columnas; en pantallas pequeñas continúan uno debajo de otro. No hay navegación entre diez pantallas para completar el formulario.

El esquema técnico y el diccionario conservan las diez secciones originales para ubicar los campos del PDF. [medifFormLayout.ts](../src/features/clinical-library/domain/medifFormLayout.ts) distribuye sus 57 grupos exactamente una vez entre los siete bloques. El PDF exportado conserva sus tres páginas.

Se conservan **137 variables** del PDF: **69 campos de texto** y **68 casilleros de texto para `X`**. Los casilleros se presentan como 31 preguntas de selección exclusiva. Cada pregunta puede quedar sin respuesta. El nombre y la edad se muestran una sola vez en el editor y se copian a sus campos de ambas partes del PDF. El nombre del médico se completa una vez en Datos del médico y se copia a Médico autorizado (página 1) y a la declaración médica (página 3). Las otras preguntas repetidas mantienen respuestas independientes. Las dos preguntas de silla de ruedas se identifican como declaración del pasajero y evaluación del médico.

El [diccionario completo](medif-variables.md) identifica cada variable, su página, tipo y origen. La vista Variables ofrece el mismo inventario y permite localizar el campo en el formulario continuo; los alias de nombre, edad y médico apuntan a su control único. El contador de casilleros con datos es una referencia de llenado: una pregunta Sí/No deja una alternativa vacía, por lo que no representa un porcentaje de validación clínica.

## Datos del censo

[MedifTool](../src/features/clinical-library/components/tools/MedifTool.tsx) obtiene el registro diario ya disponible en `DailyRecordContext`. El [adaptador](../src/features/clinical-library/domain/medifPatientPrefill.ts) construye opciones para camas ocupadas y cunas clínicas; excluye CMA, camas bloqueadas y camas extra inactivas. La lista corresponde a la fecha del censo seleccionado, que puede ser histórica.

Al elegir un paciente se copian hasta cinco campos:

| Dato del censo                   | Variables MEDIF                            | Revisión                                                                                                            |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `record.beds[bedId].patientName` | `p1_nombre_pasajero`, `p2_nombre_paciente` | Confirmar identidad.                                                                                                |
| `record.beds[bedId].age`         | `p1_edad`, `p2_edad`                       | Conserva la unidad escrita. Si falta, usa `birthDate` y la fecha válida del censo para calcular años, meses o días. |
| `record.beds[bedId].pathology`   | `p2_diagnostico_actual`                    | Borrador editable que requiere revisión médica, incluida resolución o alta cuando corresponda.                      |

Para una cuna clínica se aplica el mismo mapeo a `record.beds[bedId].clinicalCrib`. El formulario conserva la copia cargada mientras se edita: las actualizaciones posteriores del censo no reemplazan lo escrito. Elegir otro paciente, volver al ingreso manual o cargar otro borrador solicita reemplazar todos los datos cuando el formulario contiene información.

MEDIF no escribe sobre camas, fichas ni registros diarios. No realiza nuevas búsquedas de pacientes en servicios remotos. El modo manual permite completar los 137 campos sin seleccionar una cama. El género se ingresa manualmente; `biologicalSex` no se transforma en género. Tampoco se equiparan seguro de salud y seguro de viaje, especialidad de hospitalización y especialidad del médico, ni fecha de ingreso y fecha de diagnóstico.

## Preferencias y borradores

Son archivos con propósitos y contenidos diferentes:

| Elemento     | Contenido                                                                                  | Conservación                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferencias | Versión `2` y `hiddenFieldIds`, únicamente identificadores de campos ocultos.              | Se guardan en `localStorage` bajo `hhr.medif.preferences.v1`; se pueden exportar/importar como `medif-preferencias.json`.                                                          |
| Borrador     | Versión `1` y `values`, con los datos escritos en todos los campos, incluidos los ocultos. | Permanece en memoria durante la edición. **Guardar borrador** descarga `medif-borrador.json`; no se guarda automáticamente en almacenamiento del navegador ni en la base de datos. |

La configuración inicial aplica la lista marcada por el usuario: **44 marcas X explícitas se convierten en 46 campos ocultos**, al ocultar todas las alternativas de cada pregunta. La lista marcó solo la opción No en dos preguntas; se agregan sus opciones Sí:

- Nº 077, `p2_instrucciones_si`, junto a Nº 078, `p2_instrucciones_no`.
- Nº 114, `p2_estable_si`, junto a Nº 115, `p2_estable_no`.

Quedan **91 campos PDF visibles**: 41 de texto y 50 casilleros de marca. Nombre y edad tienen dos apariciones PDF pero un solo control de edición cada uno. Los campos ocultos siguen presentes en el esquema y pueden reactivarse en Preferencias. La lista inicial está en [medifDefaultHiddenFields.ts](../src/features/clinical-library/domain/medifDefaultHiddenFields.ts).

En Preferencias, ocultar una alternativa oculta la pregunta completa; nombre y edad también comparten visibilidad entre ambas páginas. **Mostrar todos** restaura la visibilidad. La configuración inicial puede restablecerse desde Preferencias. Si el navegador impide guardar, el editor informa el problema y permite exportar la configuración.

La clave de almacenamiento continúa siendo `hhr.medif.preferences.v1` por compatibilidad, aunque el contenido guardado usa versión `2`. Una configuración antigua v1 guardada en el navegador se migra sumando los campos del preset a los que ya estaban ocultos. Una configuración v2 conserva exactamente la selección guardada, por lo que reactivar campos o mostrar todos no se revierte al recargar. La importación explícita de un archivo v1 o v2 respeta la selección de ese archivo, normaliza los grupos y devuelve v2. Sin configuración guardada válida, se utiliza el preset.

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
