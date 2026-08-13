# Entrega médica colaborativa en Google Sheets

## Objetivo

Desde **Entrega de turno médica**, HHR puede crear o abrir una planilla diaria para que los
especialistas escriban una entrega libre sin ingresar a la aplicación. La cuenta institucional de
Hospitalizados es propietaria del archivo.

La planilla contiene únicamente:

1. cama;
2. paciente;
3. edad;
4. diagnóstico;
5. especialidad;
6. médico tratante;
7. **Entrega de turno**, única columna editable.

HHR no exporta RUT. Un identificador técnico estable queda oculto para reutilizar filas sin borrar
lo escrito por los médicos.

## Flujo

1. Un usuario autorizado abre la entrega médica y pulsa **Crear planilla**.
2. El navegador llama a `openMedicalHandoffSpreadsheet`, un callable autenticado de Firebase.
3. El callable valida rol, fecha y campos permitidos y contacta al Apps Script institucional. El
   secreto nunca llega al navegador.
4. Apps Script crea una planilla para esa fecha o reutiliza la existente.
5. Los datos censales se actualizan, pero la columna libre se conserva.
6. Google Sheets se abre en una pestaña nueva para los especialistas autorizados.

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
4. Escribir texto de prueba en **Entrega de turno**.
5. Volver a pulsar **Abrir planilla** y confirmar que:
   - se abre el mismo archivo;
   - los datos censales se actualizan;
   - el texto de prueba no se borra;
   - columnas A–F no son editables para un especialista;
   - el archivo no está compartido públicamente.

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
