# Biblioteca independiente de Moa

La mascota sigue siendo opcional, apagada por defecto y ajena a los datos clínicos.
Al activarla, su módulo diferido consulta un catálogo JSON público. No se consulta
al iniciar el censo si Moa permanece oculto. Un botón de biblioteca permite elegir
cualquiera de las escenas sin recorrer cientos de clics. El cierre y Escape conservan
el retorno de foco; la impresión no muestra Moa.

## Publicación inicial

- Repositorio de autoría: `DanielOpazoD/Moa-HHR`, rama `main`.
- Rama de distribución: `moa-catalog`, solo `catalog.json`, `README.md` y `assets/<sha256>.png`.
- URL de origen del catálogo: `https://raw.githubusercontent.com/DanielOpazoD/Moa-HHR/moa-catalog/catalog.json`.
- Primer commit de distribución: `0849337fab0f493d02950b3091afc13078aca3b0`.
- Versión de contenido: `dd97fe7f109874e6137da40b105af4a3810aef9287e7630dad1378beaddfea5c`.
- 222 animaciones, 2634 poses; 70 KB de catálogo y 40.10 MB de atlas en el servidor.
  El cliente NO descarga los 40 MB: únicamente el catálogo y el atlas seleccionado.
- Verificación HTTP, CORS, SHA-256, dimensiones y decodificación de las 222 imágenes:
  [evidencia de publicación](catalog-publication-2026-10-14.json).

La rama de distribución no contiene workflows ni código ejecutable. Una publicación
normal de datos no dispara CI de HHR ni la suite de autoría de Moa. No se han cambiado
protecciones de ramas ni desactivado checks del código de ninguna aplicación.
El cliente consulta `/moa-library/catalog.json` en el mismo origen de HHR. Dos rutas
proxy de Netlify, antes del fallback SPA, sirven únicamente el catálogo y los atlas de
la rama fija. Así se conserva intacta la política CSP: no se agrega ningún dominio a
`connect-src` ni se ejecuta contenido remoto. Vite local no proporciona esas rutas;
las pruebas de navegador las simulan y el despliegue Netlify las sirve realmente.
GitHub Raw sirve aquí archivos públicos estáticos; no se le atribuye SLA de CDN.
Un fallo, límite de servicio o desconexión no bloquea el censo.

## Actualizar animaciones sin PR ni despliegue de HHR

Desde un checkout de HHR con `npm ci` y un checkout de Moa-HHR con las fuentes finales:

```sh
node scripts/moa/publish-catalog.mjs ../Moa-HHR /tmp/moa-export
# Revisar visualmente las escenas nuevas. El comando anterior solo valida y exporta.
node scripts/moa/publish-catalog.mjs ../Moa-HHR /tmp/moa-export --publish
node scripts/moa/verify-published.mjs /tmp/moa-publication-report.json
```

Publicar requiere el acceso Git existente del mantenedor a Moa-HHR y su identidad Git
configurada. El comando no crea ni guarda credenciales. No hay tokens en el cliente.
La exportación valida escenas aprobadas/preservadas, rutas confinadas al checkout,
tiempo finito 3–6 s, PNG decodificable con alfa, geometría, tamaño y hashes disponibles.
Conserva las fuentes editables en el repositorio de autoría; distribuye solo atlas y datos.

El publicador conserva los PNG antiguos, prepara un commit que contiene todas las imágenes
nuevas y el catálogo, y hace un push normal a `moa-catalog`. No usa force-push. Si otro
mantenedor publicó simultáneamente, el push se rechaza: hay que repetir desde la versión
actual, nunca forzar una sobrescritura. El directorio temporal se informa para revisión.
No ejecutar comandos o scripts de una rama de distribución; solo debe contener datos.

El navegador revalida el catálogo al activar Moa y al volver a una pestaña visible, con
un mínimo de 15 minutos entre intentos durante una misma activación. GitHub puede conservar
su copia HTTP unos cinco minutos. Las novedades no requieren recargar/desplegar HHR,
pero no se promete aparición instantánea. La animación en curso conserva su snapshot.

## Volver a una publicación anterior

En un checkout de la rama `moa-catalog`, restaurar SOLO `catalog.json` desde un commit
conocido, crear un nuevo commit y hacer push normal. No eliminar las imágenes antiguas ni
reescribir la historia. El catálogo anterior seguirá encontrando sus archivos por hash.
El cliente acepta ese catálogo validado aunque su versión sea anterior: rollback real.

## Contrato y límites

Schema 1, máximo 1000 entradas y 512 KiB; ID único, texto acotado, 1–64 cuadros,
una duración por pose, 1–8 ciclos, 3–6 segundos totales, cuadro quieto válido,
celdas 288×168 o 576×336, modo pixelado/suave y PNG de hasta 4 MiB.
No se aceptan URLs libres, HTML, JavaScript ni estilos desde el catálogo.
El cliente construye las URLs exclusivamente con el hash bajo el repositorio permitido,
verifica tamaño y SHA antes de crear el blob, y comprueba dimensiones tras decodificar.

No hay precarga masiva ni cambios al service worker. Se reutiliza la caché HTTP del
navegador. La última versión válida del catálogo se conserva como dato en localStorage;
si está corrupta o el almacenamiento está denegado, quedan las 18 escenas locales.
Un error de imagen regresa al retrato local, sin alertas clínicas. Las peticiones tienen
timeout, omiten credenciales y referrer, y no incluyen nombres, RUT, fechas del censo ni
identificadores clínicos. El navegador solicita los archivos a Netlify, que ve la IP de red como en el resto del sitio.

El reproductor admite tiempos distintos por pose y HD suave; usa Web Animations API con
pasos discretos, pausa con pestaña oculta y cuadro quieto con movimiento reducido. Cambiar
escena o cerrar cancela descarga/reloj y revoca el blob; una carga antigua no reemplaza
la nueva selección. La API de animación no disponible produce reposo seguro.

Los cambios del código/reproductor sí mantienen PR y CI completos. Las futuras publicaciones
de contenido solo necesitan validación específica de archivos y revisión visual.
