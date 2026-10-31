# PointStream — Decisiones de Diseño

> Creado: Fase 0 (2026-09-17) | Actualizado: Fase 1 (2026-09-17)

## DEC-001: Scraping con BrowserWindow nativo (no Puppeteer)
**Decisión:** Usar BrowserWindow de Electron para scraping en lugar de Puppeteer/Playwright.
**Razón:** Electron ya está como dependencia; agregar Puppeteer duplicaría Chromium (~150MB extra).
**Consecuencia:** El scraping está acoplado al ciclo de vida de Electron; no funciona sin GUI.
**Estado:** MANTENER

## DEC-002: Sesiones persistentes para Cloudflare
**Decisión:** `partition: 'persist:hltv'` y `partition: 'persist:forg1'`
**Razón:** Las cookies de Cloudflare (cf_clearance) se preservan entre sesiones.
**Consecuencia:** El usuario solo necesita pasar Cloudflare una vez.
**Estado:** MANTENER — crítico para el funcionamiento

## DEC-003: User-Agent = Chrome real sin "Electron"
**Decisión:** `app.userAgentFallback` forzado con versión de Chrome real.
**Razón:** HLTV y otros sitios bloquean el UA que incluye "Electron".
**Estado:** MANTENER

## DEC-004: Token Telegram XOR-ofuscado
**Decisión:** Token no en texto plano sino XOR+base64.
**Razón:** Dificulta búsquedas triviales en el repo/bundle.
**Advertencia:** NO es seguridad real. El token puede extraerse del bundle.
**Estado:** MANTENER (aceptable para app de escritorio personal)

## DEC-005: ZERO FAKE DATA
**Decisión:** Si no hay datos, mostrar estado explícito. Nunca inventar ni interpolar.
**Implementación:** `dataQuality: 'none'` cuando no hay datos HLTV.
**Estado:** REGLA PERMANENTE — no negociable

## DEC-006: Monitoreo con setInterval en el proceso main
**Decisión:** El monitoreo corre en el main process, no en un Worker.
**Razón:** Simplicidad; el main process tiene acceso directo a axios y BrowserWindow.
**Consecuencia:** Si el scraping de HLTV o Forg1 tarda, puede bloquear el event loop del main.
**Estado:** ACEPTABLE para el caso de uso (scraping espaciado, no concurrente por diseño)

## DEC-007: Forg1 usa innerText (texto plano)
**Decisión:** Parsear `document.body.innerText` en lugar del DOM.
**Razón:** Forg1 es una SPA que puede cambiar estructura HTML; el texto plano es más estable.
**Consecuencia:** El parser es más complejo (regex, heurísticas). Un cambio de layout del texto puede romperlo.
**Estado:** MANTENER — fue una decisión deliberada tras experimentación

## DEC-008: Frame personalizado (frame: false)
**Decisión:** Ventana sin frame nativo de Windows, barra de título custom en HTML/CSS.
**Razón:** Estética coherente con el diseño de la app.
**Consecuencia:** Los controles de ventana (min/max/close) están implementados en JS/HTML.
**Estado:** MANTENER

## DEC-009: Vinculación Telegram por polling de getUpdates
**Decisión:** En lugar de webhook, usar polling de `getUpdates` para detectar el /start del usuario.
**Razón:** La app de escritorio no tiene servidor expuesto al exterior.
**Consecuencia:** El polling solo ocurre durante la vinculación (no continuo en producción).
**Estado:** MANTENER

## DEC-010: Launcher robusto con `call npm` y verificaciones explícitas (Fase 1)
**Decisión:** Reescribir `start_electron.bat` con: `cd /d "%~dp0"` anclaje, `where node/npm` para verificar presencia, `if not exist node_modules` para instalación condicional, verificación de electron en node_modules, `call npm start` (no `npm start` directamente).
**Razón:** Doble click en Windows puede iniciar con CWD incorrecto. `call` es necesario para capturar correctamente el errorlevel de npm en cmd.exe.
**Consecuencia:** El bat tiene 121 líneas vs 40 originales. Más verboso pero mucho más robusto.
**Estado:** IMPLEMENTADO ✔

