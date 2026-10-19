// Himnario offline - interfaz
// Developed by Marco Antonio Mamani

const $ = (sel) => document.querySelector(sel);

// Si el navegador guardó una página vieja y la mezcla con este código nuevo, se refresca
// la página desde el servidor (una sola vez) en lugar de fallar en silencio
if (!$('#motor') || !$('#mini-audio') || !$('#dock-video')) {
  if (!sessionStorage.getItem('himnario-recargado')) {
    sessionStorage.setItem('himnario-recargado', '1');
    fetch(location.pathname, { cache: 'reload' }).finally(() => location.reload());
  }
  throw new Error('Página desactualizada: recargando');
}
sessionStorage.removeItem('himnario-recargado');
const estado = {
  temas: [],
  himnos: [],
  filtro: 'todos',
  tema: '',
  actual: null,
  tipo: 'cantado',
};

// ---------- utilidades ----------

async function api(ruta, opciones = {}) {
  const respuesta = await fetch('/api' + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json' },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);
  return datos;
}

let temporizadorAviso;
function avisar(texto) {
  const aviso = $('#aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (aviso.hidden = true), 3500);
}

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

const estaCompleto = (d) => d.letra && d.cantado && d.instrumental;
const tieneAlgo = (d) => d.letra && (d.cantado || d.instrumental);

// ---------- reproductor global ----------
// Un solo <audio> (el "motor") para himnos y música. Cada pantalla tiene sus controles,
// y al salir de la pantalla la reproducción sigue en el mini reproductor flotante.

const motor = $('#motor');
let pista = null; // { fuente: 'himno'|'musica', clave, titulo, sub, icono, src, numero?, tipo?, cancion? }
let ultimaFuente = null; // 'audio' | 'video': solo flota el último que se usó
let miniCerrado = false;
let arrastrandoBarra = false;

const vistaActiva = () => document.querySelector('.vista.activa')?.id;

function mostrarVista(id) {
  document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('activa', v.id === id));
  actualizarFlotantes();
}

function formatoTiempo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00';
  const s = Math.floor(segundos);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function reproducir(nueva) {
  if (pista?.clave !== nueva.clave) {
    pista = nueva;
    motor.src = nueva.src;
  }
  miniCerrado = false;
  motor.play().catch((error) => {
    if (error.name !== 'AbortError') avisar('No se pudo reproducir: ' + error.message);
  });
  actualizarMediaSession();
  actualizarControles();
}

function alternarReproduccion() {
  if (!pista) return;
  if (motor.paused) reproducir(pista);
  else motor.pause();
}

// Botones de pistas: anterior/siguiente solo tienen sentido en la música
function pasoDePista(paso) {
  if (pista?.fuente === 'musica') otraCancion(paso);
}

// Construye los controles (▶, tiempo, barra, duración) en cada contenedor .controles-audio
document.querySelectorAll('.controles-audio').forEach((caja) => {
  const play = crear('button', 'cp-play', '▶');
  play.type = 'button';
  play.title = 'Reproducir';
  const tiempo = crear('span', 'cp-tiempo', '0:00');
  const barra = crear('input', 'cp-barra');
  Object.assign(barra, { type: 'range', min: 0, max: 1000, value: 0, step: 1 });
  barra.setAttribute('aria-label', 'Posición');
  const total = crear('span', 'cp-total', '0:00');
  caja.append(play, tiempo, barra, total);

  play.onclick = () => {
    const propia = pistaDeLugar(caja.dataset.lugar);
    if (!propia) return;
    if (pista?.clave === propia.clave) alternarReproduccion();
    else reproducir(propia);
  };
  // Mientras se arrastra solo se muestra el tiempo; al soltar recién se salta (evita pedir trozos de más)
  barra.addEventListener('input', () => {
    arrastrandoBarra = true;
    tiempo.textContent = formatoTiempo((barra.value / 1000) * motor.duration);
  });
  barra.addEventListener('change', () => {
    arrastrandoBarra = false;
    if (Number.isFinite(motor.duration)) motor.currentTime = (barra.value / 1000) * motor.duration;
  });
});

// La pista que correspondería a los controles de cada pantalla
function pistaDeLugar(lugar) {
  if (lugar === 'himno' && estado.actual) return pistaDeHimno(estado.actual, estado.tipo);
  if (lugar === 'musica') return pista?.fuente === 'musica' ? pista : null;
  return null;
}

function pistaDeHimno(himno, tipo) {
  return {
    fuente: 'himno',
    clave: `himno:${himno.numero}:${tipo}`,
    numero: himno.numero,
    tipo,
    titulo: `${himno.numero}. ${himno.titulo}`,
    sub: tipo === 'cantado' ? 'Himno · Cantado' : 'Himno · Instrumental',
    icono: String(himno.numero),
    src: `/medios/${himno.numero}/${tipo}.mp3`,
    // Para mostrar la página de letra que suena (presentación y ventana flotante)
    diapositivas: himno.diapositivas,
    tiempos: himno.tiempos || [],
  };
}

function actualizarControles() {
  document.querySelectorAll('.controles-audio').forEach((caja) => {
    const propia = pistaDeLugar(caja.dataset.lugar);
    const suena = propia && pista?.clave === propia.clave;
    const [play, tiempo, barra, total] = caja.children;
    play.textContent = suena && !motor.paused ? '⏸' : '▶';
    play.title = suena && !motor.paused ? 'Pausar' : 'Reproducir';
    barra.disabled = !suena || !Number.isFinite(motor.duration);
    if (!suena) {
      barra.value = 0;
      tiempo.textContent = '0:00';
      total.textContent = '0:00';
    } else if (!arrastrandoBarra) {
      const d = motor.duration;
      barra.value = Number.isFinite(d) && d > 0 ? Math.round((motor.currentTime / d) * 1000) : 0;
      tiempo.textContent = formatoTiempo(motor.currentTime);
      total.textContent = formatoTiempo(d);
    }
  });
  actualizarMini();
}

['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'emptied'].forEach((evento) =>
  motor.addEventListener(evento, actualizarControles)
);

motor.addEventListener('play', () => {
  ultimaFuente = 'audio';
  miniCerrado = false;
  Fondo.detener(); // al sonar algo, el fondo se apaga con un fade
  reproductor?.pauseVideo?.(); // nunca suenan audio y video a la vez
  if (typeof VentanaFlotante !== 'undefined') VentanaFlotante.pausarVideo();
  if (pista?.fuente === 'musica') pintarMusica();
  actualizarFlotantes();
});
motor.addEventListener('pause', () => {
  if (pista?.fuente === 'musica') pintarMusica();
  revisarSilencio();
});
motor.addEventListener('ended', () => {
  if (pista?.fuente === 'musica') otraCancion(1);
  revisarSilencio();
});

// Si nada suena, el fondo entra después de la espera configurada
// (si en ese tiempo arranca otra pista, por ejemplo la siguiente canción, se cancela)
function revisarSilencio() {
  if (motor.paused && !videoSonando()) Fondo.programar();
}
// Cuando cargó completo, el servidor ya lo guardó en la PC
motor.addEventListener('canplaythrough', () => {
  if (pista?.fuente === 'himno' && estado.actual?.numero === pista.numero) refrescarDescarga();
  if (pista?.fuente === 'musica' && !pista.cancion.guardada) {
    pista.cancion.guardada = true;
    pintarMusica();
  }
});
motor.addEventListener('error', () => {
  if (!motor.getAttribute('src')) return;
  avisar(pista?.fuente === 'musica'
    ? 'Esta canción no está guardada y no hay internet para escucharla'
    : 'Este himno no está guardado y no hay internet para escucharlo');
});

// ----- barras de posición finas (mini reproductor y video flotante) -----
// Mientras se arrastra solo se previsualiza el tiempo; al soltar recién se salta.
function conectarBarra(barra, { duracion, saltar, previsualizar }) {
  barra.arrastrando = false;
  barra.addEventListener('input', () => {
    barra.arrastrando = true;
    barra.style.setProperty('--avance', `${barra.value / 10}%`);
    previsualizar?.((barra.value / 1000) * duracion());
  });
  barra.addEventListener('change', () => {
    barra.arrastrando = false;
    const d = duracion();
    if (Number.isFinite(d) && d > 0) saltar((barra.value / 1000) * d);
  });
  // Que tocar la barra no active el "abrir pantalla completa" del flotante
  ['click', 'pointerdown'].forEach((e) => barra.addEventListener(e, (ev) => ev.stopPropagation()));
}

function pintarBarra(barra, actual, total) {
  if (barra.arrastrando) return;
  const valido = Number.isFinite(total) && total > 0;
  barra.disabled = !valido;
  barra.value = valido ? Math.round((actual / total) * 1000) : 0;
  barra.style.setProperty('--avance', `${barra.value / 10}%`);
}

conectarBarra($('#mini-barra'), {
  duracion: () => motor.duration,
  saltar: (s) => (motor.currentTime = s),
  previsualizar: (s) => ($('#mini-tiempo').textContent = `${formatoTiempo(s)} / ${formatoTiempo(motor.duration)}`),
});

// ----- mini reproductor flotante -----

function estaEnSuPantalla() {
  if (pista?.fuente === 'musica') return vistaActiva() === 'vista-musica';
  if (pista?.fuente === 'himno') return vistaActiva() === 'vista-himno' && estado.actual?.numero === pista.numero;
  return false;
}

function actualizarMini() {
  const mini = $('#mini-audio');
  const visible = Boolean(pista) && !miniCerrado && ultimaFuente === 'audio' && !estaEnSuPantalla();
  mini.hidden = !visible;
  if (!visible) return;
  $('#mini-titulo').textContent = pista.titulo;
  $('#mini-sub').textContent = pista.sub;
  $('#mini-icono').textContent = pista.icono;
  $('#mini-play').textContent = motor.paused ? '▶' : '⏸';
  $('#mini-play').title = motor.paused ? 'Reproducir' : 'Pausar';
  const esMusica = pista.fuente === 'musica';
  $('#mini-anterior').hidden = !esMusica;
  $('#mini-siguiente').hidden = !esMusica;
  const barra = $('#mini-barra');
  pintarBarra(barra, motor.currentTime, motor.duration);
  if (!barra.arrastrando) $('#mini-tiempo').textContent = `${formatoTiempo(motor.currentTime)} / ${formatoTiempo(motor.duration)}`;
}

$('#mini-play').onclick = alternarReproduccion;
$('#mini-anterior').onclick = () => pasoDePista(-1);
$('#mini-siguiente').onclick = () => pasoDePista(1);
$('#mini-cerrar').onclick = () => {
  motor.pause();
  miniCerrado = true;
  actualizarFlotantes();
};
// Tocar el mini reproductor abre su pantalla completa
$('#mini-abrir').onclick = () => {
  if (pista?.fuente === 'musica') abrirMusica();
  else if (pista?.fuente === 'himno') abrirHimno(pista.numero);
};

// Decide qué flota: el mini de audio o el video, según lo último que se usó
function actualizarFlotantes() {
  actualizarMini();
  ubicarVideo();
  const dock = $('#dock-video');
  const videoFlota = !dock.hidden && dock.classList.contains('flotante');
  // Deja espacio abajo para que el flotante no tape el final de las listas
  document.body.classList.toggle('con-flotante', !$('#mini-audio').hidden || videoFlota);
}

// Teclas multimedia del teclado y controles del sistema (Windows/Android)
function actualizarMediaSession() {
  if (!('mediaSession' in navigator) || !pista) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: pista.titulo, artist: pista.sub, album: 'Himnario' });
}
if ('mediaSession' in navigator) {
  const acciones = {
    play: () => pista && reproducir(pista),
    pause: () => motor.pause(),
    previoustrack: () => pasoDePista(-1),
    nexttrack: () => pasoDePista(1),
  };
  for (const [accion, fn] of Object.entries(acciones)) {
    try {
      navigator.mediaSession.setActionHandler(accion, fn);
    } catch {
      /* el navegador no soporta esa acción */
    }
  }
}

