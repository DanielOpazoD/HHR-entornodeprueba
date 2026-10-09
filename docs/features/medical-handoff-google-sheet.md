# Entrega médica colaborativa en Google Sheets

## Objetivo

Desde **Entrega de turno médica**, HHR puede crear o abrir una planilla diaria para que los
especialistas escriban una entrega libre sin ingresar a la aplicación. La cuenta institucional de
Hospitalizados es propietaria del archivo.

La planilla contiene únicamente:

1. cama;
2. paciente, con la edad entre paréntesis;
3. fecha de ingreso;
4. diagnóstico;
5. especialidad;
6. médico tratante;
7. **Entrega de turno**;
8. **Observaciones**;
9. **Indicaciones médicas**, con un selector **EDF / Especialista**.

Al actualizar una planilla existente, HHR reconoce las columnas por su encabezado. Para el mismo
episodio conserva la **Especialidad**, cualquier corrección manual de **Médico tratante** y los
contenidos de **Entrega de turno**, **Observaciones** e **Indicaciones médicas**. Sólo completa la
especialidad o el médico desde HHR cuando su celda continúa vacía. Si falta una columna oficial,
la recrea; después de rescatar los valores reconocidos, elimina las columnas ajenas al formato
actual. Las indicaciones escritas en versiones anteriores se conservan, aunque no sean una de las
opciones del nuevo selector.

Los editores pueden seleccionar cualquiera de las ocho especialidades de HHR: **Med Interna**,
**Cirugía**, **Traumatología**, **Ginecobstetricia**, **Psiquiatría**, **Pediatría**, **Odontología** y
**Otro**. Las columnas **Especialidad**, **Entrega de turno**, **Observaciones** e **Indicaciones
médicas** son editables. La elección **EDF / Especialista** identifica quién se hace cargo de la
evaluación y validación de las indicaciones; no confirma que esa evaluación ya se haya realizado.

Debajo de la tabla aparece esa explicación y una tabla pequeña de **Nuevos ingresos** con cinco
filas editables y las columnas **Cama**, **Paciente**, **Fecha de ingreso**, **Diagnóstico** y
**Entrega de turno**. Después aparece **Notas compartidas**, con doce líneas libres. Quienes ya
tienen permiso de edición pueden escribir en ambas secciones. Los nuevos ingresos escritos en
la planilla no se incorporan automáticamente al censo de HHR. Al actualizar, se conservan los
ingresos manuales y las notas; ambas secciones se desplazan juntas hacia abajo si crece la tabla
sincronizada. La migración de planillas anteriores inserta la tabla nueva sin borrar sus notas.
El filtro incluye únicamente la tabla sincronizada. No se amplían los permisos de acceso.

HHR no exporta RUT. Un identificador técnico estable queda oculto para reutilizar filas sin borrar
lo escrito por los médicos.

## Flujo

1. Un usuario autorizado abre la entrega médica y pulsa **Crear planilla**.
2. El navegador llama a `openMedicalHandoffSpreadsheet`, un callable autenticado de Firebase.
3. El callable valida rol, fecha y campos permitidos y contacta al Apps Script institucional. El
   secreto nunca llega al navegador.
4. Apps Script crea una planilla para esa fecha o reutiliza la existente.
5. Los datos censales se actualizan, pero las columnas médicas libres se conservan.
6. Google Sheets se abre en una pestaña nueva para los especialistas autorizados.

Si la carpeta guardada en `HHR_HANDOFF_FOLDER_ID` está en la papelera, Apps Script restaura esa misma
carpeta, conservando su ID, permisos y todas las planillas históricas. No busca carpetas por nombre
ni duplica el archivo del día. Las respuestas ambiguas de Drive —timeouts, cuotas o errores de acceso
sin estado verificable— conservan el ID configurado y se informan como reintentables para no
redirigir archivos institucionales silenciosamente.

Si el archivo diario ya registrado no puede abrirse, HHR reintenta y falla de forma segura: no
sobrescribe su identificador ni crea una segunda planilla que pueda ocultar notas existentes.

No existe sincronización inversa: lo escrito en Google Sheets no modifica HHR.

## Configuración institucional (una vez)

### 1. Preparar Drive y Apps Script

1. Iniciar sesión con la cuenta institucional real de Hospitalizados. No usar una cuenta personal
   ni un alias sin Drive propio.