## DEC-011: Forg1 Login con UA en Partición, Redirección de Popups y Carga Directa (Fase 2)
**Decisión:**
1. Configurar User-Agent limpio de Chrome explícitamente en la partición `session.fromPartition('persist:forg1')`.
2. Interceptar `setWindowOpenHandler` para evitar que enlaces de login abran ventanas secundarias huérfanas sin partición compartida; redirigir las navegaciones internas de `forg1.com` y `kick.com` a la misma ventana.
3. Apuntar la URL inicial directamente a `https://www.forg1.com/login` para evitar el 307 Redirect innecesario de `https://forg1.com`.
4. Mantener `contextIsolation: true`, `nodeIntegration: false` y `webSecurity: true` inalterados.
**Razón:** `app.userAgentFallback` no aplica a sesiones de partición personalizada en Electron, lo que exponía el token `Electron/28.0.0` ante Cloudflare Turnstile en Forg1. Los popups rompían la coherencia de la cookie `forg1_oauth` entre Kick y Forg1.
**Consecuencia:** El formulario de autenticación con Cloudflare Turnstile carga limpiamente, el token se emite, y el flujo OAuth entre Forg1 y Kick persiste dentro del mismo almacén de cookies `persist:forg1`.
**Estado:** IMPLEMENTADO ✔

## DEC-012: Modelo Jerárquico de Predicciones: Predicción → Mercados → Elecciones (Fase 3)
**Decisión:**
1. No aplanar las preguntas como predicciones independientes. El modelo representa `Prediction -> markets[] -> selections[]`.
2. Consumir directamente el endpoint interno `/api/predictions/state` ejecutado dentro del contexto de la ventana persistente `persist:forg1`.
3. Para la identidad (`predictionSignature`), priorizar el ID estable UUID de Forg1 (`forg1::${pred.id}`) antes que el texto o los nombres de equipos.
4. Mantener compatibilidad retroactiva proveyendo `pred.teams`, `pred.options` y `pred.predType` derivados del mercado principal para que los consumidores existentes (HLTV analyzer, tarjetas clásicas 1v1) sigan funcionando sin cambios invasivos.
5. Permitir cardinalidad dinámica en mercados y opciones sin números prefijados ni datos inventados (Zero Fake Data).
**Razón:** Forg1 utiliza Next.js con un endpoint REST `/api/predictions/state` que retorna la jerarquía real con IDs estables, puntos y apostadores. El scraper de texto anterior aplanaba datos y perdía la relación entre preguntas y elecciones.
**Consecuencia:** Soporte completo de 2, 3, 4+ opciones, múltiples mercados simultáneos, clasificación precisa de tipos, deduplicación estable en monitoreo y renderizado multi-mercado en Telegram y UI.
**Estado:** IMPLEMENTADO ✔

## DEC-013: Fallback Jerárquico de Estadísticas CS2: HLTV (Primary) → BO3.gg (Fallback) (Fase 4)
**Decisión:**
1. Mantener a HLTV como fuente primaria e incorporar a BO3.gg como fallback automático cuando HLTV falla o entrega datos insuficientes (`StatsStatus.INSUFFICIENT` o `FAILED`).
2. Consumir la API REST pública de BO3.gg (`https://api.bo3.gg/api/v1`) mediante solicitudes HTTPS nativas (`node:https`), sin necesidad de abrir instancias de Chromium adicionales ni generar sobrecarga.
3. Desacoplar la capa de obtención de datos mediante un contrato común normalizado (`NormalizedCS2Stats`) y una función pura de scoring matemático (`calculateMatchupScoring`), de modo que `analyzeMatchup()` no conozca detalles específicos del proveedor.
4. Preservar intacta la fórmula matemática existente (pesos, umbrales, bonificaciones y blend 78% datos / 22% base).
5. Incluir trazabilidad de procedencia (`source: 'hltv' | 'bo3gg'`) en el resultado y reflejar la fuente real en la UI (`Estadísticas (HLTV)` o `Estadísticas (BO3.gg)`) y en los mensajes de Telegram.
6. Aplicar la política estricta ZERO FAKE DATA: campos no provistos son `null` (nunca `0` engañosos o estimaciones inventadas).
**Razón:** HLTV sufre frecuentemente de desafíos Cloudflare que requieren interacción manual del usuario. BO3.gg provee datos oficiales de Valve/CS2, rankings mundiales y registros de partidos accesibles por API sin bloqueos, ofreciendo resiliencia inmediata.