// ---------- lista ----------

async function cargarLista() {
  try {
    const datos = await api('/himnos');
    estado.temas = datos.temas;
    estado.himnos = datos.himnos;
    pintarTemas();
    pintarLista();
  } catch (error) {
    avisar('No se pudo cargar la lista: ' + error.message);
  }
}

function pintarTemas() {
  const contenedor = $('#temas');
  contenedor.replaceChildren();
  const opciones = [{ id: '', nombre: 'Todos los temas' }, ...estado.temas];
  for (const tema of opciones) {
    const chip = crear('button', 'chip' + (tema.id === estado.tema ? ' activo' : ''), tema.nombre);
    chip.onclick = () => {
      estado.tema = tema.id;
      pintarTemas();
      pintarLista();
    };
    contenedor.append(chip);
  }
}

function himnosFiltrados() {
  const texto = sinTildes($('#buscar').value.trim());
  return estado.himnos.filter((h) => {
    if (estado.filtro === 'favoritos' && !h.favorito) return false;
    if (estado.filtro === 'descargados' && !tieneAlgo(h.descargado)) return false;
    if (estado.tema && h.tema !== estado.tema) return false;
    if (!texto) return true;
    if (/^\d+$/.test(texto)) return String(h.numero).startsWith(texto);
    return sinTildes(h.titulo).includes(texto);
  });
}

function pintarLista() {
  const lista = $('#lista');
  const himnos = himnosFiltrados();
  const nombreTema = Object.fromEntries(estado.temas.map((t) => [t.id, t.nombre]));
  // Se pintan como mucho 200 para que el celular no se trabe; el buscador acota el resto
  const fragmento = document.createDocumentFragment();
  for (const h of himnos.slice(0, 200)) {
    const li = crear('li');
    li.append(crear('span', 'numero', h.numero));
    const titulo = crear('span', 'titulo', h.titulo);
    titulo.append(crear('small', '', nombreTema[h.tema] || ''));
    li.append(titulo);
    const marcas = crear('span', 'marcas');
    if (h.favorito) marcas.append(crear('span', 'fav', '♥ '));
    if (tieneAlgo(h.descargado)) marcas.append(crear('span', 'ok', '⬇'));
    li.append(marcas);
    li.onclick = () => abrirHimno(h.numero);
    fragmento.append(li);
  }
  lista.replaceChildren(fragmento);

  const vacio = $('#vacio');
  vacio.hidden = himnos.length > 0;
  if (!himnos.length) {
    vacio.textContent =
      estado.filtro === 'favoritos' ? 'Aún no tienes favoritos. Toca ♡ dentro de un himno para guardarlo aquí.'
      : estado.filtro === 'descargados' ? 'Todavía no guardaste himnos para usar sin internet.'
      : 'No se encontró ningún himno.';
  }
  $('#acciones-favoritos').hidden = !(estado.filtro === 'favoritos' && himnos.length);
}

