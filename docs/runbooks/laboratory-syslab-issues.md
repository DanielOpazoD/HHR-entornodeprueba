# Runbook: Laboratorio / Syslab Issues

## Arquitectura

Flujo principal en HHR:

```text
HHR → content-hhr-syslab → extensión Eloísa → sesión Syslab de la LAN (10.4.69.90)
```

La extensión conserva la sesión institucional, valida el RUN devuelto por Syslab y entrega a HHR
solo localizadores de lote opacos con caducidad. Las rutas internas de informes no se exponen a la
aplicación.

El proxy Express/Netlify anterior queda como compatibilidad opcional y solo se usa cuando
`VITE_SYSLAB_API_URL` o `SYSLAB_PROXY_URL` está configurado explícitamente. La aplicación HHR en
`localhost:3000` no es un proxy Syslab.

La búsqueda por RUT externo no incluye un episodio Eloísa que la extensión pueda autorizar. En
Netlify conserva el fallback web; en Vite local requiere `VITE_SYSLAB_API_URL` explícita. Sin esa
configuración, HHR informa cómo habilitar el acceso y no realiza una consulta ambigua.

### Límite de confianza de localhost

La extensión ya habilita su puente clínico de desarrollo para HHR local. El relay Syslab restringe
ese caso al origen exacto `http://localhost:3000`; el runtime vuelve a validar episodio activo, RUN,
lote, pertenencia de cada informe y caducidad. Esto permite probar el flujo real sin exponer rutas o
credenciales Syslab a HHR.

Un proceso local ajeno que controle ese mismo puerto comparte el límite de confianza histórico del
puente HHR. Endurecer de forma común todos los bridges locales requiere una autorización verificable
por la extensión y debe abordarse como PR de seguridad independiente; un nonce visible para la misma
página no resolvería el riesgo. En producción sólo se acepta `https://testinghhr.netlify.app`.

## Seguimiento de inicio de sesión

Mientras el panel espera el acceso a Syslab, comprueba el estado cada dos segundos
solo con HHR visible. Una pestaña oculta pausa ese seguimiento; al volver a ella
se comprueba inmediatamente. El chequeo inicial, el refresco manual y una petición
ya en curso mantienen su comportamiento. Cerrar el panel o completar la sesión
retira el intervalo y el listener de visibilidad; no debe iniciar más consultas.

## Síntomas comunes

### "Failed to fetch" al buscar exámenes

**Flujo principal**: confirma que la extensión esté activa, recarga HHR y conecta Syslab desde el
módulo Laboratorio de la extensión en Eloísa.

**Fallback heredado**: si se configuró deliberadamente un proxy Express, confirma que esté activo:

```bash
cd /path/to/API-laboratorioHHR
node server.js
```

Verificar: `curl "${VITE_SYSLAB_API_URL}/api/exams?rut=12345678"`

### "Error interno al procesar el scraping"

**Causa**: Playwright no puede conectar a Syslab (10.4.69.90).

1. Verificar que estás en la red del hospital
2. Probar: `ping 10.4.69.90`
3. Si el portal cambió de URL, actualizar `config/env.js`

### `Unexpected token '<'` o `<!DOCTYPE ... is not valid JSON`

Una página HTML fue interpretada como respuesta del API. Antes ocurría cuando HHR usaba por defecto
`http://localhost:3000`, es decir, consultaba al propio Vite y recibía `index.html`.

El cliente actual ya no asume ese proxy: prioriza la extensión y clasifica HTML, redirecciones de
login, sesión ausente y red no disponible con mensajes accionables. No restaures el fallback
implícito a `localhost:3000`.

### Exámenes vacíos (0 resultados)

**Causa**: El RUT no tiene exámenes o el formato es incorrecto.

- Syslab requiere RUT sin puntos, sin guión, sin dígito verificador
- El sistema limpia automáticamente: "12.345.678-9" → "12345678"
- Verificar directamente en http://10.4.69.90/syslab/

### Selección grande, progreso detenido o respuesta incompleta

HHR analiza la selección en solicitudes secuenciales de hasta tres informes. El puente
mantiene su límite de 24 por solicitud. La descarga de PDF combinados conserva su
límite independiente de 24; no confundir descarga con análisis.

- «Informes leídos: X de Y» cuenta respuestas validadas, no tiempo transcurrido.
- Si el lote caducó, actualizar la búsqueda; no mezclar enlaces de búsquedas distintas.
- Un lote incompleto o con errores no se guarda ni se dibuja como resultado completo.
- Cerrar el análisis o cambiar de paciente detiene los lotes siguientes; la petición
  ya enviada puede finalizar en la extensión.
- Para soporte, registrar cantidad seleccionada, etapa y mensaje, sin copiar documentos
  ni datos clínicos a logs o revisores externos.