## DEC-015: Hardening de Empaquetado, Identidad NSIS y Distribución Segura (Fase 5)
**Decisión:**
1. Resolver ISSUE-002 reconstruyendo `build/generate-installer-art.js` para consumir el imagotipo oficial de alta resolución `assets/icon_hd.png` utilizando `nativeImage` de Electron con filtrado bicúbico de alta calidad, generando bitmaps `BI_RGB` de 24 bits (`installerSidebar.bmp` y `installerHeader.bmp`) alineados con la identidad visual corporativa (#53FC18 sobre fondo oscuro #0b0e0f).
2. Estandarizar nombres de binarios en Windows: ejecutable principal `PointStream.exe` e instalador `PointStream-1.2.0-Setup.exe`.
3. Activar explícitamente `"asar": true` y optimizar la lista de archivos empaquetados excluyendo `assets/icon_hd.png` (860KB) y `assets/screenshots/**/*`, logrando un bundle `app.asar` limpio de 2.4 MB con solo archivos de producción.
4. Establecer `deleteAppDataOnUninstall: false` para salvaguardar la sesión de Forg1 y la configuración de Telegram ante desinstalaciones accidentales o actualizaciones.
5. Política estricta de firma y SmartScreen: no generar certificados autofirmados engañosos en producción. Documentar con total transparencia el estado `NotSigned` cuando no exista credencial en el almacén de certificados ni en variables de entorno, y no implementar ningún mecanismo de evasión de antivirus o manipulación de Defender.
**Razón:** Proveer una experiencia de instalación profesional, segura y coherente con la identidad visual de PointStream sin sobrecargar el bundle ni alterar la lógica funcional.
**Estado:** IMPLEMENTADO ✔

## DEC-014: Semántica de Ciclo de Vida de Predicciones Forg1 (Fase 4.1)
**Decisión:**
1. Mapear formalmente el ciclo de vida a cuatro estados canónicos: `OPEN`, `WAITING_RESULT`, `RESOLVED` y `UNKNOWN`.
2. Tratar las predicciones cerradas (`"Esperando ganador"`, `"Predicción cerrada. Esperando resultado"`, `locked`, `closed`, o con `locksAt` en el pasado) como `WAITING_RESULT`.
3. Establecer inequívocamente que `CLOSED != RESOLVED`: una predicción en `WAITING_RESULT` no admite apuestas ni genera nuevas alertas de recomendación, pero tampoco infiere un ganador anticipado (`result = null`).
4. Solo clasificar como `RESOLVED` cuando Forg1 declare un estado finalizado oficial (`resolved`, `finished`, `completed`, `winning_outcome_id`). Extraer el ganador oficial únicamente si está explícito.
5. Clasificar cualquier estado ambiguo o no reconocido como `UNKNOWN` (Zero Fake Data: nunca asumir abierto ni resuelto).
6. Preservar la identidad estable `forg1::<id>` a través de todas las transiciones para evitar duplicados en memoria o falsas alertas al cambiar de estado.
**Razón:** La observación funcional en Forg1 demostró que los estados de bloqueo ("Esperando ganador") eran leídos como predicciones abiertas o generaban duplicación al cerrarse, confundiéndose con eventos apostables o forzando adivinaciones de resultados.
**Consecuencia:** Monitoreo limpio y predecible, badges claros en UI, mensajes apropiados en Telegram y cero inferencias falsas de ganadores.
## DEC-016: Extracción Estructurada y Filtrado de Identidad para H2H en HLTV (Fase 6)
**Decisión:**
1. Reemplazar la extracción sobre `innerText` y regex global en `getH2H()` por un extractor DOM estructurado inyectado vía `extractorBody` en `fetchHLTV`.
2. Extraer selectores específicos de HLTV: `.result-con`, `a[href*="/matches/"]` (para `matchId`), `.team` (para nombres), `.result-score` (para scores) y `.event-name` / `.event` (para evento).
3. Implementar la función pura `parseH2HMatches(rawMatches, team1Name, team2Name)` encargada de normalizar nombres (`normKey(normalizeTeamName(...))`) y validar la identidad estricta de ambos equipos.
4. Descartar completamente cualquier partido donde participe un tercer rival ajeno (solucionando el comportamiento de HLTV donde `?team=A&team=B` lista partidos de A contra terceros y B contra terceros).
5. Manejar simétricamente la inversión de equipos (`team1 vs team2` y `team2 vs team1`), orientando el puntaje al contendiente adecuado sin importar el orden local/visitante.
6. Deduplicar partidos por `matchId` para neutralizar elementos responsive repetidos en el DOM de HLTV.
7. Distinguir el estado `EMPTY` (0 partidos directos encontrados) de `FAILED` (error de red o Cloudflare), preservando 100% el contrato `{ total, team1Wins, team2Wins }` y la matemática de scoring (+4 pts por victoria) en `cs2-stats-service.js`.
**Razón:** Eliminar falsos positivos masivos provocados por la captura indiscriminada de partidos de terceros y fechas, garantizando Zero Fake Data en el cálculo de estadísticas de CS2.
## DEC-017: Persistencia de Configuración Local y Recuperación de Estado (Fase 7)
**Decisión:**
1. Crear el módulo `electron/config-store.js` responsable de la persistencia de configuración del usuario en `app.getPath('userData')/config.json`.
2. Emplear un esquema con versión explícita (`version: 1`), conteniendo `streamers` (array de strings) y `config` (`platform`, `interval`, `autoOpen`, `notifications`, `minimize`).
3. Aplicar escritura atómica (archivo temporal `.tmp` + rename / reemplazo) para evitar archivos a medio escribir o corruptos ante cierres abruptos de la aplicación.
4. Implementar recuperación ante fallos: si `config.json` se encuentra corrupto, se genera automáticamente una copia diagnóstica `config.json.bak` y se cargan los defaults seguros sin crashear el proceso.
5. Mantener la frontera de seguridad IPC (`config-get`, `config-save`, `config-reset`) a través de `preload.js` (`window.configAPI`), con el proceso principal como único custodio de las operaciones de filesystem (`contextIsolation: true`, `nodeIntegration: false`).
6. Validación estricta y sanitización de tipos: descartar prototype pollution (`__proto__`, `constructor`), limitar a 100 streamers con caracteres válidos y clampear intervalos entre 30 y 300 segundos.
7. Cero persistencia de secretos: se prohíbe explícitamente almacenar contraseñas, tokens de Telegram, cookies de sesión de Kick/Forg1/HLTV o estados temporales de runtime (`isMonitoring` permanece `false` al iniciar para prevenir ejecuciones sorpresa).
**Razón:** Resolver ISSUE-005 permitiendo al usuario conservar sus streamers y preferencias entre sesiones, con máxima robustez, cero pérdida de datos y respeto a la arquitectura de seguridad existente.
## DEC-018: Series Identity Is Independent From Prediction Identity (Fase 9.1)
**Decisión:**
1. Separar estrictamente `predictionId` (`forg1::<id>`) de `mapSignature` (`${seriesId}_map_${mapNumber}`) y `seriesId` (`${teamA}_vs_${teamB}_${date}`).
2. Cerrar una predicción (`PredictionStatus.WAITING_RESULT` o cierre en Forg1) NUNCA finaliza la serie. La serie transiciona a `WAITING_NEXT_MAP` y solo finaliza (`SERIES_STATUS.FINISHED`) cuando existe evidencia matemática de que se alcanzó el objetivo del formato (ej. 2 victorias en BO3, 3 en BO5, 1 en BO1).
3. Modificar la lógica de cooldown en `electron/main.js` (`recentlyClosed`): el cooldown de una predicción cerrada opera únicamente sobre la identidad de esa predicción específica, impidiendo que bloquee el inicio del Mapa 2 de la misma serie.
4. Establecer `electron/series-tracker.js` como módulo responsable de mantener la continuidad deportiva en memoria de ejecución (runtime), purgando series finalizadas tras 30 minutos de retención.
5. Política estricta ZERO FAKE DATA: Si una predicción no presenta dos equipos válidos, `seriesId = null`. Si el formato no está explícito, permanece `UNKNOWN`. Si el número de mapa no está explícito, permanece `null`. Prohibido inventar ganadores o scores.
**Razón:** Resolver el bloqueo entre mapas en series BO3/BO5, evitando que PointStream descarte la predicción del Mapa 2 o pierda el marcador y contexto acumulado de la serie.
**Estado:** IMPLEMENTADO ✔