$('#buscar').addEventListener('input', pintarLista);
$('#buscar').addEventListener('keydown', (e) => {
  // Enter con un número exacto abre el himno directo
  if (e.key === 'Enter' && /^\d+$/.test(e.target.value.trim())) {
    const n = Number(e.target.value.trim());
    if (estado.himnos.some((h) => h.numero === n)) abrirHimno(n);
  }
});

document.querySelectorAll('.pestana').forEach((boton) => {
  boton.onclick = () => {
    document.querySelectorAll('.pestana').forEach((b) => b.classList.toggle('activa', b === boton));
    estado.filtro = boton.dataset.filtro;
    pintarLista();
  };
});

$('#btn-actualizar').onclick = async () => {
  if (!confirm('¿Actualizar la lista de himnos desde internet?')) return;
  try {
    const { total } = await api('/catalogo/actualizar', { method: 'POST' });
    avisar(`Lista actualizada: ${total} himnos`);
    cargarLista();
  } catch (error) {
    avisar(error.message);
  }
};

$('#btn-bajar-favoritos').onclick = async (e) => {
  const boton = e.currentTarget;
  const pendientes = estado.himnos.filter((h) => h.favorito && !estaCompleto(h.descargado));
  if (!pendientes.length) return avisar('Todos tus favoritos ya están guardados');
  boton.disabled = true;
  let hechos = 0;
  let fallos = 0;
  for (const h of pendientes) {
    boton.textContent = `Guardando ${hechos + 1} de ${pendientes.length}…`;
    try {
      h.descargado = await api(`/himnos/${h.numero}/descargar`, { method: 'POST', body: {} });
    } catch {
      fallos++;
    }
    hechos++;
  }
  boton.disabled = false;
  boton.textContent = '⬇ Guardar todos mis favoritos para usarlos sin internet';
  avisar(fallos ? `Listo, pero ${fallos} no se pudieron guardar (¿internet?)` : 'Favoritos guardados para usar sin internet');
  pintarLista();
};

// ---------- himno ----------

async function abrirHimno(numero) {
  let himno;
  try {
    himno = await api(`/himnos/${numero}`);
  } catch (error) {
    return avisar(error.message);
  }
  estado.actual = himno;
  $('#h-titulo').textContent = `${himno.numero}. ${himno.titulo}`;
  $('#h-tema').textContent = himno.temaNombre || '';
  // Si este himno ya está sonando (por ejemplo desde el mini reproductor), se respeta su versión
  if (pista?.fuente === 'himno' && pista.numero === himno.numero) estado.tipo = pista.tipo;
  pintarFavorito();
  pintarDescarga();
  marcarTipo();
  pintarLetra();
  pintarMeditacion();
  $('#form-meditacion').hidden = true;

  mostrarVista('vista-himno');
  actualizarControles();
  window.scrollTo(0, 0);
  if (location.hash !== `#${numero}`) history.pushState({ app: true }, '', `#${numero}`);
}

// Salir del himno no detiene el audio: sigue en el mini reproductor
function cerrarHimno() {
  estado.actual = null;
  mostrarVista('vista-lista');
  pintarLista();
}

$('#btn-volver').onclick = volver;
window.addEventListener('popstate', seguirRuta);

// ← vuelve a la pantalla anterior de la app; si se entró directo a una sección
// (o se recargó), no hay pantalla anterior propia: va a la lista sin salir de la app
function volver() {
  if (history.state?.app) {
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    seguirRuta();
  }
}

// #123 = himno, #videos = videos, #musica = música, vacío = lista
function seguirRuta() {
  const ruta = location.hash.slice(1);
  if (ruta !== 'musica') cerrarMusica();
  if (ruta === 'musica') {
    cerrarVideos();
    return abrirMusica(false);
  }
  if (ruta === 'videos') return abrirVideos(false);
  cerrarVideos();
  const n = Number(ruta);
  if (n) abrirHimno(n);
  else cerrarHimno();
}

function pintarFavorito() {
  const boton = $('#btn-favorito');
  boton.textContent = estado.actual.favorito ? '♥' : '♡';
  boton.classList.toggle('si', estado.actual.favorito);
  boton.title = estado.actual.favorito ? 'Quitar de favoritos' : 'Agregar a favoritos';
}

$('#btn-favorito').onclick = async () => {
  const h = estado.actual;
  try {
    const { favorito } = await api(`/himnos/${h.numero}/favorito`, { method: 'POST', body: { favorito: !h.favorito } });
    h.favorito = favorito;
    const enLista = estado.himnos.find((x) => x.numero === h.numero);
    if (enLista) enLista.favorito = favorito;
    pintarFavorito();
    avisar(favorito ? 'Agregado a favoritos' : 'Quitado de favoritos');
  } catch (error) {
    avisar(error.message);
  }
};

function marcarTipo() {
  document.querySelectorAll('.segmentado button').forEach((b) => b.classList.toggle('activo', b.dataset.tipo === estado.tipo));
}

// Cambiar Cantado/Instrumental: si este himno estaba sonando, sigue sonando en la otra versión
function cambiarTipo(tipo) {
  const estabaSonando = pista?.fuente === 'himno' && pista.numero === estado.actual.numero && !motor.paused;
  estado.tipo = tipo;
  marcarTipo();
  if (estabaSonando) reproducir(pistaDeHimno(estado.actual, tipo));
  actualizarControles();
}

document.querySelectorAll('.segmentado button').forEach((b) => (b.onclick = () => cambiarTipo(b.dataset.tipo)));

async function refrescarDescarga() {
  if (!estado.actual) return;
  try {
    const h = await api(`/himnos/${estado.actual.numero}`);
    estado.actual.descargado = h.descargado;
    const enLista = estado.himnos.find((x) => x.numero === h.numero);
    if (enLista) enLista.descargado = h.descargado;
    pintarDescarga();
  } catch {
    /* sin importancia */
  }
}

function pintarDescarga() {
  const d = estado.actual.descargado;
  const partes = [];
  if (d.letra) partes.push('letra');
  if (d.cantado) partes.push('cantado');
  if (d.instrumental) partes.push('instrumental');
  $('#h-offline').textContent = partes.length ? `Guardado sin internet: ${partes.join(', ')}` : 'Aún no guardado en esta PC';
  $('#btn-descargar').hidden = estaCompleto(d);
}

$('#btn-descargar').onclick = async (e) => {
  const boton = e.currentTarget;
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    estado.actual.descargado = await api(`/himnos/${estado.actual.numero}/descargar`, { method: 'POST', body: {} });
    const enLista = estado.himnos.find((x) => x.numero === estado.actual.numero);
    if (enLista) enLista.descargado = estado.actual.descargado;
    avisar('Himno guardado para usar sin internet');
  } catch (error) {
    avisar(error.message);
  } finally {
    boton.disabled = false;
    boton.textContent = '⬇ Guardar sin internet';
    pintarDescarga();
  }
};

