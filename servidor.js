// Himnario offline - servidor local
// Sin dependencias: solo Node 20+. Se inicia con iniciar.bat
// Developed by Marco Antonio Mamani

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO) || 3060;
const ORIGEN = 'https://adventista7.com/app/himnario';
const CARPETA_DATOS = path.join(RAIZ, 'datos');
const CARPETA_DESCARGAS = path.join(RAIZ, 'descargas');
const CARPETA_WEB = path.join(RAIZ, 'web');
const ARCHIVO_CATALOGO = path.join(CARPETA_DATOS, 'catalogo.json');
const ARCHIVO_FAVORITOS = path.join(CARPETA_DATOS, 'favoritos.json');
const ARCHIVO_MEDITACIONES = path.join(CARPETA_DATOS, 'meditaciones.json');
const ARCHIVO_MIS_MEDITACIONES = path.join(CARPETA_DATOS, 'mis-meditaciones.json');
const ARCHIVO_MIS_LETRAS = path.join(CARPETA_DATOS, 'mis-letras.json');
const ARCHIVO_MEDITACIONES_HIMNOS = path.join(CARPETA_DATOS, 'meditaciones-himnos.json');
const ARCHIVO_VIDEOS = path.join(CARPETA_DATOS, 'videos.json');
const ARCHIVO_MUSICA = path.join(CARPETA_DATOS, 'musica.json');
const ARCHIVO_MUSICA_CACHE = path.join(CARPETA_DATOS, 'musica-cache.json');
const CARPETA_MUSICA = path.join(CARPETA_DESCARGAS, 'musica');
const CARPETA_DRIVE_INICIAL = { id: '1aNpvd4MlIA26NG1aT72XJM0j8ipiY5Iq', nombre: 'Música de la iglesia' };
const EXTENSIONES_AUDIO = /\.(mp3|mpeg|m4a|wav|ogg|oga|aac|flac|opus)$/i;
// Carpeta para música de fondo propia: se copia aquí cualquier audio (o video mp4) y aparece en 🌙
const CARPETA_FONDO = path.join(RAIZ, 'musica-fondo');
const EXTENSIONES_FONDO = /\.(mp3|mpeg|m4a|mp4|wav|ogg|oga|aac|flac|opus|webm)$/i;

const TEMAS = [
  { id: 'culto', nombre: 'Culto', desde: 1, hasta: 52 },
  { id: 'padre', nombre: 'Dios el Padre', desde: 53, hasta: 77 },
  { id: 'cristo', nombre: 'Jesucristo', desde: 78, hasta: 189 },
  { id: 'espiritu', nombre: 'Espíritu Santo', desde: 190, hasta: 203 },
  { id: 'escrituras', nombre: 'Las Sagradas Escrituras', desde: 204, hasta: 208 },
  { id: 'evangelio', nombre: 'El Evangelio', desde: 209, hasta: 344 },
  { id: 'vida', nombre: 'La Vida Cristiana', desde: 345, hasta: 527 },
  { id: 'iglesia', nombre: 'La Iglesia', desde: 528, hasta: 588 },
  { id: 'hogar', nombre: 'El Hogar Cristiano', desde: 589, hasta: 613 },
];
const TIPOS_AUDIO = { cantado: 'Cantado', instrumental: 'Instrumental' };

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
};

// ---------- utilidades ----------

const tres = (n) => String(n).padStart(3, '0');
const dos = (n) => String(n).padStart(2, '0');
const temaDe = (n) => TEMAS.find((t) => n >= t.desde && n <= t.hasta);

