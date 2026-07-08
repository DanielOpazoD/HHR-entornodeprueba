# Decisiones Estables del Módulo

## Reglas de arquitectura

- `ClinicalDocumentSheet` no debe incorporar lógica especial nueva por `documentType` o `section.id`.
- Toda sección especializada debe registrarse en `domain/definitions.ts` y resolverse por renderer registrado.
- Toda compatibilidad legacy o migración de shape debe pasar por `clinicalDocumentCompatibilityController.ts`.
- Todo documento o template leído/persistido debe pasar por contratos runtime.

## Reglas de calidad

- Cambios en draft/sync/autosave deben entrar por reducer, use case o controlador puro; evitar lógica nueva repartida entre varios `useEffect`.
- Impresión y exportación deben entrar por servicios/use cases dedicados, no por acceso directo desde componentes.
- Si un cambio añade un nuevo tipo documental, también debe añadir:
  - definición
  - test de integridad del registry
  - test de compatibilidad si cambia `schemaVersion`

## Editor de texto enriquecido (rich text)

- **Panel de formato flotante:** el panel avanzado (`ClinicalDocumentFormattingToolbar`)
  se renderiza con `createPortal` a `document.body` y `position: fixed`, anclado al
  botón "Formato". NO debe depender de un ancestro posicionado. Motivo: el header del
  modal usa `overflow-x: auto`, y el navegador **coerciona `overflow-y: visible` a
  `auto`**, recortando cualquier hijo absolutamente posicionado que caiga por debajo
  del header. Reintroducir el panel como hijo en el flujo normal vuelve a ocultarlo.
  La posición se aplica de forma imperativa (sin estado) para no provocar renders en
  cascada del toolbar mientras se escribe.
- **Sangría:** se aplica con `margin-left` sobre bloques (`div`/`p`/`blockquote`), no con
  `execCommand` para bloques. En listas se usa `execCommand('indent')` y luego
  `normalizeNestedListStructure` repara el anidamiento inválido (`<ol><ol>`) a HTML
  válido (`<li>…<ol>…</ol></li>`). `margin-left` está en la whitelist del sanitizer.
- **Listas obligatorias** (Diagnósticos/Plan): al reconstruir el wrapper `<ol>`/`<ul>`,
  `enforceMandatoryListShape` preserva el HTML inline por línea (negrita/color/enlaces);
  nunca aplanar a texto plano. Los comandos de lista del toolbar deben re-aplicar la
  forma obligatoria (no solo el handler de `input`).
- **Sanitización:** filas/celdas de tabla pegadas sin `<table>` se envuelven antes de
  parsear para que no se pierdan. Todo HTML editor/pegado pasa por el sanitizer con la
  whitelist única de `clinicalDocumentHtmlSanitizer.ts`.

## Checklist de cambio seguro

1. ¿El documento/template nuevo pasa contratos runtime?
2. ¿La definición del `documentType` está registrada y validada?
3. ¿El flujo crítico `crear -> editar -> guardar -> imprimir -> exportar` sigue cubierto?
4. ¿Se agregó test del caso nuevo en `clinical-documents`?
5. ¿La documentación del feature quedó actualizada?