// Letra: si escribiste el texto se muestra ese; si no, miniaturas que se agrandan al tocar
function pintarLetra() {
  const { numero, diapositivas, titulo, letraTexto } = estado.actual;
  // himnario.net usa otra edición con otra numeración: se busca por título, no por número
  $('#enlace-letra').href = `https://www.google.com/search?q=${encodeURIComponent(`site:himnario.net "${titulo}"`)}`;
  $('#form-letra').hidden = true;

  const texto = $('#letra-texto');
  texto.textContent = letraTexto || '';
  texto.hidden = !letraTexto;
  $('#btn-editar-letra').textContent = letraTexto ? '✎ Editar la letra' : '✎ Escribir o pegar la letra en texto';

  const contenedor = $('#letra');
  contenedor.replaceChildren();
  contenedor.hidden = Boolean(letraTexto);
  if (letraTexto) return;
  for (let i = 1; i <= diapositivas; i++) {
    const img = crear('img');
    img.loading = 'lazy';
    img.alt = `${titulo} - página ${i} de ${diapositivas}`;
    img.src = `/medios/${numero}/letra-${String(i).padStart(2, '0')}.jpg`;
    img.onclick = () => abrirVisor(img.src, img.alt);
    img.onerror = () => img.replaceWith(crear('p', 'error', `Página ${i}: no está guardada y no hay internet.`));
    contenedor.append(img);
  }
}

function abrirVisor(src, alt) {
  const visor = $('#visor');
  visor.querySelector('img').src = src;
  visor.querySelector('img').alt = alt;
  visor.hidden = false;
}
$('#visor').onclick = () => ($('#visor').hidden = true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#visor').hidden = true;
});

$('#btn-editar-letra').onclick = () => {
  const form = $('#form-letra');
  form.letra.value = estado.actual.letraTexto || '';
  form.hidden = false;
  form.letra.focus();
};
$('#btn-cancelar-letra').onclick = () => ($('#form-letra').hidden = true);

$('#form-letra').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const { letraTexto } = await api(`/himnos/${estado.actual.numero}/letra`, {
      method: 'PUT',
      body: { letra: e.currentTarget.letra.value },
    });
    estado.actual.letraTexto = letraTexto;
    pintarLetra();
    avisar(letraTexto ? 'Letra guardada' : 'Letra borrada: se muestran las imágenes');
  } catch (error) {
    avisar(error.message);
  }
};

function pintarMeditacion() {
  const caja = $('#meditacion');
  caja.replaceChildren();
  const m = estado.actual.meditacion;
  if (!m) {
    caja.append(crear('p', '', 'Sin meditación para este himno.'));
    return;
  }
  caja.append(crear('h3', '', m.titulo));
  if (m.reflexion) caja.append(crear('p', 'reflexion', m.reflexion));
  for (const c of m.citas || []) {
    const bloque = crear('div', 'cita');
    bloque.append(crear('div', 'ref', c.referencia));
    if (c.versiculos?.length) {
      const p = crear('p', 'versiculos');
      for (const v of c.versiculos) {
        p.append(crear('sup', '', v.v.split(':')[1]), document.createTextNode(v.t + ' '));
      }
      bloque.append(p);
    } else {
      bloque.append(crear('p', 'nota', '(No se encontró el texto de esta cita; revisa cómo está escrita.)'));
    }
    if (c.nota) bloque.append(crear('p', 'nota', c.nota));
    caja.append(bloque);
  }
  caja.append(crear('p', 'fuente', (m.propia ? 'Meditación escrita por ti. ' : '') + 'Texto bíblico: Reina-Valera 1909.'));
}

$('#btn-editar-meditacion').onclick = () => {
  const m = estado.actual.meditacion || {};
  const form = $('#form-meditacion');
  form.titulo.value = m.titulo || '';
  form.reflexion.value = m.reflexion || '';
  form.citas.value = (m.citas || []).map((c) => c.referencia).join('\n');
  form.hidden = false;
  form.titulo.focus();
};

$('#btn-cancelar').onclick = () => ($('#form-meditacion').hidden = true);

async function guardarMeditacion(cuerpo) {
  try {
    estado.actual.meditacion = await api(`/himnos/${estado.actual.numero}/meditacion`, { method: 'PUT', body: cuerpo });
    $('#form-meditacion').hidden = true;
    pintarMeditacion();
    avisar('Meditación guardada');
  } catch (error) {
    avisar(error.message);
  }
}

$('#form-meditacion').onsubmit = (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const anteriores = Object.fromEntries((estado.actual.meditacion?.citas || []).map((c) => [c.referencia, c.nota]));
  const citas = form.citas.value
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((referencia) => ({ referencia, nota: anteriores[referencia] || '' }));
  guardarMeditacion({ titulo: form.titulo.value.trim(), reflexion: form.reflexion.value.trim(), citas });
};

$('#btn-restaurar').onclick = () => {
  if (confirm('¿Borrar tu meditación y volver a la original?')) guardarMeditacion({});
};

// ---------- videos de YouTube ----------

let videos = [];
let videoActual = null;

async function abrirVideos(agregarAlHistorial = true) {
  videoCerrado = false;
  mostrarVista('vista-videos');
  window.scrollTo(0, 0);
  if (agregarAlHistorial && location.hash !== '#videos') history.pushState({ app: true }, '', '#videos');
  try {
    videos = await api('/videos');
  } catch (error) {
    avisar('No se pudo cargar la lista de videos: ' + error.message);
  }
  pintarVideos();
  // Revisa si los videos sueltos se pueden reproducir (la respuesta queda guardada en el servidor)
  const sueltos = videos.filter((v) => v.tipo === 'video').map((v) => v.id);
  if (sueltos.length) {
    await cargarInfoVideos(sueltos);
    pintarVideos();
  }
}

// ----- videos no disponibles -----
const MOTIVOS_NO_DISPONIBLE = {
  'no-existe': 'No disponible: fue borrado o es privado',
  'no-embebible': 'No disponible: su dueño no permite verlo fuera de YouTube',
  error: 'No se pudo reproducir este video',
};
const motivoNoDisponible = (id) => MOTIVOS_NO_DISPONIBLE[titulosDeLista[id]?.estado] || '';

// Salir de videos no detiene el video: pasa a la ventana flotante
function cerrarVideos() {
  $('#vista-videos').classList.remove('activa');
  actualizarFlotantes();
}

$('#btn-ir-videos').onclick = () => abrirVideos();
$('#btn-volver-videos').onclick = volver;

const claveVideo = (v) => `${v.tipo}/${v.id}`;