async function leerJson(archivo, porDefecto) {
  try {
    return JSON.parse(await fsp.readFile(archivo, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return porDefecto;
    throw new Error(`No se pudo leer ${path.basename(archivo)}: ${error.message}`);
  }
}

// Escribe en un temporal y luego renombra: si se corta la luz no queda el archivo a medias
async function guardarJson(archivo, datos) {
  const temporal = archivo + '.tmp';
  await fsp.writeFile(temporal, JSON.stringify(datos, null, 2), 'utf8');
  await fsp.rename(temporal, archivo);
}

async function existe(archivo) {
  try {
    await fsp.access(archivo);
    return true;
  } catch {
    return false;
  }
}

async function bajarArchivo(url, destino) {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!respuesta.ok) throw new Error(`El sitio respondió ${respuesta.status} para ${url}`);
  const datos = Buffer.from(await respuesta.arrayBuffer());
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  const temporal = destino + '.part';
  await fsp.writeFile(temporal, datos);
  await fsp.rename(temporal, destino);
}

// ---------- catálogo ----------

let catalogo = [];

async function actualizarCatalogo() {
  const respuesta = await fetch(ORIGEN + '/', { signal: AbortSignal.timeout(30_000) });
  if (!respuesta.ok) throw new Error(`El sitio respondió ${respuesta.status}`);
  // El sitio declara ISO-8859-1
  const html = new TextDecoder('latin1').decode(await respuesta.arrayBuffer());
  const himnos = [];
  const patron = /<span class="himn"([^>]*)>/g;
  for (const [, atributos] of html.matchAll(patron)) {
    const valor = (nombre) => (atributos.match(new RegExp(`data-${nombre}="([^"]*)"`)) || [])[1];
    const numero = Number(valor('number'));
    if (!numero) continue;
    himnos.push({
      numero,
      titulo: decodificarHtml(valor('title') || ''),
      diapositivas: Number(valor('slides')) || 1,
      // Milisegundos del audio en que se pasa a la página siguiente de la letra
      // (los mismos para la versión cantada y la instrumental, como en el sitio)
      tiempos: (valor('times') || '')
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0),
      tema: temaDe(numero)?.id || '',
    });
  }
  if (himnos.length < 100) throw new Error(`Se esperaban ~613 himnos y llegaron ${himnos.length}`);
  himnos.sort((a, b) => a.numero - b.numero);
  await fsp.mkdir(CARPETA_DATOS, { recursive: true });
  await guardarJson(ARCHIVO_CATALOGO, himnos);
  return himnos;
}