2. Crear un proyecto nuevo en [Google Apps Script](https://script.google.com/).
3. Copiar `integrations/google-apps-script/medical-handoff/Code.gs` al editor.
4. En **Configuración del proyecto → Propiedades del script**, definir:
   - `HHR_HANDOFF_SHARED_SECRET`: valor aleatorio de al menos 24 caracteres;
   - `HHR_HANDOFF_FOLDER_ID`: opcional. Si se omite, el script crea automáticamente una carpeta
     privada `Entrega de turno médicos` en el Drive de la cuenta institucional y guarda allí su ID
     para las ejecuciones siguientes. No reutiliza carpetas sólo por coincidencia de nombre;
   - `HHR_HANDOFF_EDITOR_EMAILS`: correos o Google Groups autorizados, separados por coma.
5. Desplegar como **Aplicación web**:
   - ejecutar como: **yo** (cuenta institucional);
   - acceso: **cualquiera**. El endpoint no entrega archivos y exige el secreto que sólo posee el
     backend autenticado. Las planillas siguen privadas y se comparten exclusivamente con los
     editores configurados.
6. Copiar la URL terminada en `/exec`.

> **Importante:** guardar o fusionar una versión nueva de `Code.gs` no actualiza la aplicación web
> ya desplegada. Después de cada cambio, abrir **Implementar → Administrar implementaciones**, editar
> la aplicación web, seleccionar **Nueva versión** y volver a implementar. Mantener la misma URL
> `/exec` evita tener que cambiar el secreto `MEDICAL_HANDOFF_APPS_SCRIPT_URL` en Firebase.

### 2. Configurar Firebase Functions

Desde una sesión con acceso al proyecto `hhr-pruebas`:

```bash
firebase functions:secrets:set MEDICAL_HANDOFF_APPS_SCRIPT_URL
firebase functions:secrets:set MEDICAL_HANDOFF_SHARED_SECRET
firebase deploy --only functions:openMedicalHandoffSpreadsheet
```

El segundo valor debe coincidir exactamente con `HHR_HANDOFF_SHARED_SECRET` en Apps Script.

### 3. Smoke test

1. Abrir una fecha con pacientes en **Entrega de turno médica**.
2. Pulsar **Crear planilla** y confirmar que abre Google Sheets.
3. Confirmar que el archivo quedó en la carpeta indicada por `HHR_HANDOFF_FOLDER_ID`; si esa
   configuración está ausente, verificar la carpeta privada `Entrega de turno médicos` creada
   automáticamente.
4. Escribir texto de prueba en **Entrega de turno**, **Observaciones**, **Nuevos ingresos** y **Notas compartidas**.
   Seleccionar **EDF** o **Especialista** en **Indicaciones médicas** y una **Especialidad**.
   Corregir temporalmente **Médico tratante** desde la cuenta propietaria.
5. Volver a pulsar **Abrir planilla** y confirmar que:
   - se abre el mismo archivo;
   - los datos censales se actualizan;
   - la especialidad, el médico tratante y la selección EDF / Especialista se conservan;
   - ninguno de los textos de prueba se borra;
   - al agregar pacientes, los nuevos ingresos manuales y las notas quedan debajo de la tabla;
   - cualquier columna oficial faltante se recrea y no quedan columnas ajenas al formato;
   - columnas A–D, F y el identificador oculto J no son editables para un especialista;
   - columnas E, G, H e I y las notas compartidas sí son editables;
   - el archivo no está compartido públicamente.

### Smoke de recuperación posterior al despliegue

Este ejercicio debe realizarse con una fecha de prueba sin información clínica real:

1. Guardar temporalmente en `HHR_HANDOFF_FOLDER_ID` el ID de una carpeta de prueba y enviarla a la
   papelera desde Drive.
2. Pulsar una vez **Crear planilla** desde el censo.
3. Confirmar que la misma solicitud restaura la carpeta original y abre la planilla sin requerir un
   segundo clic ni cambiar `HHR_HANDOFF_FOLDER_ID`.
4. Pulsar nuevamente y comprobar que abre el mismo archivo, sin crear otra carpeta ni borrar el
   texto de **Entrega de turno** ni las **Indicaciones médicas**.
5. Revisar los logs de Firebase Functions: el evento `MEDICAL_HANDOFF_SHEET_EXPORTED` registra sólo
   fecha, cantidad de filas y `storageStatus` (`configured`, `created` o `recovered`). Los fallos usan
   `MEDICAL_HANDOFF_SHEET_EXPORT_FAILED` con un motivo técnico seguro y nunca incluyen pacientes,
   camas, correos, IDs de Drive ni contenido médico.

Los errores que llegan al usuario son deliberadamente acotados: `folder_unavailable` indica que
Drive no pudo preparar la carpeta institucional; `request_rejected` indica que debe revisarse el
secreto o el despliegue de Apps Script; `sheet_update_failed` indica que la planilla diaria existe
pero no pudo actualizarse; `operation_busy` indica que otra solicitud conserva temporalmente el
bloqueo. En todos los casos se puede reintentar sin crear un libro nuevo ni perder notas previas.

## Respaldo PDF

En este primer corte el respaldo es manual: **Archivo → Descargar → PDF**. Al ser un archivo por
fecha, el documento ya queda naturalmente separado para archivo. Una automatización de cierre a
PDF sólo debe agregarse después de validar el flujo colaborativo y definir formalmente horario,
carpeta, responsable y política de retención.

## Límites deliberados

- La hoja no sustituye la ficha clínica ni recibe información de vuelta en HHR.
- No se comparte mediante “cualquiera con el enlace”.
- No se crean formularios ni secciones clínicas estructuradas: la entrega es texto libre.
- Pacientes que ya no estén en el censo no se eliminan de una planilla existente, para no perder
  entregas ya escritas.