function pintarVideos() {
  const lista = $('#lista-videos');
  const fragmento = document.createDocumentFragment();
  for (const v of videos) {
    const li = crear('li');
    if (videoActual && claveVideo(videoActual) === claveVideo(v)) li.classList.add('actual');
    if (v.tipo === 'video') {
      const img = crear('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
      img.onerror = () => img.replaceWith(crear('span', 'miniatura-lista', '▶'));
      li.append(img);
    } else {
      li.append(crear('span', 'miniatura-lista', '☰'));
    }
    const motivo = v.tipo === 'video' ? motivoNoDisponible(v.id) : '';
    const info = crear('span', 'info', v.titulo);
    info.append(crear('small', motivo ? 'motivo' : '', motivo || (v.tipo === 'lista' ? 'Lista de reproducción' : 'Video')));
    li.append(info);
    if (motivo) li.classList.add('no-disponible');
    const borrar = crear('button', 'icono', '✕');
    borrar.title = 'Quitar de la lista';
    borrar.onclick = (e) => {
      e.stopPropagation();
      quitarVideo(v);
    };
    li.append(borrar);
    li.onclick = () => (motivo ? avisar(motivo) : reproducirVideo(v));
    fragmento.append(li);
  }
  lista.replaceChildren(fragmento);
  $('#vacio-videos').hidden = videos.length > 0;
}

// Reproductor oficial de YouTube (API IFrame): permite saber qué videos tiene una lista
let reproductor = null;
let apiYoutube = null;
let idsDeLista = [];
let titulosDeLista = {};
let videoCerrado = false;

// El iframe de YouTube nunca se mueve en el documento (moverlo lo recargaría):
// en su pantalla se coloca encima del hueco; fuera de ella flota en una esquina.
function ubicarVideo() {
  const dock = $('#dock-video');
  // Si el video se está viendo en la ventana flotante, en la página no se muestra
  const enVentana = typeof VentanaFlotante !== 'undefined' && VentanaFlotante.videoEnVentana();
  $('#hueco-video').classList.toggle('en-ventana', enVentana);
  if (!videoActual || enVentana) {
    dock.hidden = true;
    return;
  }
  const enSuPantalla = vistaActiva() === 'vista-videos';
  const flotar = !enSuPantalla && !videoCerrado && ultimaFuente === 'video';
  dock.hidden = !enSuPantalla && !flotar;
  dock.classList.toggle('flotante', flotar);
  if (enSuPantalla) {
    const r = $('#hueco-video').getBoundingClientRect();
    Object.assign(dock.style, {
      top: `${r.top + window.scrollY}px`,
      left: `${r.left + window.scrollX}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  } else {
    dock.removeAttribute('style');
  }
  actualizarBotonDock();
}

new ResizeObserver(ubicarVideo).observe($('#hueco-video'));
window.addEventListener('resize', ubicarVideo);

function videoSonando() {
  const enVentana = typeof VentanaFlotante !== 'undefined' && VentanaFlotante.videoSonando();
  return enVentana || reproductor?.getPlayerState?.() === 1;
}

function actualizarBotonDock() {
  const sonando = videoSonando();
  $('#dock-play').textContent = sonando ? '⏸' : '▶';
  $('#dock-play').title = sonando ? 'Pausar' : 'Reproducir';
  pintarTiempoDock();
}

// YouTube no avisa el avance del video: mientras flota se consulta 4 veces por segundo
function pintarTiempoDock() {
  if (!reproductor?.getCurrentTime) return;
  const actual = reproductor.getCurrentTime();
  const total = reproductor.getDuration();
  const barra = $('#dock-barra');
  pintarBarra(barra, actual, total);
  if (!barra.arrastrando) $('#dock-tiempo').textContent = formatoTiempo(actual);
  $('#dock-total').textContent = formatoTiempo(total);
}
setInterval(() => {
  if ($('#dock-video').classList.contains('flotante') && !$('#dock-video').hidden) pintarTiempoDock();
}, 250);

conectarBarra($('#dock-barra'), {
  duracion: () => reproductor?.getDuration?.() ?? NaN,
  saltar: (s) => {
    reproductor.seekTo(s, true);
    pintarTiempoDock();
  },
  previsualizar: (s) => ($('#dock-tiempo').textContent = formatoTiempo(s)),
});
// La franja de abajo (tiempo y barra) no abre la pantalla de videos al tocarla
$('#dock-abajo').addEventListener('click', (e) => e.stopPropagation());

$('#dock-play').onclick = (e) => {
  e.stopPropagation();
  if (videoSonando()) reproductor.pauseVideo();
  else reproductor?.playVideo?.();
};
$('#dock-cerrar').onclick = (e) => {
  e.stopPropagation();
  reproductor?.pauseVideo?.();
  videoCerrado = true;
  actualizarFlotantes();
};
$('#dock-fullscreen').onclick = (e) => {
  e.stopPropagation();
  reproductor?.getIframe?.().requestFullscreen?.().catch(() => avisar('El navegador no permitió la pantalla completa'));
};
// Tocar el video flotante abre la pantalla de videos
$('#dock-capa').onclick = () => abrirVideos();

function cargarApiYoutube() {
  if (!apiYoutube) {
    apiYoutube = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        apiYoutube = null;
        reject(new Error('No se pudo cargar YouTube. ¿Hay internet?'));
      };
      document.head.append(script);
    });
  }
  return apiYoutube;
}

async function reproducirVideo(v) {
  videoActual = v;
  videoCerrado = false;
  idsDeLista = [];
  $('#titulo-video').textContent = v.titulo;
  $('#reproductor-video').hidden = false;
  ubicarVideo();
  $('#contenido-lista').hidden = v.tipo !== 'lista';
  $('#titulo-contenido-lista').textContent = 'Cargando videos de la lista…';
  $('#videos-de-lista').replaceChildren();
  pintarVideos();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  let YT;
  try {
    YT = await cargarApiYoutube();
  } catch (error) {
    return avisar(error.message);
  }
  if (videoActual !== v) return; // tocaron otro mientras cargaba

  if (!reproductor) {
    reproductor = await new Promise((resolve) => {
      const p = new YT.Player('player-video', {
        host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, playsinline: 1 },
        events: {
          onReady: () => resolve(p),
          onStateChange: alCambiarEstado,
          onError: (e) => alErrorDeVideo(e.data),
        },
      });
    });
  }
  if (v.tipo === 'lista') reproductor.loadPlaylist({ list: v.id, listType: 'playlist', index: 0 });
  else reproductor.loadVideoById(v.id);
}

// Cuando la lista ya cargó, YouTube entrega todos sus videos con getPlaylist()
function alCambiarEstado(evento) {
  if (evento?.data === 1) {
    // Empezó a sonar el video: se pausa el audio y el video pasa a ser lo que flota
    ultimaFuente = 'video';
    videoCerrado = false;
    Fondo.detener();
    motor.pause();
    actualizarFlotantes();
    // Si la ventana flotante está abierta, el video se pasa a verse ahí
    if (typeof VentanaFlotante !== 'undefined') VentanaFlotante.alSonarVideoPrincipal();
  } else if (evento?.data === 2 || evento?.data === 0) {
    revisarSilencio(); // video pausado o terminado
  }
  actualizarBotonDock();
  if (!reproductor || videoActual?.tipo !== 'lista') return;
  const ids = reproductor.getPlaylist?.() || [];
  if (ids.length && ids.join() !== idsDeLista.join()) {
    idsDeLista = ids;
    pintarVideosDeLista();
    cargarInfoVideos(ids).then(pintarVideosDeLista);
  }
  marcarVideoActual();
}

// Título y estado (si se puede reproducir) de cada video, según el servidor
async function cargarInfoVideos(ids) {
  try {
    titulosDeLista = { ...titulosDeLista, ...(await api('/videos/titulos', { method: 'POST', body: { ids } })) };
  } catch {
    /* sin datos se muestran igual, con número */
  }
}

function pintarVideosDeLista() {
  const noDisponibles = idsDeLista.filter((id) => motivoNoDisponible(id)).length;
  $('#titulo-contenido-lista').textContent =
    `Videos de la lista (${idsDeLista.length})` + (noDisponibles ? ` · ${noDisponibles} no disponibles` : '');
  const fragmento = document.createDocumentFragment();
  idsDeLista.forEach((id, i) => {
    const li = crear('li');
    li.dataset.indice = i;
    li.append(crear('span', 'indice', i + 1));
    const img = crear('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    li.append(img);
    const motivo = motivoNoDisponible(id);
    const info = crear('span', 'info', titulosDeLista[id]?.titulo || `Video ${i + 1}`);
    if (motivo) {
      info.append(crear('small', 'motivo', motivo));
      li.classList.add('no-disponible');
    }
    li.append(info);
    li.onclick = () => (motivo ? avisar(motivo) : reproductor.playVideoAt(i));
    fragmento.append(li);
  });
  $('#videos-de-lista').replaceChildren(fragmento);
  marcarVideoActual();
}

function marcarVideoActual() {
  const actual = reproductor?.getPlaylistIndex?.() ?? -1;
  document.querySelectorAll('#videos-de-lista li').forEach((li) => {
    li.classList.toggle('actual', Number(li.dataset.indice) === actual);
  });
  const id = idsDeLista[actual];
  if (id && titulosDeLista[id]?.titulo) $('#titulo-video').textContent = titulosDeLista[id].titulo;
}

// El reproductor no pudo con un video: se marca como no disponible y, si es una lista,
// se salta al siguiente que sí se pueda ver.
// Códigos de YouTube: 100 = no existe/privado · 101 y 150 = no se permite fuera de YouTube
function alErrorDeVideo(codigo) {
  const estado = codigo === 100 ? 'no-existe' : codigo === 101 || codigo === 150 ? 'no-embebible' : 'error';
  const enLista = videoActual?.tipo === 'lista';
  const id = reproductor?.getVideoData?.()?.video_id
    || (enLista ? idsDeLista[reproductor?.getPlaylistIndex?.()] : videoActual?.id);
  if (id) {
    titulosDeLista[id] = { ...(titulosDeLista[id] || {}), estado };
    api('/videos/no-disponible', { method: 'POST', body: { id, estado } }).catch(() => {});
  }
  avisar(MOTIVOS_NO_DISPONIBLE[estado] + (enLista ? '. Pasando al siguiente…' : ''));
  pintarVideosDeLista();
  pintarVideos();
  if (enLista) setTimeout(saltarAlSiguienteDisponible, 1500);
}

function saltarAlSiguienteDisponible() {
  const actual = reproductor?.getPlaylistIndex?.() ?? -1;
  for (let i = actual + 1; i < idsDeLista.length; i++) {
    if (!motivoNoDisponible(idsDeLista[i])) return reproductor.playVideoAt(i);
  }
  avisar('No hay más videos disponibles en esta lista');
}

function detenerReproductor() {
  reproductor?.stopVideo?.();
  $('#reproductor-video').hidden = true;
  videoActual = null;
  actualizarFlotantes();
}

async function quitarVideo(v) {
  if (!confirm(`¿Quitar "${v.titulo}" de la lista?`)) return;
  try {
    videos = await api(`/videos/${v.tipo}/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
    if (videoActual && claveVideo(videoActual) === claveVideo(v)) detenerReproductor();
    pintarVideos();
  } catch (error) {
    avisar(error.message);
  }
}

$('#form-video').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const boton = form.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const r = await api('/videos', { method: 'POST', body: { url: form.url.value } });
    videos = r.videos;
    form.url.value = '';
    pintarVideos();
    let mensaje = r.agregados ? `${r.agregados} agregado(s)` : 'Ya estaban en la lista';
    if (r.invalidos.length) mensaje += `; ${r.invalidos.length} enlace(s) no eran de YouTube`;
    avisar(mensaje);
  } catch (error) {
    avisar(error.message);
  } finally {
    boton.disabled = false;
  }
};

// ---------- música de Google Drive ----------

const musica = {
  canciones: [],
  carpetas: [],
  cola: [], // canciones visibles (respeta la búsqueda)
  aleatorio: false,
  cargada: false,
};

const cancionActual = () => (pista?.fuente === 'musica' ? pista.cancion : null);

async function abrirMusica(agregarAlHistorial = true) {
  mostrarVista('vista-musica');
  actualizarControles();
  window.scrollTo(0, 0);
  if (agregarAlHistorial && location.hash !== '#musica') history.pushState({ app: true }, '', '#musica');
  if (!musica.cargada) await cargarMusica();
}

// Salir de la sección no detiene la música: sigue en el mini reproductor
function cerrarMusica() {
  $('#vista-musica').classList.remove('activa');
  actualizarFlotantes();
}

$('#btn-ir-musica').onclick = () => abrirMusica();
$('#btn-volver-musica').onclick = volver;
$('#btn-recargar-musica').onclick = () => cargarMusica();

async function cargarMusica() {
  $('#estado-musica').textContent = 'Leyendo las carpetas de Drive…';
  try {
    const datos = await api('/musica');
    musica.canciones = datos.canciones;
    musica.carpetas = datos.carpetas;
    musica.cargada = true;
    const guardadas = datos.canciones.filter((c) => c.guardada).length;
    $('#estado-musica').textContent =
      `${datos.canciones.length} canciones · ${guardadas} guardadas sin internet` +
      (datos.sinConexion ? ' · sin conexión: se muestra la última lista conocida' : '');
  } catch (error) {
    $('#estado-musica').textContent = 'No se pudo cargar la música: ' + error.message;
  }
  pintarMusica();
  pintarCarpetas();
}

function pintarMusica() {
  const texto = sinTildes($('#buscar-musica').value.trim());
  musica.cola = musica.canciones.filter(
    (c) => !texto || sinTildes(c.titulo).includes(texto) || sinTildes(c.nombre).includes(texto)
  );
  const fragmento = document.createDocumentFragment();
  const actual = cancionActual();
  for (const c of musica.cola) {
    const li = crear('li');
    if (actual?.id === c.id) li.classList.add('actual');
    li.append(crear('span', 'numero', actual?.id === c.id && !motor.paused ? '♪' : '♫'));
    const titulo = crear('span', 'titulo', c.titulo);
    titulo.append(crear('small', '', [c.subcarpeta, musica.carpetas.length > 1 ? c.carpeta : ''].filter(Boolean).join(' · ')));
    li.append(titulo);
    const marcas = crear('span', 'marcas');
    if (c.guardada) marcas.append(crear('span', 'ok', '⬇'));
    li.append(marcas);
    // 🌙 = usar esta canción como música de fondo
    const luna = crear('button', 'icono luna' + (Fondo.esDeFondo(c.id) ? ' si' : ''), '🌙');
    luna.title = Fondo.esDeFondo(c.id) ? 'Quitar de la música de fondo' : 'Usar como música de fondo';
    luna.onclick = (e) => {
      e.stopPropagation();
      const agregada = Fondo.alternarCancion(c);
      avisar(agregada ? `"${c.titulo}" quedó elegida como fondo (cámbialo en 🌙)` : `"${c.titulo}" ya no es opción de fondo`);
      pintarMusica();
    };
    li.append(luna);
    li.onclick = () => tocarCancion(c);
    fragmento.append(li);
  }
  $('#lista-musica').replaceChildren(fragmento);
  $('#vacio-musica').hidden = musica.cola.length > 0 || !musica.cargada;
}

$('#buscar-musica').addEventListener('input', pintarMusica);

function tocarCancion(c) {
  reproducir({
    fuente: 'musica',
    clave: `musica:${c.id}`,
    cancion: c,
    titulo: c.titulo,
    sub: c.subcarpeta || c.carpeta || 'Música',
    icono: '♫',
    src: `/medios/musica/${encodeURIComponent(c.id)}`,
  });
  $('#musica-titulo').textContent = c.titulo;
  $('#musica-carpeta').textContent = c.subcarpeta || c.carpeta;
  $('#barra-musica').hidden = false;
  pintarMusica();
}

function otraCancion(paso) {
  const cola = musica.cola.length ? musica.cola : musica.canciones;
  if (!cola.length) return;
  let i = cola.findIndex((c) => c.id === cancionActual()?.id);
  if (musica.aleatorio && cola.length > 1) {
    let azar;
    do azar = Math.floor(Math.random() * cola.length);
    while (azar === i);
    i = azar;
  } else {
    i = (i + paso + cola.length) % cola.length;
  }
  tocarCancion(cola[i]);
}

$('#btn-siguiente').onclick = () => otraCancion(1);
$('#btn-anterior').onclick = () => otraCancion(-1);

$('#btn-aleatorio').onclick = (e) => {
  musica.aleatorio = !musica.aleatorio;
  e.currentTarget.textContent = `🔀 Aleatorio: ${musica.aleatorio ? 'sí' : 'no'}`;
  e.currentTarget.setAttribute('aria-pressed', musica.aleatorio);
};

$('#btn-guardar-musica').onclick = async (e) => {
  const boton = e.currentTarget;
  const pendientes = musica.canciones.filter((c) => !c.guardada);
  if (!pendientes.length) return avisar('Todas las canciones ya están guardadas');
  boton.disabled = true;
  let fallos = 0;
  for (const [i, c] of pendientes.entries()) {
    boton.textContent = `Guardando ${i + 1} de ${pendientes.length}…`;
    try {
      await api(`/musica/guardar/${encodeURIComponent(c.id)}`, { method: 'POST' });
      c.guardada = true;
    } catch {
      fallos++;
    }
  }
  boton.disabled = false;
  boton.textContent = '⬇ Guardar todo sin internet';
  avisar(fallos ? `Listo, pero ${fallos} no se pudieron guardar` : 'Toda la música quedó guardada para usar sin internet');
  cargarMusica();
};

function pintarCarpetas() {
  const fragmento = document.createDocumentFragment();
  for (const carpeta of musica.carpetas) {
    const li = crear('li');
    const enlace = crear('a', '', carpeta.nombre);
    enlace.href = `https://drive.google.com/drive/folders/${carpeta.id}`;
    enlace.target = '_blank';
    enlace.rel = 'noopener';
    const nombre = crear('span');
    nombre.append(enlace);
    li.append(nombre);
    const quitar = crear('button', 'icono', '✕');
    quitar.title = 'Quitar carpeta';
    quitar.onclick = async () => {
      if (!confirm(`¿Quitar la carpeta "${carpeta.nombre}"? (No borra nada en Drive)`)) return;
      try {
        await api(`/musica/carpetas/${encodeURIComponent(carpeta.id)}`, { method: 'DELETE' });
        cargarMusica();
      } catch (error) {
        avisar(error.message);
      }
    };
    li.append(quitar);
    fragmento.append(li);
  }
  $('#lista-carpetas').replaceChildren(fragmento);
}

$('#form-carpeta').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const boton = form.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    await api('/musica/carpetas', { method: 'POST', body: { url: form.url.value } });
    form.url.value = '';
    avisar('Carpeta agregada');
    cargarMusica();
  } catch (error) {
    avisar(error.message);
  } finally {
    boton.disabled = false;
  }
};