function decodificarHtml(texto) {
  return texto
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const himnoPorNumero = (n) => catalogo.find((h) => h.numero === n);

// ---------- descargas ----------

const carpetaHimno = (n) => path.join(CARPETA_DESCARGAS, tres(n));
const rutaAudio = (n, tipo) => path.join(carpetaHimno(n), `${tipo}.mp3`);
const rutaLetra = (n, i) => path.join(carpetaHimno(n), `letra-${dos(i)}.jpg`);

async function estadoDescarga(himno) {
  const n = himno.numero;
  const letras = await Promise.all(
    Array.from({ length: himno.diapositivas }, (_, i) => existe(rutaLetra(n, i + 1)))
  );
  return {
    cantado: await existe(rutaAudio(n, 'cantado')),
    instrumental: await existe(rutaAudio(n, 'instrumental')),
    letra: letras.every(Boolean),
  };
}

// Evita bajar dos veces lo mismo si el celular y la PC piden a la vez
const enCurso = new Map();

function descargarUnaVez(clave, tarea) {
  if (!enCurso.has(clave)) {
    enCurso.set(clave, tarea().finally(() => enCurso.delete(clave)));
  }
  return enCurso.get(clave);
}

async function asegurarLetra(himno) {
  const n = himno.numero;
  for (let i = 1; i <= himno.diapositivas; i++) {
    const destino = rutaLetra(n, i);
    if (await existe(destino)) continue;
    await descargarUnaVez(destino, () => bajarArchivo(`${ORIGEN}/Letra/${tres(n)}/${dos(i)}.jpg`, destino));
  }
}

async function asegurarAudio(himno, tipo) {
  const destino = rutaAudio(himno.numero, tipo);
  if (await existe(destino)) return destino;
  await descargarUnaVez(destino, () =>
    bajarArchivo(`${ORIGEN}/Musica/${TIPOS_AUDIO[tipo]}/${tres(himno.numero)}.mp3`, destino)
  );
  return destino;
}

async function descargarHimno(himno, tipos) {
  await asegurarLetra(himno);
  for (const tipo of tipos) await asegurarAudio(himno, tipo);
  return estadoDescarga(himno);
}

// ---------- Biblia (Reina-Valera 1909, dominio público) ----------

const LIBROS = {
  genesis: 'GEN', exodo: 'EXO', levitico: 'LEV', numeros: 'NUM', deuteronomio: 'DEU', josue: 'JOS',
  jueces: 'JDG', rut: 'RUT', '1 samuel': '1SA', '2 samuel': '2SA', '1 reyes': '1KI', '2 reyes': '2KI',
  '1 cronicas': '1CH', '2 cronicas': '2CH', esdras: 'EZR', nehemias: 'NEH', ester: 'EST', job: 'JOB',
  salmo: 'PSA', salmos: 'PSA', proverbios: 'PRO', eclesiastes: 'ECC', cantares: 'SOL', isaias: 'ISA',
  jeremias: 'JER', lamentaciones: 'LAM', ezequiel: 'EZE', daniel: 'DAN', oseas: 'HOS', joel: 'JOE',
  amos: 'AMO', abdias: 'OBA', jonas: 'JON', miqueas: 'MIC', nahum: 'NAH', habacuc: 'HAB', sofonias: 'ZEP',
  hageo: 'HAG', zacarias: 'ZEC', malaquias: 'MAL', mateo: 'MAT', marcos: 'MAR', lucas: 'LUK', juan: 'JOH',
  hechos: 'ACT', romanos: 'ROM', '1 corintios': '1CO', '2 corintios': '2CO', galatas: 'GAL', efesios: 'EPH',
  filipenses: 'PHI', colosenses: 'COL', '1 tesalonicenses': '1TH', '2 tesalonicenses': '2TH',
  '1 timoteo': '1TI', '2 timoteo': '2TI', tito: 'TIT', filemon: 'PHM', hebreos: 'HEB', santiago: 'JAM',
  '1 pedro': '1PE', '2 pedro': '2PE', '1 juan': '1JO', '2 juan': '2JO', '3 juan': '3JO', judas: 'JUD',
  apocalipsis: 'REV',
};

let biblia = null;

async function cargarBiblia() {
  if (!biblia) biblia = (await leerJson(path.join(CARPETA_DATOS, 'biblia-rv1909.json'), { libros: {} })).libros;
  return biblia;
}

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// "Juan 14:16-18, 26" -> [{ v: '14:16', t: '...' }, ...]   "Salmo 23" -> capítulo completo
async function textoDeCita(referencia) {
  const m = /^(.+?)\s+(\d+)(?::(.+))?$/.exec(referencia.trim());
  if (!m) return [];
  const codigo = LIBROS[sinTildes(m[1])];
  const capitulo = (await cargarBiblia())[codigo]?.[m[2]];
  if (!capitulo) return [];
  let numeros = Object.keys(capitulo).map(Number);
  if (m[3]) {
    numeros = [];
    for (const tramo of m[3].split(',')) {
      const [desde, hasta = desde] = tramo.split('-').map((x) => Number(x.trim()));
      for (let v = desde; v <= hasta && v - desde < 60; v++) numeros.push(v);
    }
  }
  return numeros.filter((v) => capitulo[v]).map((v) => ({ v: `${m[2]}:${v}`, t: capitulo[v] }));
}

// ---------- meditaciones ----------

// Orden: la que escribiste tú > la hecha para ese himno > una de su tema
async function meditacionDe(himno) {
  const propias = await leerJson(ARCHIVO_MIS_MEDITACIONES, {});
  const porHimno = await leerJson(ARCHIVO_MEDITACIONES_HIMNOS, {});
  let meditacion;
  if (propias[himno.numero]) {
    meditacion = { ...propias[himno.numero], propia: true };
  } else if (porHimno[himno.numero]) {
    meditacion = { ...porHimno[himno.numero], propia: false, delHimno: true };
  } else {
    const base = await leerJson(ARCHIVO_MEDITACIONES, {});
    const lista = base[himno.tema] || [];
    if (!lista.length) return null;
    meditacion = { ...lista[himno.numero % lista.length], propia: false };
  }
  meditacion.citas = await Promise.all(
    (meditacion.citas || []).map(async (c) => ({ ...c, versiculos: await textoDeCita(c.referencia) }))
  );
  return meditacion;
}

// ---------- videos de YouTube (se ven con el reproductor oficial; necesitan internet) ----------

// Acepta enlaces de video (watch, youtu.be, shorts, embed) o de lista de reproducción
function leerEnlaceYoutube(texto) {
  let url;
  try {
    url = new URL(String(texto).trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const valido = (id) => /^[\w-]{6,64}$/.test(id || '') ? id : null;
  if (host === 'youtu.be') {
    const id = valido(url.pathname.slice(1));
    return id && { tipo: 'video', id };
  }
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const lista = valido(url.searchParams.get('list'));
  const video = valido(url.searchParams.get('v')) || valido((/^\/(?:shorts|embed|live)\/([\w-]+)/.exec(url.pathname) || [])[1]);
  if (video) return { tipo: 'video', id: video };
  if (lista) return { tipo: 'lista', id: lista };
  return null;
}

// Título automático con oEmbed de YouTube (no necesita clave); si falla, uno genérico
// Consulta oEmbed de YouTube: da el título y, por su respuesta, si el video se puede ver aquí.
//   200 -> 'ok' · 401/403 -> 'no-embebible' (el dueño no permite verlo fuera de YouTube)
//   400/404 -> 'no-existe' (borrado, privado o enlace malo) · sin respuesta -> 'desconocido'
async function infoYoutube(enlace) {
  const destino = enlace.tipo === 'video'
    ? `https://www.youtube.com/watch?v=${enlace.id}`
    : `https://www.youtube.com/playlist?list=${enlace.id}`;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(destino)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return { titulo: String((await r.json()).title || '').slice(0, 200), estado: 'ok' };
    if (r.status === 401 || r.status === 403) return { titulo: '', estado: 'no-embebible' };
    if (r.status === 400 || r.status === 404) return { titulo: '', estado: 'no-existe' };
  } catch {
    /* sin internet */
  }
  return { titulo: '', estado: 'desconocido' };
}

async function tituloYoutube(enlace) {
  const { titulo } = await infoYoutube(enlace);
  return titulo || (enlace.tipo === 'lista' ? 'Lista de reproducción' : 'Video');
}

// Título y estado de cada video (los de una lista o sueltos), guardados para no pedirlos de nuevo.
// Formato: { id: { titulo, estado, revisado } }. Antes era { id: 'título' } y se sigue aceptando.
const ARCHIVO_TITULOS_YOUTUBE = path.join(CARPETA_DATOS, 'youtube-titulos.json');
const REVISAR_NO_DISPONIBLES_CADA = 7 * 24 * 3600 * 1000; // por si el dueño lo vuelve a habilitar

function normalizarInfo(valor) {
  if (!valor) return null;
  if (typeof valor === 'string') return { titulo: valor, estado: 'ok', revisado: 0 };
  return valor;
}

async function infoDeVideos(ids) {
  const cache = await leerJson(ARCHIVO_TITULOS_YOUTUBE, {});
  const ahora = Date.now();
  const faltan = ids.filter((id) => {
    const info = normalizarInfo(cache[id]);
    if (!info) return true;
    return info.estado !== 'ok' && ahora - (info.revisado || 0) > REVISAR_NO_DISPONIBLES_CADA;
  });
  let cambio = false;
  // De a 8 a la vez para no saturar la conexión
  for (let i = 0; i < faltan.length; i += 8) {
    await Promise.all(
      faltan.slice(i, i + 8).map(async (id) => {
        const info = await infoYoutube({ tipo: 'video', id });
        if (info.estado === 'desconocido') return; // sin internet: no se guarda nada
        const anterior = normalizarInfo(cache[id]);
        cache[id] = { titulo: info.titulo || anterior?.titulo || '', estado: info.estado, revisado: ahora };
        cambio = true;
      })
    );
  }
  if (cambio) await guardarJson(ARCHIVO_TITULOS_YOUTUBE, cache);
  return Object.fromEntries(ids.map((id) => [id, normalizarInfo(cache[id]) || { titulo: '', estado: 'desconocido' }]));
}

// El reproductor avisó que un video falló: se guarda para mostrarlo deshabilitado
async function marcarVideoNoDisponible(id, estado) {
  const cache = await leerJson(ARCHIVO_TITULOS_YOUTUBE, {});
  const anterior = normalizarInfo(cache[id]);
  cache[id] = { titulo: anterior?.titulo || '', estado, revisado: Date.now() };
  await guardarJson(ARCHIVO_TITULOS_YOUTUBE, cache);
  return cache[id];
}

// ---------- música desde carpetas públicas de Google Drive ----------

// Lee la vista pública de la carpeta (no necesita clave) y entra a subcarpetas
async function listarCarpetaDrive(idCarpeta, ruta = '', profundidad = 0) {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(idCarpeta)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Drive respondió ${r.status}`);
  const html = await r.text();
  const archivos = [];
  const patron = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?href="([^"]+)"[\s\S]*?flip-entry-title">([^<]*)/g;
  for (const [, id, enlace, nombreCrudo] of html.matchAll(patron)) {
    const nombre = decodificarHtml(nombreCrudo).trim();
    if (enlace.includes('/folders/')) {
      if (profundidad < 3) archivos.push(...(await listarCarpetaDrive(id, ruta ? `${ruta} / ${nombre}` : nombre, profundidad + 1)));
    } else if (EXTENSIONES_AUDIO.test(nombre)) {
      archivos.push({ id, nombre, titulo: tituloDeArchivo(nombre), subcarpeta: ruta });
    }
  }
  return archivos;
}

// "DignoEresTuGrupoPista.mp3" -> "Digno Eres Tu Grupo Pista"
function tituloDeArchivo(nombre) {
  return nombre
    .replace(EXTENSIONES_AUDIO, '')
    .replace(/[_]+/g, ' ')
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function idDeCarpetaDrive(texto) {
  const t = String(texto || '').trim();
  const m = /\/folders\/([\w-]{10,})/.exec(t) || /[?&]id=([\w-]{10,})/.exec(t) || /^([\w-]{20,})$/.exec(t);
  return m ? m[1] : null;
}

async function carpetasMusica() {
  return leerJson(ARCHIVO_MUSICA, [CARPETA_DRIVE_INICIAL]);
}

// Con internet trae la lista fresca de Drive; sin internet usa la última guardada
async function listaMusica() {
  const carpetas = await carpetasMusica();
  const cache = await leerJson(ARCHIVO_MUSICA_CACHE, {});
  let sinConexion = false;
  const canciones = [];
  for (const carpeta of carpetas) {
    try {
      cache[carpeta.id] = await listarCarpetaDrive(carpeta.id);
    } catch (error) {
      console.error(`[musica] carpeta ${carpeta.id}: ${error.message}`);
      sinConexion = true;
    }
    for (const c of cache[carpeta.id] || []) canciones.push({ ...c, carpeta: carpeta.nombre });
  }
  await guardarJson(ARCHIVO_MUSICA_CACHE, cache);
  const guardadas = new Set(await fsp.readdir(CARPETA_MUSICA).catch(() => []));
  for (const c of canciones) c.guardada = guardadas.has(c.id + path.extname(c.nombre).toLowerCase());
  canciones.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  return { carpetas, canciones, sinConexion };
}

async function cancionConocida(id) {
  const cache = await leerJson(ARCHIVO_MUSICA_CACHE, {});
  return Object.values(cache).flat().find((c) => c.id === id);
}

const rutaCancion = (cancion) => path.join(CARPETA_MUSICA, cancion.id + path.extname(cancion.nombre).toLowerCase());

async function pedirCancionADrive(cancion, rango) {
  const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(cancion.id)}&export=download`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(300_000),
    headers: rango ? { Range: rango } : {},
  });
  if (!r.ok) throw new Error(`Drive respondió ${r.status}`);
  // Si Drive devuelve una página (archivo privado o aviso de antivirus) no es audio
  if ((r.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Drive no entregó el audio (¿el archivo es público?)');
  }
  return r;
}

// Si ya está en la PC se sirve del disco (se puede adelantar).
// Si no: se pide a Drive justo el tramo que quiere el navegador (Drive permite adelantar)
// y en paralelo se baja completa para que la próxima vez quede guardada.
async function servirCancion(req, res, cancion) {
  const destino = rutaCancion(cancion);
  if (await existe(destino)) return servirArchivo(req, res, destino);

  guardarCancion(cancion).catch((error) => console.error(`[musica] guardar ${cancion.nombre}: ${error.message}`));

  const r = await pedirCancionADrive(cancion, req.headers.range);
  const cabeceras = {
    'Content-Type': TIPOS_MIME[path.extname(destino)] || 'audio/mpeg',
    'Accept-Ranges': 'bytes',
  };
  for (const nombre of ['content-length', 'content-range']) {
    if (r.headers.get(nombre)) cabeceras[nombre] = r.headers.get(nombre);
  }
  res.writeHead(r.status === 206 ? 206 : 200, cabeceras);
  try {
    for await (const trozo of r.body) {
      if (res.destroyed) break; // el usuario adelantó o cambió de canción
      res.write(trozo);
    }
  } finally {
    res.end();
  }
}

// Para "Guardar todo": solo descarga, sin enviar nada al navegador
async function guardarCancion(cancion) {
  const destino = rutaCancion(cancion);
  if (await existe(destino)) return;
  await descargarUnaVez(destino, async () => {
    const r = await pedirCancionADrive(cancion);
    await fsp.mkdir(CARPETA_MUSICA, { recursive: true });
    const temporal = destino + '.part';
    await fsp.writeFile(temporal, Buffer.from(await r.arrayBuffer()));
    await fsp.rename(temporal, destino);
  });
}

// ---------- servidor HTTP ----------

function responderJson(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': TIPOS_MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

async function leerCuerpo(req) {
  let texto = '';
  for await (const parte of req) {
    texto += parte;
    if (texto.length > 100_000) throw new ErrorCliente(413, 'Cuerpo demasiado grande');
  }
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    throw new ErrorCliente(400, 'JSON inválido');
  }
}

class ErrorCliente extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

function numeroValido(texto) {
  const n = Number(texto);
  if (!Number.isInteger(n) || !himnoPorNumero(n)) throw new ErrorCliente(404, `No existe el himno ${texto}`);
  return himnoPorNumero(n);
}

// Sirve archivos con soporte de "Range" para poder adelantar el audio
async function servirArchivo(req, res, archivo) {
  let info;
  try {
    info = await fsp.stat(archivo);
  } catch {
    return responderJson(res, 404, { error: 'No encontrado' });
  }
  const tipo = TIPOS_MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream';
  const rango = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (rango) {
    const inicio = rango[1] ? Number(rango[1]) : 0;
    const fin = rango[2] ? Math.min(Number(rango[2]), info.size - 1) : info.size - 1;
    if (inicio > fin || inicio >= info.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': tipo,
      'Content-Range': `bytes ${inicio}-${fin}/${info.size}`,
      'Content-Length': fin - inicio + 1,
      'Accept-Ranges': 'bytes',
    });
    return fs.createReadStream(archivo, { start: inicio, end: fin }).pipe(res);
  }
  // La interfaz no se cachea (así siempre se ve la última versión); audios e imágenes sí
  const esInterfaz = archivo.startsWith(CARPETA_WEB + path.sep);
  res.writeHead(200, {
    'Content-Type': tipo,
    'Content-Length': info.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': esInterfaz ? 'no-cache' : 'public, max-age=86400',
  });
  fs.createReadStream(archivo).pipe(res);
}

