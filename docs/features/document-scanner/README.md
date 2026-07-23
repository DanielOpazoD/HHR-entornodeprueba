# Escáner web de documentos — prueba técnica

Ruta pública de demostración: `/documentos/escanear-demo`.

## Alcance actual

- Se usa directamente desde el navegador del teléfono; no requiere instalar una app.
- Abre la cámara o permite importar una foto existente.
- Detecta y recorta el documento, corrige perspectiva y admite varias páginas.
- Permite revisar la captura y elegir apariencia en color, grises u original.
- Genera un PDF A4 descargable en el mismo dispositivo.
- Limita la detección a 640 px, la fuente a 2000 px y la salida a 2200 px.
- Ejecuta JScanify y OpenCV en un Web Worker para no bloquear la interfaz del teléfono.
- Protege el acceso con el mismo PIN configurado para el enlace QR de Recetas; el valor no se
  incluye en el bundle y conserva el bloqueo de 5 intentos por 15 minutos.
- Reutiliza el selector de cama/paciente servido por Recetas, incluidos activos, altas y traslados.
- Sube las páginas JPEG procesadas; HHR construye un PDF nuevo, solo de imágenes y de hasta 6 MB,
  en `scannedDocumentQueue` como copia temporal.
- Antes de subir, reparte un presupuesto agregado de 4,75 MB entre todas las páginas y ajusta
  progresivamente calidad y resolución; así el flujo de 12 páginas falla temprano y con un mensaje
  claro solo cuando el documento no puede conservar legibilidad dentro del límite seguro.
- Valida también las dimensiones y los píxeles acumulados de las páginas; la cola acepta hasta 30
  reservas por hora y 100 documentos activos por hospital para limitar abuso del PIN compartido.
- Expone la bandeja autenticada `/documentos/pendientes` para abrir el PDF y completar la subida a
  Eloísa.
- Elimina el PDF y sus metadatos clínicos solo después de que un usuario autorizado marque la
  confirmación explícita de que el documento aparece en la ficha correcta de Eloísa.
- Registra primero esa confirmación en un estado de purga reanudable, de modo que una falla entre
  Firestore y Storage no pierda el puntero necesario para terminar la eliminación.
- La primera captura descarga cerca de 9 MB del runtime de OpenCV; las siguientes reutilizan el
  proceso ya inicializado durante la sesión.
- La integración automática con el botón de Gestor documental de Eloísa todavía no está
  implementada; en esta fase el usuario abre el PDF temporal y completa allí la carga.

El procesamiento de la captura se ejecuta localmente con JScanify `1.4.2` y OpenCV.js
`4.7.0-release.1`. Ambos recursos se descargan desde URLs versionadas, se verifican con SHA-384
y recién entonces se entregan al proceso aislado. JScanify tiene licencia MIT: no requiere
licencia comercial, clave por dominio ni cuenta del usuario. OpenCV debe alojarse en
infraestructura de HHR antes de producción.

El build actual de OpenCV requiere ejecución dinámica de Emscripten. Ese permiso queda limitado
al Worker con recursos verificados; el reemplazo alojado por HHR deberá compilarse con ejecución
dinámica deshabilitada para retirar `unsafe-eval` antes de producción clínica.

## Configuración local

Ejecutar `npm run dev` y abrir `http://localhost:5173/documentos/escanear-demo`. No se necesita
configurar una licencia ni una variable de entorno para el escáner.

Para probar también el PIN, las camas y la cola sin desplegar ni escribir en Firebase remoto:

1. Iniciar los servicios aislados con
   `npx firebase emulators:start --project hhr-local-scanner --only auth,functions,firestore,storage`.
2. En otra terminal definir credenciales exclusivamente ficticias y ejecutar la semilla:
   `DOCUMENT_SCANNER_LOCAL_PIN=<PIN-LOCAL> DOCUMENT_SCANNER_LOCAL_QUEUE_EMAIL=<EMAIL-LOCAL> DOCUMENT_SCANNER_LOCAL_QUEUE_PASSWORD=<CLAVE-LOCAL> npm run seed:document-scanner:emulator`.
   La semilla crea únicamente dos pacientes ficticios (H1C1 y H1C2).
3. Iniciar Vite con
   `VITE_FUNCTIONS_EMULATOR_HOST=<IP-DEL-MAC>:5001 VITE_AUTH_EMULATOR_HOST=http://<IP-DEL-MAC>:9099 VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_EMAIL=<EMAIL-LOCAL> VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_PASSWORD=<CLAVE-LOCAL> npm run dev -- --host 0.0.0.0` y abrir desde el
   teléfono `http://<IP-DEL-MAC>:<PUERTO>/documentos/escanear-demo`.

Después de subir, la bandeja HHR local queda disponible en el Mac en
`http://localhost:<PUERTO>/documentos/pendientes-local`. La ruta usa un usuario administrador
ficticio del emulador y no se habilita en builds productivos.

La variable del paso 3 es necesaria porque `localhost` desde el teléfono apunta al propio teléfono.
La configuración del emulador escucha las funciones en la red local, mientras Firestore y Storage
permanecen limitados al Mac. No usar documentos clínicos reales en esta semilla.

## Próximas fases

1. Extender el flujo autenticado de la extensión para adjuntar el PDF en el Gestor documental de
   Eloísa, con confirmación explícita y registro auditable.
2. Incorporar vencimiento automático seguro para documentos que permanezcan pendientes, sin
   confundir vencimiento con confirmación de carga.
3. Reemplazar los recursos CDN por copias alojadas por HHR y realizar la revisión de privacidad
   previa a producción.
