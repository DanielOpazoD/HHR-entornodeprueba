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

## Aceptación parcial en Chrome real

El censo informó 0.48.13 al comenzar. Después de que el usuario recargó la extensión,
HHR confirmó 0.48.14 y disponibilidad de Ficha Médico y Gestión de Camas. La lectura
de Dotación abrió la propuesta, cerrada con **Mantener actual** sin aplicar turnos.

Readback local mediante `readEloisaStaff`: 49 identidades, 20 de Enfermería y 29 de
TENS, cero claves duplicadas y **cero entradas con ID de origen**. Esto no demuestra
que el servidor omita los IDs: queda pendiente contrastar la respuesta original
con la proyección del lector. No se deben inventar IDs para completar la prueba.

La inspección de Chrome fue interrumpida por cambios de ventana. Las pruebas emuladas
**no acreditan** disponibilidad de IDs en las respuestas reales de Eloísa ni
convergencia visual entre pestañas reales. No se acredita tampoco alta real de un
profesional nuevo: el total observado puede corresponder al catálogo ya existente.

1. Mantener versión cargada y lectores vigentes, sin recargar fichas con cambios sin guardar.
2. Leer Dotación y comprobar que el ID viene del autor de cada actividad, no de la sesión.
   Si la fuente no entrega ID, registrar esa limitación: no inventarlo ni inferirlo del nombre.
3. Contrastar catálogo capturado, persistido y mostrado; repetir lectura y recargar HHR.
4. Abrir una segunda pestaña HHR y comparar ambos catálogos y roles.
5. Comprobar que no se aplicaron turnos ni se alteraron evaluaciones históricas.

No marcar el cierre extremo a extremo como aprobado hasta completar estos pasos.
Registrar sólo versiones y resultados agregados; no adjuntar HAR, tokens, nombres reales
ni contenido clínico al PR.