### Parser no reconoce variables

Distinguir el recorrido antes de cambiar una expresión regular:

1. Extensión: `extension/syslab-bridge.js` extrae texto/valida RUN y
   `extension/lab-result-parser.js` interpreta filas. `extension/lab-viewer.js`
   valida el lote y construye la respuesta.
2. HHR: `src/features/laboratory/controllers/` normaliza nombres, números, muestras,
   comparación y tendencias. Los servicios de microbiología/orina aportan
   enriquecimientos opcionales en la ruta heredada.
3. Proxy Express heredado: su parser pertenece a otro repositorio; comprobar primero
   que esa sea la ruta realmente configurada.

Reproducir con un informe sintético y conservar el texto original, unidad, muestra y
rango. Ejecutar `labParserParity.test.ts` y `labClinicalParsingRegression.test.ts`.
Una curva ausente no prueba ausencia de examen: revisar también Comparación y
Microbiología. Un resultado cualitativo o con comparador como «<» no debe convertirse
en una medición numérica exacta.

### Curvas amontonadas o escala aparentemente plana

`labTrendChartModel.ts` prepara dominio y filas sin redondear mediciones. Las series
densas omiten etiquetas permanentes, conservan todos los puntos y muestran el detalle
al pasar sobre ellos. Los gráficos separan unidades; una banda de referencia común
solo se muestra cuando todos los rangos coinciden. El eje horizontal sigue siendo
categórico por orden: no representa distancia temporal proporcional.

### PDF no se ve en el visor

**Causa**: El link del examen está malformado o la sesión expiró.

1. En el flujo principal, comprueba que la sesión Syslab de la extensión siga activa.
2. Actualiza la búsqueda: los lotes de la extensión caducan para proteger al paciente.
3. En el fallback heredado, comprueba que el proxy siga configurado y disponible.

## Variables de entorno

- `VITE_SYSLAB_API_URL` — URL explícita del proxy Express heredado (sin valor por defecto)
- `SYSLAB_BASE_URL` — URL de Syslab en el Express server (default: `http://10.4.69.90/syslab/`)
- `SYSLAB_USER` / `SYSLAB_PASS` — Credenciales de Syslab

## Informe que detiene una selección (0.48.56)

El error identifica la orden y su fecha cuando están disponibles. Distingue un RUN
leído distinto del solicitado de un encabezado ausente, ilegible o contradictorio.
Una sesión vencida tiene su propio mensaje. No concluir que pertenece a otra persona
cuando no se pudo leer la identidad. Abrir la orden indicada en Syslab y contrastar
el encabezado original; un informe pendiente puede no incluir resultados ni identidad.
No sustituir la identidad del documento por el RUT de búsqueda, el nombre o el enlace.
No publicar ni guardar una selección parcial como completa; corregir la fuente o
seleccionar explícitamente otros informes, manteniendo visible el motivo del bloqueo.

Las unidades eliminan únicamente separadores de columna `|` en sus extremos. No hay
conversión de unidades o valores; mg/L sigue separado de mg/dL. HHR también normaliza
la presentación de resultados previos sin reescribir su fuente. Los ejes muestran
mes/año (mayo de 2026: 5/26), una marca por mes; el tooltip conserva fecha, hora y valor.
Las posiciones siguen siendo categóricas: no representan intervalos de tiempo iguales.

Validar parser, puente real con fixtures sintéticos (RUN correcto, ausente, distinto,
documento mixto y sesión vencida), agrupación de unidades, ejes y etiquetas. Requiere
actualizar la extensión instalada para recibir el diagnóstico por informe. Un merge
de HHR o una prueba sintética no acredita que un PDF real problemático esté resuelto.

### Presupuesto de tamaño de la corrección 0.48.56

Se registra explícitamente el crecimiento acotado de cuatro módulos existentes: parser +2 líneas (cabeceras múltiples), bridge +14 (diagnóstico de identidad, informe sin validación y contexto del informe), PDF bundle +1 y runtime +2 (fecha del informe). Se conservan todos los límites de complejidad. Estas responsabilidades pertenecen a esos módulos; no se crea una capa adicional ni se comprime código para eludir el control. El ratchet vuelve a aplicar sobre estos tamaños revisados.

Syslab puede responder con un aviso HTML «No hay exámenes validados» en lugar de un informe. La extensión reconoce esa respuesta explícita como una orden sin resultados disponibles y la omite sin alerta. Las demás órdenes siguen cargando. Cada orden solicitada debe quedar contabilizada exactamente una vez: informe con identidad verificada u omisión explícita. Las omisiones no generan columnas ni se guardan como resultados. Una respuesta ausente, ilegible o de otro paciente sigue bloqueando el lote. No se interpreta como un paciente distinto ni se importa contenido sin identidad verificada.