async function manejar(req, res) {
  const url = new URL(req.url, 'http://local');
  const partes = url.pathname.split('/').filter(Boolean);

  if (partes[0] !== 'api' && partes[0] !== 'medios') {
    // Archivos de la interfaz; se bloquea cualquier intento de salir de /web
    const relativo = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const archivo = path.normalize(path.join(CARPETA_WEB, relativo));
    if (!archivo.startsWith(CARPETA_WEB + path.sep)) throw new ErrorCliente(403, 'Prohibido');
    return servirArchivo(req, res, archivo);
  }

  // /medios/:n/cantado.mp3  /medios/:n/instrumental.mp3  /medios/:n/letra-01.jpg
  // Si no está en la PC lo baja una vez y queda guardado para usarlo sin internet.
  // (musica y fondo tienen su propio bloque más abajo)
  if (partes[0] === 'medios' && partes[1] !== 'musica' && partes[1] !== 'fondo' && partes.length === 3) {
    const himno = numeroValido(partes[1]);
    const audio = /^(cantado|instrumental)\.mp3$/.exec(partes[2]);
    const letra = /^letra-(\d{2})\.jpg$/.exec(partes[2]);
    try {
      if (audio) return servirArchivo(req, res, await asegurarAudio(himno, audio[1]));
      if (letra) {
        const i = Number(letra[1]);
        if (i < 1 || i > himno.diapositivas) throw new ErrorCliente(404, 'Página de letra inexistente');
        const destino = rutaLetra(himno.numero, i);
        if (!(await existe(destino))) {
          await descargarUnaVez(destino, () =>
            bajarArchivo(`${ORIGEN}/Letra/${tres(himno.numero)}/${dos(i)}.jpg`, destino)
          );
        }
        return servirArchivo(req, res, destino);
      }
    } catch (error) {
      if (error instanceof ErrorCliente) throw error;
      console.error(`[medios] himno ${himno.numero}: ${error.message}`);
      throw new ErrorCliente(503, 'No está guardado en la PC y no hay internet para bajarlo');
    }
    throw new ErrorCliente(404, 'Archivo no reconocido');
  }

  // /medios/fondo/:archivo -> música de fondo propia de la carpeta musica-fondo
  if (partes[0] === 'medios' && partes[1] === 'fondo' && partes[2]) {
    const nombre = decodeURIComponent(partes[2]);
    // Solo un nombre de archivo de esa carpeta: nada de rutas para salir de ella
    if (nombre !== path.basename(nombre) || !EXTENSIONES_FONDO.test(nombre)) {
      throw new ErrorCliente(400, 'Archivo no válido');
    }
    return servirArchivo(req, res, path.join(CARPETA_FONDO, nombre));
  }

  // /medios/musica/:id -> canción de Drive; se guarda en la PC la primera vez
  if (partes[0] === 'medios' && partes[1] === 'musica' && partes[2]) {
    const cancion = await cancionConocida(partes[2]);
    if (!cancion) throw new ErrorCliente(404, 'Canción no encontrada');
    try {
      return await servirCancion(req, res, cancion);
    } catch (error) {
      console.error(`[musica] ${cancion.nombre}: ${error.message}`);
      throw new ErrorCliente(503, 'No está guardada en la PC y no hay internet para bajarla');
    }
  }

  if (req.method === 'POST' && partes[0] === 'api' && partes[1] === 'musica' && partes[2] === 'guardar' && partes[3]) {
    const cancion = await cancionConocida(partes[3]);
    if (!cancion) throw new ErrorCliente(404, 'Canción no encontrada');
    try {
      await guardarCancion(cancion);
      return responderJson(res, 200, { guardada: true });
    } catch (error) {
      console.error(`[musica] ${cancion.nombre}: ${error.message}`);
      throw new ErrorCliente(503, 'No se pudo guardar. ¿Hay internet?');
    }
  }

  const ruta = `${req.method} /${partes.slice(1).join('/')}`;

  if (ruta === 'GET /fondo/pistas') {
    const archivos = await fsp.readdir(CARPETA_FONDO).catch(() => []);
    const pistas = archivos
      .filter((a) => EXTENSIONES_FONDO.test(a))
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((archivo) => ({ archivo, titulo: archivo.replace(EXTENSIONES_FONDO, '').trim() }));
    return responderJson(res, 200, pistas);
  }

  if (ruta === 'GET /musica') {
    return responderJson(res, 200, await listaMusica());
  }

  if (ruta === 'POST /musica/carpetas') {
    const { url: texto } = await leerCuerpo(req);
    const id = idDeCarpetaDrive(texto);
    if (!id) throw new ErrorCliente(400, 'Pega el enlace de una carpeta de Google Drive');
    const carpetas = await carpetasMusica();
    if (!carpetas.some((c) => c.id === id)) {
      let archivos;
      try {
        archivos = await listarCarpetaDrive(id);
      } catch {
        throw new ErrorCliente(400, 'No se pudo abrir la carpeta. ¿Es pública y hay internet?');
      }
      carpetas.push({ id, nombre: `Carpeta ${carpetas.length + 1} (${archivos.length} audios)` });
      await guardarJson(ARCHIVO_MUSICA, carpetas);
    }
    return responderJson(res, 200, await listaMusica());
  }

  if (req.method === 'DELETE' && partes[1] === 'musica' && partes[2] === 'carpetas' && partes[3]) {
    const carpetas = (await carpetasMusica()).filter((c) => c.id !== partes[3]);
    await guardarJson(ARCHIVO_MUSICA, carpetas);
    return responderJson(res, 200, await listaMusica());
  }

  if (ruta === 'GET /himnos') {
    const favoritos = new Set(await leerJson(ARCHIVO_FAVORITOS, []));
    const lista = await Promise.all(
      catalogo.map(async (h) => ({ ...h, favorito: favoritos.has(h.numero), descargado: await estadoDescarga(h) }))
    );
    return responderJson(res, 200, { temas: TEMAS, himnos: lista });
  }

  if (partes[1] === 'himnos' && partes[2]) {
    const himno = numeroValido(partes[2]);
    const accion = partes[3] || '';

    if (req.method === 'GET' && accion === '') {
      const favoritos = await leerJson(ARCHIVO_FAVORITOS, []);
      return responderJson(res, 200, {
        ...himno,
        temaNombre: temaDe(himno.numero)?.nombre,
        favorito: favoritos.includes(himno.numero),
        descargado: await estadoDescarga(himno),
        meditacion: await meditacionDe(himno),
        letraTexto: (await leerJson(ARCHIVO_MIS_LETRAS, {}))[himno.numero] || '',
      });
    }

    // Letra en texto escrita o pegada por el usuario (vacía = volver a las imágenes)
    if (req.method === 'PUT' && accion === 'letra') {
      const { letra } = await leerCuerpo(req);
      const letras = await leerJson(ARCHIVO_MIS_LETRAS, {});
      const texto = String(letra || '').replace(/\r\n/g, '\n').trim().slice(0, 20_000);
      if (texto) letras[himno.numero] = texto;
      else delete letras[himno.numero];
      await guardarJson(ARCHIVO_MIS_LETRAS, letras);
      return responderJson(res, 200, { letraTexto: texto });
    }

    if (req.method === 'POST' && accion === 'favorito') {
      const { favorito } = await leerCuerpo(req);
      const favoritos = new Set(await leerJson(ARCHIVO_FAVORITOS, []));
      favorito ? favoritos.add(himno.numero) : favoritos.delete(himno.numero);
      await guardarJson(ARCHIVO_FAVORITOS, [...favoritos].sort((a, b) => a - b));
      return responderJson(res, 200, { favorito: favoritos.has(himno.numero) });
    }

    if (req.method === 'POST' && accion === 'descargar') {
      const { tipos = ['cantado', 'instrumental'] } = await leerCuerpo(req);
      const validos = tipos.filter((t) => TIPOS_AUDIO[t]);
      try {
        return responderJson(res, 200, await descargarHimno(himno, validos));
      } catch (error) {
        console.error(`[descargar] himno ${himno.numero}: ${error.message}`);
        throw new ErrorCliente(503, 'No se pudo descargar. ¿Hay internet?');
      }
    }

    if (req.method === 'PUT' && accion === 'meditacion') {
      const { titulo, reflexion, citas } = await leerCuerpo(req);
      const propias = await leerJson(ARCHIVO_MIS_MEDITACIONES, {});
      if (!titulo && !reflexion) {
        delete propias[himno.numero]; // vacío = volver a la meditación del tema
      } else {
        propias[himno.numero] = {
          titulo: String(titulo || '').slice(0, 200),
          reflexion: String(reflexion || '').slice(0, 5000),
          citas: (Array.isArray(citas) ? citas : []).slice(0, 10).map((c) => ({
            referencia: String(c.referencia || '').slice(0, 100),
            nota: String(c.nota || '').slice(0, 1000),
          })),
        };
      }
      await guardarJson(ARCHIVO_MIS_MEDITACIONES, propias);
      return responderJson(res, 200, await meditacionDe(himno));
    }
  }

  if (ruta === 'POST /videos/titulos') {
    const { ids } = await leerCuerpo(req);
    const validos = (Array.isArray(ids) ? ids : []).filter((id) => /^[\w-]{6,64}$/.test(id)).slice(0, 300);
    return responderJson(res, 200, await infoDeVideos(validos));
  }

  if (ruta === 'POST /videos/no-disponible') {
    const { id, estado } = await leerCuerpo(req);
    if (!/^[\w-]{6,64}$/.test(String(id || ''))) throw new ErrorCliente(400, 'Video inválido');
    const valido = ['no-existe', 'no-embebible', 'error'].includes(estado) ? estado : 'error';
    return responderJson(res, 200, await marcarVideoNoDisponible(id, valido));
  }

  if (ruta === 'GET /videos') {
    return responderJson(res, 200, await leerJson(ARCHIVO_VIDEOS, []));
  }

  if (ruta === 'POST /videos') {
    const { url: texto, titulo } = await leerCuerpo(req);
    const enlaces = String(texto || '').split(/\s+/).filter(Boolean);
    if (!enlaces.length) throw new ErrorCliente(400, 'Pega uno o más enlaces de YouTube');
    const videos = await leerJson(ARCHIVO_VIDEOS, []);
    const agregados = [];
    const invalidos = [];
    for (const e of enlaces.slice(0, 100)) {
      const enlace = leerEnlaceYoutube(e);
      if (!enlace) {
        invalidos.push(e);
        continue;
      }
      if (videos.some((v) => v.tipo === enlace.tipo && v.id === enlace.id)) continue; // ya estaba
      const nuevo = {
        ...enlace,
        titulo: (enlaces.length === 1 && String(titulo || '').trim().slice(0, 200)) || (await tituloYoutube(enlace)),
        agregado: new Date().toISOString(),
      };
      videos.push(nuevo);
      agregados.push(nuevo);
    }
    if (!agregados.length && invalidos.length) throw new ErrorCliente(400, 'Ese enlace no parece de YouTube');
    await guardarJson(ARCHIVO_VIDEOS, videos);
    return responderJson(res, 200, { agregados: agregados.length, invalidos, videos });
  }

  if (req.method === 'DELETE' && partes[1] === 'videos' && partes[2] && partes[3]) {
    const videos = (await leerJson(ARCHIVO_VIDEOS, [])).filter((v) => !(v.tipo === partes[2] && v.id === partes[3]));
    await guardarJson(ARCHIVO_VIDEOS, videos);
    return responderJson(res, 200, videos);
  }

  if (ruta === 'POST /catalogo/actualizar') {
    try {
      catalogo = await actualizarCatalogo();
      return responderJson(res, 200, { total: catalogo.length });
    } catch (error) {
      console.error(`[catalogo] ${error.message}`);
      throw new ErrorCliente(503, 'No se pudo actualizar el catálogo. ¿Hay internet?');
    }
  }

  throw new ErrorCliente(404, 'Ruta no encontrada');
}