// ---------- música de fondo (ajustes) ----------

const dialogoFondo = $('#dialogo-fondo');

function pintarAjustesFondo() {
  const a = Fondo.ajustes();
  $('#fondo-activo').checked = a.activo;
  $('#fondo-volumen').value = a.volumen;
  $('#fondo-espera').value = String(a.espera);
  // Una opción por cada pista de fondo disponible (incluidas + canciones marcadas con 🌙)
  const contenedor = $('#fondo-pistas');
  contenedor.replaceChildren(
    ...Fondo.pistas().map((p) => {
      const label = crear('label', 'interruptor');
      const radio = crear('input');
      Object.assign(radio, { type: 'radio', name: 'fondo-pista', value: p.id, checked: p.id === a.pista });
      radio.onchange = () => {
        Fondo.configurar({ pista: p.id });
        // Si otra música está sonando no se interrumpe: el fondo elegido entra cuando se pause
        if (otraMusicaSuena()) avisar(`Fondo: "${p.titulo}". Sonará cuando pauses lo que está sonando`);
      };
      const texto = crear('span', '', p.titulo);
      texto.append(crear('small', '', p.detalle));
      label.append(radio, texto);
      return label;
    })
  );
  // Probar no puede cortar un himno, una canción o un video que está sonando
  const ocupado = otraMusicaSuena();
  $('#fondo-probar').disabled = ocupado && !Fondo.estaSonando();
  $('#fondo-probar').textContent = Fondo.estaSonando() ? '■ Detener' : ocupado ? 'Pausa lo que suena para probar' : '▶ Probar ahora';
}

