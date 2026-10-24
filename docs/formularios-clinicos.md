# Formularios clínicos con datos compartidos

En **Documentos → Formularios → Completar**, elegir una cama/cuna clínica o **Ingreso manual**.
El selector de formulario reutiliza los datos comunes del mismo paciente. La fecha de emisión
pertenece a cada documento. Los datos del censo son una propuesta editable; el editor no modifica
el censo ni envía los borradores a un servidor.

| Formulario                        | Controles | Casilleros impresos | Páginas |
| --------------------------------- | --------: | ------------------: | ------: |
| Imagenología                      |        96 |                 108 |       1 |
| Encuesta de contraste             |        28 |                  37 |       1 |
| Consentimiento general            |        10 |                  13 |       1 |
| Laboratorio de policlínico        |        80 |                  87 |       1 |
| VDRL / MHA-TP                     |        28 |                  29 |       1 |
| Serología HDS                     |        17 |                  19 |       1 |
| Tuberculosis MINSAL               |        45 |                  65 |       1 |
| Traslado al Hospital del Salvador |        18 |                  18 |       1 |
| Monitorización ventilatoria       |         3 |                   5 |       2 |

MEDIF conserva sus 137 campos, ruta fija, respuestas habituales y preferencias. Su selección de
pacientes consume ahora la misma proyección canónica, incluido el nombre del médico cuando esté
registrado. La excepción solicitada para mostrar el ingreso en su campo de inicio de enfermedad
se limita a MEDIF; ninguna otra plantilla recibe esa equivalencia.

El editor ajusta la grilla al ancho real del panel. Las listas de exámenes usan columnas
compactas y estables, conservando el orden de teclado; las opciones breves no se distribuyen
por todo el ancho. Los campos largos aprovechan varias columnas. En pantallas táctiles se
conservan áreas de selección mayores.

## Contrato y mapas

- `src/features/clinical-library/domain/forms/clinicalVariables.json`: catálogo de ejecución v1.1.0,
  41 variables comunes con sus rutas de origen, unidades y notas. Amplía el contrato de la skill
  `formularios-clinicos`; no renombra las propiedades persistidas de `PatientData`.
- Los nueve JSON del mismo directorio definen una entrada por variable y una o más posiciones
  impresas. Las variables propias tienen prefijo de formulario. La configuración de impresión
  identifica la plantilla y el documento de origen mediante SHA-256, dimensiones y revisión.
- Las páginas son de base cero; `rect` usa `[x, top, width, height]` en puntos desde la esquina
  superior izquierda. `equals` marca X sólo por igualdad explícita. Sin respuesta no equivale a No.
  Para casilleros con renglones preimpresos, `firstBaseline` fija la primera línea desde arriba
  y `lineHeight` conserva la separación entre renglones; el texto debe caber también entre ellos.
- Las fechas son calendario `YYYY-MM-DD` y se imprimen día/mes/año sin conversión de zona horaria.
  El ingreso, nacimiento, emisión y toma de muestra son conceptos separados. En tuberculosis se
  imprimen M/F/I desde el sexo registrado; en las plantillas con sólo dos casilleros, Indeterminado
  deja ambas alternativas sin marcar.
- Las alternativas excluyentes usan un único control: procedencia, sexo, contraste, lateralidad,
  motivo de estudio y tipo de muestra, entre otras. En laboratorio, grupo de atención y lugar de
  procedencia son controles separados. Ningún examen ni respuesta clínica se selecciona al abrir.

Los siete PDF de origen se conservan sin modificación. Para los dos Word se agregan PDF en blanco
exportados desde los originales con LibreOffice del entorno de trabajo; mantienen el diseño y las
dimensiones. VMI permite completar únicamente nombre y apellidos, RUT y fecha de ingreso, desde
el censo o manualmente. Los registros ventilatorios, resultados, referencias, alarmas y firmas
se imprimen vacíos para completarlos a mano. La segunda página de referencia permanece intacta.
Los borradores VMI anteriores recuperan la identidad del paciente y descartan los valores locales
de observación. No se calculan ajustes ventilatorios, dosis ni metas a partir de la planilla.

## Datos, borradores y preferencias

