# Integración de PRs en fork/community

Base: main (5134c05). Reanudada el 28 de octubre de 2026 desde 93ca4ee.

## Estado

Las 19 PRs de merge-all-prs.ps1 están integradas. Se ha conservado el historial previo; no se ha reiniciado ni descartado ningún merge.

| PR | Funcionalidad o corrección | Estado |
| --- | --- | --- |
| #1188 | Aviso si falla la creación de notas | Integrada previamente |
| #1221 | Estado y reapertura de vistas Kanban | Integrada previamente |
| #1222 | Fechas y horas fuera del nombre de nota | Integrada previamente |
| #1225 | Navegación desde Outline | Integrada previamente |
| #1226 | Rechazo de títulos vacíos | Integrada previamente |
| #1227 | Conservación del modo Markdown | Integrada previamente |
| #1228 | Validación de carpetas de notas | Integrada previamente |
| #1229 | Evitar navegación al soltar enlaces | Integrada previamente |
| #1216 | Radio de las tarjetas en iOS | Integrada previamente |
| #1206 | Bordes y desplazamiento en móvil | Integrada previamente |
| #1239 | Altura de las listas horizontales | Integrada previamente |
| #1241 | Confirmación al descartar borradores | Integrada previamente |
| #1244 | Títulos CJK en listas plegadas | Integrada previamente |
| #1211 | Inserción entre tarjetas | Integrada previamente |
| #1194 | Traslados entre tableros | Integrada previamente |
| #1238 | Limpieza de etiquetas en nombres de notas | c8856b4 |
| #1210 | Deshacer y rehacer | 50cc627 |
| #1198 | Creación automática de notas enlazadas | 525a9b7 |
| #1223 | Filtro por campos inline | af9deda |

## Resoluciones y decisiones

- Continuar en la rama existente: contiene el merge interrumpido solicitado por el usuario.
- #1238 + #1222: quitar fecha/hora antes de normalizar enlaces y etiquetas; conservar ambos metadatos en la tarjeta. Sustituir toda su primera línea para manejar fechas intercaladas.
- #1210 + #1194: mantener el guardado del origen separado durante un arrastre y registrar ambos tableros como una sola operación.
- #1198 + #1241: conservar la confirmación de borradores. La creación automática respeta su ajuste (la PR original lo ignoraba), valida carpetas y solo incrementa el contador tras crear la nota. La tarjeta enlazada permanece si luego falla la apertura o plantilla.
- Mantener la identidad original obsidian-kanban del manifiesto, en vez de adoptar la identidad del fork de #1198.
- #1223 + #1211: ocultar insertores mientras se filtra; conservar los índices originales en la tabla y aplicar allí también el filtro.
- Revisados los cinco hallazgos del revisor independiente y corregidos: pérdida de tarjetas al fallar un traslado, historial parcial entre tableros, concurrencia de deshacer/rehacer, carpetas de notas automáticas y filtros de tabla.
- Los traslados por menú esperan la escritura del destino, usan Vault.process para serializar escrituras y permiten deshacer/rehacer también con destino cerrado. Si un participante desactiva el historial, no registrar media operación. Los fallos al restaurar un destino revierten las restauraciones ya realizadas.
- Corregir errores de tipos detectados durante validación: declarar la variable app que Obsidian proporciona y comprobar que las rutas de vistas sean cadenas. main tenía 41 diagnósticos de TypeScript con las dependencias instaladas; la integración final pasa typecheck.
- El script de merges ahora reanuda la rama existente, omite PRs ya integradas y se detiene conservando los conflictos. No borra ramas ni hace stash implícito.

## Validación

- Comprobados los 19 ancestros pr/<número> con git merge-base --is-ancestor.
- npm run test:integration: 27 pruebas, 27 correctas. Los nuevos casos de regresión se observaron fallar antes de implementar las correcciones.
- npm run typecheck: correcto.
- npm run build: correcto; genera main.js y styles.css en la raíz.
- git diff --check: correcto.
- Sintaxis PowerShell del script de merges: correcta.
- El lint general no pasa: el checkout Windows contiene CRLF frente a la regla LF y 13 ficheros ajenos a esta integración quedan fuera de tsconfig.json. Estos problemas de configuración se mantienen fuera del alcance de la integración.
- Pendiente de validación manual en Obsidian: arrastre real entre ventanas/tableros, móvil, complementos de plantillas y aspecto visual. Las pruebas de Node ejecutan la lógica real con dobles de la API de Obsidian; no sustituyen esa validación.

Todo queda local en fork/community. No se ha publicado ni instalado en una bóveda de Obsidian.
