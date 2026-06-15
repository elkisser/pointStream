<div align="center">

<img src="assets/icon.png" width="120" alt="pointStream" />

# pointStream

**Monitor de streams en vivo de [Kick](https://kick.com) y [Twitch](https://twitch.tv) + predicciones de CS2**

Vigila a tus streamers favoritos y las predicciones de [Forg1](https://forg1.com): te avisa cuando alguien se pone en vivo y cuando se abre una nueva predicción, con una recomendación basada en estadísticas reales de [HLTV](https://www.hltv.org).

[![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white)](#-instalación)
[![License](https://img.shields.io/badge/License-MIT-53FC18.svg)](LICENSE)

</div>

---

## 📑 Tabla de contenidos

- [¿Qué es?](#-qué-es)
- [Características](#-características)
- [Capturas](#-capturas)
- [Instalación](#-instalación)
- [Cómo se usa](#-cómo-se-usa)
- [Predicciones CS2](#-predicciones-cs2)
- [Cómo funciona](#-cómo-funciona)
- [Compilar el instalador](#-compilar-el-instalador)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Tecnologías](#-tecnologías)
- [Licencia](#-licencia)

---

## 🎮 ¿Qué es?

**pointStream** es una aplicación de escritorio para Windows con dos funciones:

- **Monitor de streams**: vigila en segundo plano a los streamers que elijas en **Kick** o
  **Twitch** y, cuando se ponen **en vivo**, te avisa con una notificación y abre su canal en
  **Brave** (o tu navegador por defecto). Podés alternar entre las dos plataformas con un switch,
  y la interfaz cambia sus colores a los de la plataforma activa (verde para Kick, violeta para Twitch).
- **Predicciones CS2**: escanea las predicciones abiertas en **Forg1**, analiza a los equipos con
  datos de **HLTV** (ranking mundial, forma reciente, forma en la competencia que están jugando e
  historial directo) y te da una recomendación. Además puede avisarte con una notificación cada vez
  que se abre una predicción nueva.

---

## ✨ Características

| | |
|---|---|
| �🟣 **Kick y Twitch** | Switch de plataforma con tema de color propio para cada una |
| �🔍 **Monitoreo en tiempo real** | Consulta el estado de varios streamers en cada ciclo |
| 🚀 **Apertura automática** | Abre el stream en Brave apenas empieza (sin reabrir si ya estaba abierto) |
| 🔔 **Notificaciones** | Aviso de escritorio cuando un streamer entra en vivo |
| 🖼️ **Vista previa** | Miniatura del directo, avatar, título, categoría y espectadores |
| ⚙️ **Configurable** | Intervalo de verificación ajustable (30–300 s) y opciones por casilla |
| 📊 **Estadísticas** | Tiempo monitoreando, streams detectados y cuántos están en vivo |
| 📝 **Log de actividad** | Registro de todo lo que va detectando la app |
| � **Predicciones CS2** | Escaneo de Forg1 + análisis con datos de HLTV y alertas de predicción nueva |
| 🪟 **Barra de título propia** | Controles de ventana (minimizar, maximizar, cerrar) integrados al diseño |

---

## 📸 Capturas

### Monitor — tema Kick
<img src="assets/screenshots/monitor-kick.png" alt="Monitor con tema Kick" width="100%" />

### Monitor — tema Twitch
La interfaz cambia a los colores de Twitch al seleccionar la plataforma.

<img src="assets/screenshots/monitor-twitch.png" alt="Monitor con tema Twitch" width="100%" />

### Predicciones CS2
<img src="assets/screenshots/predicciones.png" alt="Panel de predicciones CS2" width="100%" />

---

## 📥 Instalación

### Opción A — Instalador (recomendado para usuarios)

1. Descargá el archivo **`pointStream-Setup-1.0.0.exe`** desde la sección de
   [Releases](https://github.com/elkisser/pointStream/releases).
2. Ejecutalo y seguí el asistente (podés elegir la carpeta de instalación).
3. Se crea un acceso directo en el **Escritorio** y en el **Menú Inicio**.
4. Abrí la app y empezá a monitorear.

> ℹ️ Al ser un ejecutable sin firma digital, la primera vez Windows SmartScreen puede mostrar
> *"Windows protegió tu PC"*. Hacé clic en **Más información → Ejecutar de todas formas**.

### Opción B — Desde el código fuente (para desarrolladores)

```bash
# 1. Cloná el repositorio
git clone https://github.com/elkisser/pointStream.git
cd pointStream

# 2. Instalá las dependencias
npm install

# 3. Iniciá la aplicación
npm start
```

> En Windows también podés hacer doble clic en **`start_electron.bat`**, que instala
> las dependencias (si faltan) y abre la app automáticamente.

---

## 🕹️ Cómo se usa

1. **Elegí la plataforma**: usá el switch **Kick / Twitch** arriba de la configuración. Los colores
   de la app se adaptan a la plataforma elegida.
2. **Agregá streamers**: escribí el nombre de usuario en el campo y pulsá **Agregar** (o Enter).
   Podés eliminar cualquiera con el botón ✕.
3. **Ajustá el intervalo**: con el deslizador elegís cada cuántos segundos se verifica (30–300 s).
4. **Elegí tus opciones**:
   - *Abrir automáticamente en Brave* — abre el canal cuando empieza el directo.
   - *Notificaciones de escritorio* — aviso del sistema al detectar un live.
   - *Minimizar al abrir stream*.
5. **Iniciá el monitor** con el botón verde. El indicador del encabezado pasará a *Monitoreando…*.
6. Las tarjetas muestran el estado de cada streamer. Hacé clic en una para abrir su canal.

> El cambio de plataforma está deshabilitado mientras el monitor está corriendo: detené el monitor
> para alternar entre Kick y Twitch.

---

## 🎯 Predicciones CS2

Desde la pestaña **Predicciones CS2**:

- **Escanear Forg1**: detecta las predicciones abiertas y, para las que enfrentan a dos equipos,
  busca sus estadísticas en HLTV y muestra una recomendación.
- **Monitorear**: revisa Forg1 periódicamente y te avisa con una notificación cuando aparece una
  predicción nueva.
- **Login Forg1**: abre una ventana para iniciar sesión en Forg1 (necesario para ver las predicciones).
- **Conectar HLTV**: abre HLTV en una ventana visible para pasar la verificación de Cloudflare una vez;
  después las consultas de estadísticas funcionan en segundo plano.
- **Análisis manual**: ingresá dos equipos a mano para obtener el mismo análisis sin depender de Forg1.

El análisis combina varios factores de HLTV para llegar a la recomendación:

- 📊 **Ranking mundial** de cada equipo.
- 📈 **Forma reciente** (victorias y derrotas en los últimos resultados).
- 🏆 **Forma en la competencia actual** que están jugando; si es su primer partido en ese evento,
  usa la competencia más reciente con datos para tener una estadística más representativa.
- ⚔️ **Historial directo** (head-to-head) entre ambos equipos.

Con eso arma una probabilidad para cada lado, una recomendación y un nivel de confianza.

> ⚠️ Es una herramienta de apoyo basada en datos históricos. No garantiza resultados: apostá con responsabilidad.

---

## ⚙️ Cómo funciona

```
┌──────────────┐     cada X segundos      ┌──────────────────────┐     HTTPS     ┌──────────────────┐
│   Interfaz   │ ───────────────────────▶ │   Proceso principal   │ ───────────▶ │  Kick API v2      │
│  (Electron)  │ ◀─────────────────────── │      (Electron)       │ ◀─────────── │  Twitch GraphQL   │
└──────────────┘   actualización estado   └───────────┬──────────┘               └──────────────────┘
                                                       │ scraping en ventana oculta
                                                       ▼
                                          ┌──────────────────────┐
                                          │   Forg1  +  HLTV       │
                                          └──────────────────────┘
```

- **Streams**: el proceso principal consulta la **API v2 de Kick** o el endpoint **GraphQL público
  de Twitch** según la plataforma activa. Si un streamer pasa de *offline* a *en vivo*, dispara la
  **notificación** y, si está activado, abre el canal en **Brave** una sola vez por sesión en vivo.
  Los datos (título, miniatura, categoría, espectadores) se envían a la interfaz, que actualiza las
  tarjetas en tiempo real.
- **Predicciones**: las predicciones de Forg1 y las estadísticas de HLTV se obtienen mediante
  *scraping* en ventanas ocultas de Electron. Para acelerar, se cachean el ranking mundial y los
  resultados por equipo, y las consultas se hacen en paralelo.

---

## 🏗️ Compilar el instalador

El proyecto usa [electron-builder](https://www.electron.build/) para generar el `.exe`.

```bash
# Genera el icono, el arte del instalador y construye el instalador NSIS en dist/
npm run dist
```

El instalador quedará en **`dist/pointStream-Setup-1.0.0.exe`**.

```bash
# Solo empaquetar sin crear instalador (para pruebas)
npm run pack

# Regenerar únicamente el icono / el arte del instalador
npm run icon
npm run art

# Regenerar las capturas de pantalla del README
npm run screenshots
```

> 🛠️ **Si el build falla al extraer `winCodeSign`** con un error de *symbolic link*: es un problema
> de permisos de Windows (7-Zip no puede crear symlinks de librerías de macOS que ni se usan en
> Windows). Se soluciona activando el **Modo de desarrollador** de Windows o ejecutando la terminal
> **como administrador** antes de `npm run dist`.

---

## 📂 Estructura del proyecto

```
pointStream/
├── electron/
│   ├── main.js                  # Proceso principal: streams (Kick/Twitch), monitoreo,
│   │                            #   predicciones, notificaciones y controles de ventana
│   ├── preload.js               # Puente seguro entre interfaz y backend
│   ├── forg1-scraper.js         # Scraper de predicciones de Forg1
│   └── hltv.js                  # Resolución de equipos y análisis estadístico en HLTV
├── ui/
│   ├── index.html               # Estructura de la interfaz
│   ├── styles.css               # Estilos (tema oscuro + temas Kick/Twitch)
│   ├── app.js                   # Lógica del monitor y la barra de título
│   └── predictions.js           # Lógica del panel de predicciones
├── build/
│   ├── generate-icon.js         # Generador del icono de la app
│   ├── generate-installer-art.js# Generador del arte del instalador (BMP)
│   ├── capture-screenshots.js   # Captura de screenshots para el README
│   └── icon.ico                 # Icono para el instalador
├── assets/
│   ├── icon.png                 # Icono de la ventana
│   └── screenshots/             # Capturas usadas en este README
├── start_electron.bat           # Arranque rápido en Windows
└── package.json
```

---

## 🧰 Tecnologías

- **[Electron](https://www.electronjs.org/) 28** — aplicación de escritorio
- **[Axios](https://axios-http.com/)** — peticiones HTTP a la API de Kick
- **[electron-builder](https://www.electron.build/)** — empaquetado e instalador NSIS
- **HTML / CSS / JavaScript** — interfaz, sin frameworks

---

## 📄 Licencia

Distribuido bajo la licencia **MIT**. Mirá el archivo [LICENSE](LICENSE) para más detalles.

<div align="center">

Hecho para la comunidad de Kick, Twitch y CS2

</div>