La proyección usa sólo el registro autorizado que ya está cargado en el programa. Separa cada cama
y cuna clínica, conserva nombres estructurados y unidades de edad y valida el RUT antes de proponerlo.
No divide nombres libres, toma el RUT materno para el recién nacido ni inventa un código CIE-10.
Con tipo de documento desconocido no se propone un RUT. Los formularios rotulados sólo RUT/RUN lo
dejan vacío para pacientes con pasaporte; serología dispone del campo RUT o pasaporte y su selector.

Cambiar de paciente o volver a un formulario manual vacío requiere reemplazar deliberadamente el
borrador previo. Si cambia la cama, identidad, fecha del censo o episodio, la impresión queda
pendiente de revisar el vínculo; se puede elegir el paciente actual o desvincular el borrador para
revisarlo manualmente. Si cambian otros datos de origen, se ofrece conservar los datos revisados o
completar sólo los vacíos. Una respuesta false, un cero o una edición manual no se sobrescriben.

El icono de guardar descarga un borrador del formulario actual con los datos comunes. Importarlo
lo abre como manual y no restablece un vínculo hospitalario a partir del archivo. Los borradores
pueden conservar RUT incompletos para seguir editando; imprimir exige un RUT válido si se incluyó.

El icono de configuración permite ocultar y rehabilitar variables y consultar sus identificadores.
Las preferencias se guardan por formulario/revisión y se pueden exportar/importar. Su archivo
incluye sólo configuración, sin datos del paciente o del médico. Los campos ocultos quedan en
blanco en el PDF y no bloquean su generación; sus valores siguen disponibles en el borrador.

Los números de ficha clínica permanecen siempre vacíos: no aparecen como controles ni pueden
rehabilitarse desde preferencias. La política de salida descarta el valor aunque lo proporcione
un borrador antiguo. `paciente_ficha_numero` se conserva en el catálogo para compatibilidad, pero
no se importa ni se exporta en nuevos borradores. La tabla de controles excluye esos casilleros.

Vista previa, descarga e impresión usan los mismos bytes revisados. Cambiar un dato o preferencia
invalida la vista previa anterior. El generador añade texto sobre el original y rechaza texto que
no cabe a un tamaño legible; no recorta silenciosamente ni cambia la paginación. Las firmas quedan
para el documento impreso. El consentimiento sólo se marca por una acción explícita del usuario.

Una exportación en curso conserva el bloqueo hasta terminar la descarga, también si reutiliza
una vista previa. Cerrar el editor o cambiar su contexto invalida el resultado pendiente, aunque
después vuelva el contexto anterior. La vista previa invalidada libera su URL temporal. Un fallo
permite reintentar con los datos del formulario conservados. MEDIF cancela asimismo la descarga
pendiente al cerrar o modificar su contexto, sin cancelar la carga compartida de la plantilla vacía.

El tamaño preferido del texto insertado sube de 9 a **13,5 puntos** y en MEDIF de 8 a **12 puntos**
(50%). Las X conservan su tamaño y centrado previamente revisados. El ajuste sigue respetando
los espacios reales de la plantilla: un casillero estrecho o con renglones puede requerir un
tamaño menor. Se reservan las alturas necesarias para tildes y descendentes y se rechaza el
contenido que no cabe, sin recortarlo ni superponerlo a otros campos.

## Informe del Salvador en Word

El informe de traslado ofrece **Word (.docx)** junto al PDF. Usa el mismo paciente, datos
manuales y supresiones revisadas; un cambio de origen durante la preparación cancela la descarga.
La generación modifica sólo los párrafos previstos de `word/document.xml` sobre el Word original,
verificado por su SHA-256. Conserva los demás componentes del paquete, logos, numeración, márgenes,
encabezado y pie. Los datos insertados usan 13,5 puntos, interlineado sencillo y alineación izquierda
en sus párrafos; los textos largos pueden ampliar el documento de forma natural en Word.
La plantilla original y el PDF mantienen sus archivos y paginación.

## Verificación

`npx vitest run src/tests/features/clinical-library` cubre las proyecciones, independencia de cuna,
pasaportes/RUT, fechas, cambio de episodio, preservación de ediciones, preferencias sin datos,
supresión, alternativas excluyentes, centrado de las X, caracteres y desbordamientos. Los contratos
PDF contrastan hashes, páginas y conservación de operadores gráficos contra cada archivo real.
La revisión visual con datos sintéticos cubre todas las páginas impresas y el editor en escritorio
y móvil. La impresión física depende del diálogo y la configuración de la impresora del navegador.
