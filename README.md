# LasAmericas · Himnario de la iglesia

App para la iglesia: los 613 himnos del Himnario Adventista con audio (cantado e instrumental),
letra sincronizada con el audio, meditación bíblica por himno, favoritos, roles de culto,
cumpleaños, líderes, música desde Google Drive, videos de YouTube y música de fondo.
Funciona **sin internet** para todo lo que ya se guardó.

**Developer: Marco Antonio Mamani**

Hay **dos formas de usarla**, con la misma interfaz:

| | Opción A · Web en la PC | Opción B · App de Android (APK) |
|---|---|---|
| Para qué | Proyector, PC de la iglesia | Celular de cada hermano |
| Cómo se usa | Navegador en `http://localhost:3060` | App **LasAmericas** instalada |
| Necesita | Node.js 20+ | Android 8 o superior |
| Extras | Ventana flotante "siempre encima" | Notificaciones de cumpleaños, música en segundo plano, video en ventanita (PiP) |

---

## Opción A · Web en la PC

### Qué instalar

| Requisito | Para qué | Notas |
|---|---|---|
| **Node.js 20 o superior** | Ejecuta el servidor | https://nodejs.org (versión LTS). Comprobar con `node -v` |
| **Google Chrome o Microsoft Edge** | Usar la app | Firefox funciona, salvo la ventana flotante (⧉) |
| **Internet la primera vez** | Bajar la lista de himnos y cada himno la primera vez | Después funciona sin conexión |

**No hace falta `npm install`:** el servidor no tiene dependencias, solo usa lo que trae Node.

### Cómo levantarlo

**Recomendado:** doble clic en `iniciar.bat`. Se abre una ventana negra "Himnario - Servidor";
déjala abierta (puede estar minimizada). Si la cierras, la página deja de funcionar.

**Desde una consola** (Git Bash o CMD), en la carpeta del proyecto:

```bash
node servidor.js
```

o lo mismo con `npm start`. Para otro puerto (por defecto 3060), en CMD:

```bat
set PUERTO=3070 && node servidor.js
```

### Cómo abrirla

- **En la PC:** http://localhost:3060
- **En un celular de la misma WiFi:** `http://IP-de-la-PC:3060` (la IP sale con `ipconfig`).
  El firewall de Windows debe permitir conexiones entrantes a Node.

---

## Opción B · App de Android (APK)

### Instalar en un celular

1. Copia `android/LasAmericas.apk` al celular (cable, WhatsApp, Drive…).
2. Ábrelo y permite **"Instalar apps desconocidas"** para esa app cuando lo pida.
3. Abre **LasAmericas** y **acepta las notificaciones** (son los avisos de cumpleaños).

**Para actualizar, instala la APK nueva encima de la anterior. No desinstales:** desinstalar
borra favoritos y lo descargado. Los datos personales (favoritos, meditaciones y letras propias,
ajustes) además se respaldan en la cuenta de Google del celular.

### Compilar la APK

| Requisito | Notas |
|---|---|
| **JDK 17** | En `C:\Program Files\Java\jdk-17` (o el que trae Android Studio) |
| **Android SDK** con la plataforma 35 y build-tools 35.0.1 | Su ruta va en `android/local.properties` (`sdk.dir=...`) |

No hace falta Android Studio ni permisos de administrador. Doble clic en:

```bat
android\compilar.bat
```

o desde una consola, en la carpeta `android`:

```bash
./gradlew assembleDebug
```

Deja la app en `android/LasAmericas.apk`. Al compilar, copia sola la interfaz (`web/`) y los
datos (`datos/`) del proyecto, y les agrega los ajustes para celular de `android/movil/`.
**Cada vez que cambies algo en `web/` o en los datos, vuelve a compilar.**

> **Firma:** la APK se firma con la clave de depuración de la PC (`~/.android/debug.keystore`).
> Si compilas en otra PC, Android no deja instalarla encima de las anteriores. Para seguir
> actualizando, copia ese archivo a la otra PC.

### Cómo está hecha

Una sola pantalla con una vista web a pantalla completa. Adentro, la app levanta su propio
servidor en `127.0.0.1:37460` (nunca sale del celular), con la misma API que `servidor.js`.
Por eso la interfaz es la misma en la PC y en el celular.

| Archivo | Qué hace |
|---|---|
| `MainActivity.kt` | Vista web, botón atrás (doble atrás para salir), pantalla completa, imagen en imagen (PiP) para videos, permisos |
| `ServidorHttp.kt` | Servidor HTTP mínimo con soporte de saltos (`Range`) para adelantar audios |
| `Api.kt` | Las mismas rutas que `servidor.js`, la lectura de la hoja de Google y las descargas |
| `Avisos.kt` | Notificaciones de cumpleaños (8:00, el día antes y el mismo día, aunque la app esté cerrada) |
| `ServicioMusica.kt` | Música en segundo plano con controles en la notificación; mantiene el procesador despierto mientras suena |
| `movil/movil.css`, `movil/movil.js` | Ajustes de la interfaz solo para el celular |

---

## Qué hace (las dos opciones)

