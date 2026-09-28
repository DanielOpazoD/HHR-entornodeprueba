# Historial de movimientos: alcance y recuperación

El historial del censo consulta desde el ingreso hasta el día del censo seleccionado.
El botón **Ver historial completo** amplía la consulta a todas las fechas. La búsqueda
global conserva el historial completo, porque su propósito incluye hospitalizaciones
anteriores y el índice de pacientes puede contener sólo parte de ellas.

## Contratos que se deben preservar

- `getPatientMovementHistoryDetailed` distingue `server`, `local` (respaldo tras un
  fallo remoto) y `local-only` (servidor desactivado por configuración).
- Una respuesta vacía del servidor es válida. Los días ausentes o eliminados no se
  vuelven a agregar desde la caché. La consulta tampoco sobrescribe el censo local
  editable ni sus cambios pendientes.
- Tras un fallo, tanto el servidor como el respaldo local usan el mismo rango.
  El modal muestra que la información es parcial y permite reintentar.
- La búsqueda global no guarda respuestas parciales como resultados definitivos.
- Las fechas explícitas se validan antes de leer. El día por defecto corresponde al
  calendario de Rapa Nui; el alta de una hospitalización anterior no cierra un reingreso.
- Un cambio de paciente o de período invalida la respuesta anterior del modal. El
  modo de historial completo no se hereda automáticamente a otro paciente.

## Pruebas y ejecución

Las suites unitarias del servicio y las integraciones de UI cubren las consultas
acotadas, los estados de lectura, fechas inválidas, calendario hospitalario, reintentos
y conservación del acceso a episodios anteriores.

`src/tests/emulator/patient-history-range.emulator.test.ts` ejecuta el servicio real,
los adaptadores de Firestore y almacenamiento local y las reglas del repositorio.
Instrumenta `getDocsFromServer` sin sustituir la consulta ni su respuesta para contar
los documentos que devuelve el emulador.

Escenarios:

1. Archivo sintético de 365 días: consulta de tres días frente a consulta completa,
   comprobando los movimientos y los dos episodios de hospitalización.
2. Día eliminado después de una lectura: la siguiente consulta respeta la ausencia
   del servidor aunque siga disponible en la caché editable.
3. Lectura sin permiso: respaldo local limitado al período y reintento autorizado
   que confirma un resultado remoto vacío.

Ejecutar con Node.js 22 y Java, mediante el lanzador existente:

```bash
npm run test:emulator:sync:ci
```

Este comando levanta Firestore local y ejecuta las suites de sincronización y UI.
Los fixtures usan un proyecto `demo-` y datos sintéticos. No requieren HAR, extensión
cargada ni pacientes reales.

## Límites

El conteo de documentos prueba el alcance de la consulta; no es una medición de
latencia de producción, bytes transferidos ni facturación. El historial completo
continúa leyendo el archivo completo. El emulador no reproduce cortes de red ni
la distribución de la extensión; esos riesgos tienen pruebas separadas en
[recuperación offline](offline-recovery.md).