function otraMusicaSuena() {
  return !motor.paused || videoSonando();
}

$('#btn-fondo').onclick = () => {
  pintarAjustesFondo();
  dialogoFondo.showModal();
};
$('#fondo-activo').onchange = (e) => Fondo.configurar({ activo: e.target.checked });
$('#fondo-volumen').oninput = (e) => Fondo.configurar({ volumen: Number(e.target.value) });
$('#fondo-espera').onchange = (e) => Fondo.configurar({ espera: Number(e.target.value) });
$('#fondo-probar').onclick = () => {
  if (Fondo.estaSonando()) return Fondo.detener();
  if (otraMusicaSuena()) return; // nunca interrumpe lo que está sonando
  Fondo.cancelarEspera();
  Fondo.iniciar();
};

// Pistas propias de la carpeta musica-fondo
api('/fondo/pistas')
  .then((lista) => Fondo.cargarLocales(lista))
  .catch(() => Fondo.cargarLocales([]));

// El botón 🌙 de arriba muestra un puntito verde mientras el fondo suena
Fondo.alCambiar(({ sonando }) => {
  $('#btn-fondo').classList.toggle('sonando', sonando);
  if (dialogoFondo.open) pintarAjustesFondo();
});

// ---------- evitar que la máquina se suspenda mientras algo suena ----------
// Wake Lock: el navegador pide al sistema mantener la pantalla encendida.
// Solo se mantiene mientras la pestaña está visible; al volver a ella se pide de nuevo.

let bloqueoPantalla = null;

function algoSuena() {
  return !motor.paused || videoSonando() || Fondo.estaSonando();
}

async function actualizarBloqueoPantalla() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (algoSuena() && !bloqueoPantalla && document.visibilityState === 'visible') {
      bloqueoPantalla = await navigator.wakeLock.request('screen');
      bloqueoPantalla.addEventListener('release', () => (bloqueoPantalla = null));
    } else if (!algoSuena() && bloqueoPantalla) {
      await bloqueoPantalla.release();
      bloqueoPantalla = null;
    }
  } catch (error) {
    // Puede fallar si el sistema lo niega (por ejemplo, batería muy baja); no es grave
    console.warn('No se pudo evitar la suspensión:', error.message);
  }
}

