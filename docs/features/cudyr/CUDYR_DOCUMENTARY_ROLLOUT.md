# Recuperación CUDYR: desplegar la protección antes de activar

El botón diario todavía no produce categorías documentales con este cambio.
Esta primera PR prepara la autoridad clínica existente; la activación del lector
mensual pertenece a una segunda PR.

La carrera sintética reprodujo que el CAS del censo de la noche no detecta un
reingreso con el mismo documento en el día calendario siguiente. La transacción
comprueba ambos días al aceptar una categoría documental. Conserva resultados
aceptados, censos protegidos e identidad de paciente y episodio; no crea censos,
no cambia permisos y no consulta informes mensuales desde el servidor.

El contrato de campos 3 del lote existente exige esta protección al insertar.
Los servidores anteriores lo rechazan antes de escribir. Sin embargo, ese rechazo
no protege por sí solo una categoría ya insertada: el servidor anterior admite
una omisión posterior con el contrato 2. Por ello no se activa el productor en
la misma PR que introduce la protección.

Orden obligatorio:

1. Fusionar esta protección cuando `ci-summary` del SHA final esté en verde.
2. Esperar el despliegue automático de ese `main` por CI. Comprobar el éxito del
   despliegue y de su verificación de `applyRayenClinicalEnrichmentBatch` en
   `southamerica-east1` y `us-central1`; no basta el preview de Netlify.
3. Registrar el SHA y la ejecución comprobada antes de fusionar la segunda PR
   que habilita el lector del botón diario. No activarlo con despliegue fallido,
   incompleto o sin confirmar en ambas regiones.

El rollback seguro deshabilita el productor y conserva la protección del servidor.
No se debe volver al handler anterior después de aceptar categorías documentales:
volvería a permitir que un cliente antiguo las borre. No se borran ni convierten
los resultados o respaldos ya aceptados durante una reversión.

Las pruebas locales usan solo datos sintéticos y el lanzador canónico del emulador.
Cubren guardado y repetición, ambos sentidos de la carrera entre días, contrato
antiguo, rechazo de omisión y actualización adyacente de Braden. No acreditan
un despliegue; el paso 2 se confirma con la ejecución real de CI.
