# Cierre de identidad y catálogo Eloísa → HHR

Base examinada: `663205ce` (#348). Validación local: 6 de septiembre de 2026.

## Contrato

- Descubrir profesionales sin inscripción manual; preservar identidad de origen y rol.
- Unificar sólo alias sustentados por la fuente. No fusionar homónimos ni Enfermería con TENS.
- Publicar el catálogo de forma aditiva y conservarlo después de reintentos y reapertura.
- Una escritura local no equivale a confirmación compartida: un rechazo remoto debe propagarse.
- No reescribir autores/evaluaciones históricas ni aplicar asignaciones de turno durante la prueba.

## Evidencia automatizada

`src/tests/emulator/shared-staff-catalog.emulator.test.ts` ejecuta el parser real de la
extensión, el registro real de HHR, Dexie con IndexedDB simulado y Firestore Emulator
con las reglas del repositorio. No usa Firebase productivo ni datos clínicos reales.

| Escenario                                                                      | Resultado local |
| ------------------------------------------------------------------------------ | --------------- |
| Tres campos de ID de origen → parser → registro → catálogo compartido          | Aprobado        |
| Nombre abreviado y completo con mismo ID; mismo nombre con rol diferente       | Aprobado        |
| Reapertura de almacenamiento y repetición sin cambios de lista ni fecha remota | Aprobado        |
| Lector con almacenamiento vacío recibe catálogo mediante suscripción           | Aprobado        |
| Segundo ID vuelve ambiguo un alias corto; no se fusionan identidades           | Aprobado        |
| Publicación rechazada, conservación local y reintento sin duplicación          | Aprobado        |

Los cinco casos del archivo pasan (incluidos los dos existentes). La suite vigente
`test:emulator:sync:ci` los incluye; no se agrega otro job ni se duplican ejecuciones en CI.
Además pasaron 60 pruebas focalizadas de servicios de funcionarios y cliente de Ficha Médico.

## Comprobaciones en Chrome real

El censo informó 0.48.13 al comenzar. Después de que el usuario recargó la extensión,
HHR confirmó 0.48.14 y disponibilidad de Ficha Médico y Gestión de Camas. La lectura
de Dotación abrió la propuesta, cerrada con **Mantener actual** sin aplicar turnos.

Readback mediante `readEloisaStaff` y `subscribeSharedStaffCatalog`: 49 identidades,
20 de Enfermería y 29 de TENS, cero claves duplicadas y cero entradas con ID de origen.
El catálogo local coincide campo por campo con el compartido. Comparar JSON sin
normalizar produjo inicialmente una diferencia de orden, no una diferencia de datos.

Se repitió la lectura de Dotación y se cerró nuevamente con **Mantener actual**:
los diez selectores de asignaciones permanecieron iguales. Después se recargó la
pestaña HHR de prueba y se abrió otra pestaña normal de Chrome, con la misma sesión.
Ambas conservaron las 49 identidades y mostraron las mismas opciones en los diez
selectores de Enfermería/TENS. Los catálogos local y compartido, antes y después de
la recarga y desde la segunda pestaña, coincidieron al normalizar claves y listas.

### Límite confirmado de la muestra de origen

Se abrió una pestaña limpia de Ficha Médico y su historial, sin editar la ficha.
La respuesta HTTP 200 de `getPatientEncounterHistoryReportServer` contenía 228
eventos; al recorrer las cinco colecciones de actividad utilizadas por el lector,
505 registros tenían rol de Enfermería/TENS. **Ninguno informó**
`authorHealthCarePractitionerId`, `healthCarePractitionerId` o `HCP_ID`.
Esto acredita su ausencia en esa respuesta, no en todo Eloísa ni en otros endpoints.

Por tanto, esta ejecución real verifica el camino sin ID, la repetición, la
persistencia compartida y la concordancia visual entre pestañas. El camino con ID,
el alta de profesionales nuevos y los homónimos se acreditan con datos sintéticos
en las pruebas de integración, no con una incorporación nueva observada en Chrome.
No se inventaron identificadores ni se sustituyó el autor por el usuario de sesión.

### Alcance del cierre

El PR añade regresiones y evidencia, sin modificar código productivo. No se
aplicaron propuestas de turno ni se ejecutaron ediciones de evaluaciones históricas.
No se presenta como verificación real universal de identificadores: para acreditarla
será necesario disponer de una respuesta de origen que efectivamente los incluya.
Si aparece esa muestra, repetir el readback y contrastar el ID del autor con el
catálogo; no introducir una inferencia de identidad para satisfacer la prueba.

Sólo se registran versiones y resultados agregados: no se adjuntan HAR, tokens,
nombres reales ni contenido clínico al PR.