async function iniciar() {
  await fsp.mkdir(CARPETA_DATOS, { recursive: true });
  await fsp.mkdir(CARPETA_DESCARGAS, { recursive: true });
  await fsp.mkdir(CARPETA_FONDO, { recursive: true });

  catalogo = await leerJson(ARCHIVO_CATALOGO, []);
  if (!catalogo.length) {
    console.log('Primera vez: bajando la lista de himnos (necesita internet)...');
    try {
      catalogo = await actualizarCatalogo();
    } catch (error) {
      console.error(`No se pudo bajar la lista de himnos: ${error.message}`);
      console.error('Conéctate a internet y vuelve a iniciar.');
      process.exit(1);
    }
  } else if (!catalogo.some((h) => Array.isArray(h.tiempos))) {
    // Catálogo de una versión anterior, sin los tiempos de la letra: se actualiza en segundo
    // plano. Si no hay internet, la app sigue funcionando y lo reintenta en el próximo inicio.
    actualizarCatalogo()
      .then((nuevo) => {
        catalogo = nuevo;
        console.log('Catálogo actualizado con los tiempos de la letra');
      })
      .catch((error) => console.error(`No se pudieron bajar los tiempos de la letra: ${error.message}`));
  }

  http
    .createServer((req, res) => {
      manejar(req, res).catch((error) => {
        const estado = error instanceof ErrorCliente ? error.estado : 500;
        if (estado === 500) console.error(error);
        if (!res.headersSent) responderJson(res, estado, { error: estado === 500 ? 'Error interno' : error.message });
        else res.end();
      });
    })
    .listen(PUERTO, () => {
      console.log(`Himnario listo: ${catalogo.length} himnos`);
      console.log(`Abre http://localhost:${PUERTO} en esta PC`);
      console.log(`o http://<IP-de-esta-PC>:${PUERTO} en el celular (misma red WiFi)`);
    });
}

iniciar();