| Sección | Qué ofrece |
|---|---|
| **Himnos** | Buscador por número o título, filtro por tema, pestañas ♥ Favoritos y Sin internet. En Favoritos: **▶ Reproducir todo** y **🔀 Aleatorio**, con ⏮ ⏭ |
| **Dentro de un himno** | Cantado/Instrumental, letra (imágenes del himnario), favorito, guardar sin internet, meditación con citas y texto bíblico (Reina-Valera 1909) |
| **🎬 Presentación** | Letra en grande, cambiando en el segundo exacto del audio; pantalla completa para el proyector |
| **Roles** | Pestaña *Roles de culto* (sábados: predicador, acompañantes, JA, flores; miércoles de culto; anciano de turno con foto) y pestaña *Líderes* por gestión, con llamar y WhatsApp |
| **Cumpleaños** | Hoy, mañana, esta semana, próximos y todos por mes. Aviso al abrir y, en Android, notificación |
| **Música** | Audios de la carpeta pública de Google Drive; ⏮ ⏭, aleatorio, guardar sin internet |
| **Videos** | Listas de YouTube; los que no se pueden ver aparecen marcados y se saltan solos |
| **🌙 Fondo** | Música suave cuando nada suena. **Viene desactivada**; se activa en 🌙 |

La barra inferior (Himnos · Roles · Cumpleaños · Música · Videos) aparece en pantallas angostas.
Lo que suena sigue en un mini reproductor al cambiar de pantalla.

---

## Datos compartidos: la hoja de Google

Los **roles, ancianos de turno, cumpleaños y líderes** salen de la hoja de Google de la iglesia
(compartida "cualquier persona con el enlace" como lector). La app la lee:

- **Al abrirse, cada 15 minutos y con ⟳ Actualizar.** Con internet descarga la versión nueva.
- **Sin internet** usa la última copia guardada.
- **✎ Editar** abre la hoja. Solo editan las cuentas invitadas como editoras en Google Sheets.

| Pestaña | Columnas (fila 1, no cambiarlas) |
|---|---|
| Roles | Fecha (dd/mm/aaaa) · Día (Sábado/Miércoles) · Predicador / A cargo · Acompañantes · JA tarde · Flores |
| Ancianos | Año · Mes · Anciano de turno · Foto (enlace de Google Drive) |
| Cumpleaños | Nombre · Día · Mes |
| Líderes | Gestión · Nombre · Cargo · Celular · (opcional) Foto |

Las fotos se pegan como enlace de un archivo de Drive compartido con enlace. El identificador
de la hoja está en `servidor.js` y en `android/.../Api.kt` (`HOJA_ID` / `hojaId`).

> **Privacidad:** quien tenga el enlace de la hoja puede ver nombres, cumpleaños y celulares.
> No pongas años de nacimiento, direcciones ni números de quien no esté de acuerdo.

---

## Estructura del proyecto

```
Himnario/
├── iniciar.bat              Arranque de la opción A
├── servidor.js              Servidor web (Node sin dependencias)
├── web/                     Interfaz (la usan las dos opciones)
│   ├── index.html · estilos.css
│   ├── app.js               Lógica principal
│   ├── fondo.js             Música de fondo (incluye el sintetizador)
│   ├── flotante.js          Ventana flotante "siempre encima" (PC)
│   └── video-flotante.html  Reproductor de YouTube para la ventana flotante
├── datos/                   Datos de la app (ver tabla)
├── descargas/               Audios y letras guardados (se crea solo; no va a Git)
├── musica-fondo/            Pistas de fondo propias (se copian a mano; no va a Git)
└── android/                 Opción B: proyecto de la app de Android
```

| Archivo de `datos/` | Contenido | ¿En Git? |
|---|---|---|
| `biblia-rv1909.json` | Biblia Reina-Valera 1909 (dominio público) | Sí |
| `meditaciones.json`, `meditaciones-himnos.json` | Meditaciones por tema y por himno | Sí |
| `videos.json` | Videos de YouTube agregados | Sí |
| `catalogo.json` | Lista de himnos con tiempos de la letra | No (se baja sola) |
| `roles.json`, `cumpleanos.json`, `lideres.json`, `fotos/` | Copia de la hoja de Google | No (datos personales) |
| `favoritos.json`, `mis-meditaciones.json`, `mis-letras.json` | Datos de cada instalación | No |

---

## Solución de problemas

| Síntoma | Qué hacer |
|---|---|
| "No se puede acceder a este sitio" (PC) | El servidor no está corriendo: abre `iniciar.bat` |
| `EADDRINUSE ... :3060` | Ya hay un servidor abierto; usa esa ventana o cambia el puerto |
| La página se ve rara tras actualizar (PC) | **Ctrl+F5** |
| "Sin conexión con la hoja" | Sin internet o la hoja dejó de estar compartida con enlace; se usa la última copia |
| Android no deja instalar la APK encima | Se compiló en otra PC (otra firma). Ver "Firma" arriba |
| La música se corta con la pantalla apagada | Ajustes → Apps → LasAmericas → Batería → **Sin restricciones** |
| No llegan los avisos de cumpleaños | Ajustes → Apps → LasAmericas → Notificaciones: activarlas |
| Un video sale "No disponible" | El dueño no permite verlo fuera de YouTube; la app lo salta |

---

## Contenido y derechos

- **Audios y letras del himnario** (de adventista7.com): tienen derechos de autor. La app los
  muestra como los publica el sitio (las letras son sus imágenes), para uso de la iglesia.
  **No los vuelvas a publicar.**
- **Biblia Reina-Valera 1909:** dominio público.
- **Meditaciones, "Sublime gracia" y "Ambiente suave"** (generadas por la app): contenido propio;
  la melodía "New Britain" (1829) es de dominio público.
- **YouTube:** se usa su reproductor oficial.
- **Ícono de la app:** diseño original (no es el logo oficial de la Iglesia Adventista).