['play', 'pause', 'ended'].forEach((e) => motor.addEventListener(e, actualizarBloqueoPantalla));
Fondo.alCambiar(actualizarBloqueoPantalla);
document.addEventListener('visibilitychange', actualizarBloqueoPantalla);
// YouTube no emite eventos al documento: se revisa cada pocos segundos
setInterval(actualizarBloqueoPantalla, 5000);

// ---------- presentación: letra sincronizada con el audio ----------
// Cada himno trae "tiempos": milisegundos en que se pasa a la página siguiente de la letra.
// Se aplica la misma regla del sitio de origen (segundo redondeado hacia abajo + 1 s de
// margen con comparación estricta): la página cambia justo en el segundo marcado.

const presentacion = { abierta: false, pagina: 0, capa: 'a', reloj: null, quietud: null };

// Página (1, 2, 3…) que corresponde al segundo t del audio
function paginaEn(himno, t) {
  const tiempos = himno?.tiempos || [];
  if (!tiempos.length) return null; // sin datos de tiempo: se pasa a mano
  const ms = Math.floor(t) * 1000;
  return Math.min(himno.diapositivas, 1 + tiempos.filter((x) => x < ms + 1000).length);
}

// Segundo del audio donde empieza la página n
function inicioDePagina(himno, n) {
  if (n <= 1 || !himno?.tiempos?.length) return 0;
  return himno.tiempos[n - 2] / 1000;
}

const urlPagina = (himno, n) => `/medios/${himno.numero}/letra-${String(n).padStart(2, '0')}.jpg`;
const esteHimnoSuena = () => pista?.fuente === 'himno' && pista.numero === estado.actual?.numero;

function mostrarPagina(n, instantaneo = false) {
  const h = estado.actual;
  if (!h || n === presentacion.pagina) return;
  presentacion.pagina = n;
  // Dos imágenes encimadas: la nueva aparece mientras la anterior se desvanece
  const siguiente = presentacion.capa === 'a' ? $('#pres-b') : $('#pres-a');
  const actual = presentacion.capa === 'a' ? $('#pres-a') : $('#pres-b');
  siguiente.style.transition = instantaneo ? 'none' : '';
  siguiente.src = urlPagina(h, n);
  siguiente.alt = `${h.titulo} - página ${n} de ${h.diapositivas}`;
  const cambiar = () => {
    siguiente.classList.add('visible');
    actual.classList.remove('visible');
    presentacion.capa = presentacion.capa === 'a' ? 'b' : 'a';
  };
  if (siguiente.complete && siguiente.naturalWidth) cambiar();
  else siguiente.onload = cambiar;
  // Precarga la página que viene para que el cambio sea inmediato
  if (n < h.diapositivas) new Image().src = urlPagina(h, n + 1);
  $('#pres-pagina-num').textContent = `${n}/${h.diapositivas}`;
}

function sincronizarPresentacion() {
  const h = estado.actual;
  if (!presentacion.abierta || !h) return;
  const suena = esteHimnoSuena();
  if (suena) {
    const n = paginaEn(h, motor.currentTime);
    if (n) mostrarPagina(n);
  }
  $('#pres-play').textContent = suena && !motor.paused ? '⏸' : '▶';
  const barra = $('#pres-barra');
  pintarBarra(barra, suena ? motor.currentTime : 0, suena ? motor.duration : NaN);
  if (!barra.arrastrando) $('#pres-tiempo').textContent = formatoTiempo(suena ? motor.currentTime : 0);
}

function abrirPresentacion() {
  const h = estado.actual;
  if (!h) return;
  presentacion.abierta = true;
  presentacion.pagina = 0;
  $('#pres-titulo').textContent = `${h.numero}. ${h.titulo}`;
  $('#presentacion').hidden = false;
  // Si este himno no estaba sonando, empieza desde el principio
  if (!esteHimnoSuena()) reproducir(pistaDeHimno(h, estado.tipo));
  mostrarPagina(paginaEn(h, esteHimnoSuena() ? motor.currentTime : 0) || 1, true);
  clearInterval(presentacion.reloj);
  presentacion.reloj = setInterval(sincronizarPresentacion, 100); // como el sitio: cada 100 ms
  despertarControles();
  if (!h.tiempos?.length) avisar('Este himno no trae tiempos: pasa las páginas con ⏮ ⏭ o las flechas');
}

function cerrarPresentacion() {
  presentacion.abierta = false;
  clearInterval(presentacion.reloj);
  $('#presentacion').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// Pasar de página a mano: con tiempos, lleva el audio a esa parte; sin tiempos, solo cambia la imagen
function irAPagina(n) {
  const h = estado.actual;
  if (!h) return;
  n = Math.max(1, Math.min(h.diapositivas, n));
  if (h.tiempos?.length && esteHimnoSuena()) {
    motor.currentTime = inicioDePagina(h, n);
  }
  mostrarPagina(n);
}

// Controles que se esconden solos después de 3 s sin mover el mouse
function despertarControles() {
  $('#presentacion').classList.remove('quieta');
  clearTimeout(presentacion.quietud);
  presentacion.quietud = setTimeout(() => $('#presentacion').classList.add('quieta'), 3000);
}

$('#btn-presentacion').onclick = abrirPresentacion;
$('#pres-cerrar').onclick = cerrarPresentacion;
$('#pres-play').onclick = () => {
  if (esteHimnoSuena()) alternarReproduccion();
  else reproducir(pistaDeHimno(estado.actual, estado.tipo));
};
$('#pres-anterior').onclick = () => irAPagina((presentacion.pagina || 1) - 1);
$('#pres-siguiente').onclick = () => irAPagina((presentacion.pagina || 1) + 1);
$('#pres-pantalla').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $('#presentacion').requestFullscreen().catch(() => avisar('El navegador no permitió la pantalla completa'));
};
$('#presentacion').addEventListener('mousemove', despertarControles);
$('#presentacion').addEventListener('click', despertarControles);
conectarBarra($('#pres-barra'), {
  duracion: () => (esteHimnoSuena() ? motor.duration : NaN),
  saltar: (s) => (motor.currentTime = s),
  previsualizar: (s) => ($('#pres-tiempo').textContent = formatoTiempo(s)),
});
document.addEventListener('keydown', (e) => {
  if (!presentacion.abierta) return;
  if (e.key === 'Escape') cerrarPresentacion();
  else if (e.key === 'ArrowRight') irAPagina((presentacion.pagina || 1) + 1);
  else if (e.key === 'ArrowLeft') irAPagina((presentacion.pagina || 1) - 1);
  else if (e.code === 'Space') {
    e.preventDefault();
    $('#pres-play').click();
  } else return;
  despertarControles();
});
// Al salir de pantalla completa con Esc del navegador, la presentación sigue abierta en la ventana

// En la vista normal del himno, se resalta la miniatura de la página que está sonando
motor.addEventListener('timeupdate', () => {
  if (!esteHimnoSuena() || vistaActiva() !== 'vista-himno') return;
  const n = paginaEn(estado.actual, motor.currentTime);
  document.querySelectorAll('#letra img').forEach((img, i) => img.classList.toggle('sonando', i + 1 === n));
});

// ---------- inicio ----------

cargarLista().then(seguirRuta);
