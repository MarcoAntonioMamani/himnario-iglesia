// Ventana flotante "siempre encima" (Document Picture-in-Picture de Chrome/Edge).
// Se puede mover a cualquier lugar de la pantalla, queda por encima de las demás ventanas
// (PowerPoint, proyector) y sigue funcionando aunque se minimice el navegador.
// Controla lo que esté sonando: himno, canción o video de YouTube.
//
// Videos: un iframe de YouTube no se puede mover entre ventanas sin recargarse, así que al
// abrir la ventana se crea en ella un segundo reproductor oficial que sigue en el mismo
// video, segundo y posición de la lista; el de la página se pausa. Al cerrar la ventana,
// el video vuelve a la página donde quedó.
//
// Nota: si se cierra el navegador por completo, se cierra con él (vive dentro del navegador).
// Developed by Marco Antonio Mamani

const VentanaFlotante = (() => {
  const soportada = 'documentPictureInPicture' in window;
  let ventana = null;
  let elementos = null;
  let reloj = null;
  let arrastrando = false;

  // Video dentro de la ventana
  let ytVentana = null; // reproductor de YouTube creado en la ventana
  let modoVideo = false; // true mientras el video se ve en la ventana
  let apiEnVentana = null;

  let abrirSola = true;
  try {
    abrirSola = localStorage.getItem('himnario-flotante-auto') !== 'no';
  } catch {
    /* sin almacenamiento: queda activado */
  }

  const ESTILOS = `
    :root { --primario:#2b5d8a; --en-primario:#fff; --fondo:#f8f9ff; --texto:#191c20; --suave:#42474e; --boton:#e6ebf3; color-scheme: light; }
    @media (prefers-color-scheme: dark) { :root { --primario:#9ccaff; --en-primario:#003256; --fondo:#16191d; --texto:#e1e2e8; --suave:#c2c7cf; --boton:#2a2e33; color-scheme: dark; } }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body { font-family: "Segoe UI", Roboto, system-ui, sans-serif; background: var(--fondo); color: var(--texto);
           display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 12px 14px; user-select: none; overflow: hidden; }
    body.modo-video { justify-content: flex-start; padding: 0 0 10px; gap: 6px; }
    body.modo-video > :not(.video) { padding: 0 12px; }
    body.modo-video .portada, body.modo-letra .portada { display: none; }
    .video, .letra { display: none; width: 100%; flex: 1 1 auto; min-height: 120px; background: #000; }
    body.modo-video .video { display: block; }
    body.modo-letra:not(.modo-video) .letra { display: block; }
    body.modo-letra { justify-content: flex-start; padding: 0 0 10px; gap: 6px; }
    body.modo-letra > :not(.letra):not(.video) { padding: 0 12px; }
    body.modo-letra .pie { display: none; }
    .video iframe { width: 100%; height: 100%; border: 0; display: block; }
    .letra img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .arriba { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .portada { width: 52px; height: 52px; border-radius: 10px; flex: none; display: grid; place-items: center; overflow: hidden;
               background: var(--primario); color: var(--en-primario); font-weight: 700; font-size: 1.1rem; }
    .portada img { width: 100%; height: 100%; object-fit: cover; }
    .textos { min-width: 0; flex: 1; }
    .titulo, .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .titulo { font-weight: 600; font-size: .95rem; }
    .sub { color: var(--suave); font-size: .78rem; }
    .volver { border: none; background: none; color: var(--primario); font-size: 1.2rem; cursor: pointer; padding: 4px; border-radius: 8px; }
    .volver:hover { background: var(--boton); }
    .barra { display: flex; align-items: center; gap: 8px; font-size: .78rem; color: var(--suave); font-variant-numeric: tabular-nums; }
    .barra input { flex: 1; accent-color: var(--primario); cursor: pointer; margin: 0; }
    .controles { display: flex; justify-content: center; align-items: center; gap: 10px; }
    .controles button { border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1rem; cursor: pointer;
                        background: var(--boton); color: var(--texto); display: grid; place-items: center; }
    .controles .play { width: 48px; height: 48px; font-size: 1.25rem; background: var(--primario); color: var(--en-primario); }
    .controles button:disabled { opacity: .35; cursor: default; }
    .pie { display: flex; justify-content: center; font-size: .72rem; color: var(--suave); }
    .pie label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    body.modo-video .pie { display: none; }
  `;

  // El reproductor de video que manda: el de la ventana si el video está ahí, si no el de la página
  const yt = () => (modoVideo && ytVentana ? ytVentana : reproductor);

  // ----- qué está sonando ahora (audio del motor o video de YouTube) -----

  function fuenteActual() {
    const jugador = yt();
    if (ultimaFuente === 'video' && videoActual && jugador?.getPlayerState) {
      const enLista = videoActual.tipo === 'lista';
      const indice = enLista ? jugador.getPlaylistIndex() : -1;
      const id = jugador.getVideoData?.()?.video_id || (enLista ? idsDeLista[indice] : videoActual.id);
      return {
        tipo: 'video',
        titulo: titulosDeLista[id]?.titulo || jugador.getVideoData?.()?.title || videoActual.titulo,
        sub: enLista ? `Video ${indice + 1} de ${idsDeLista.length} · ${videoActual.titulo}` : 'Video de YouTube',
        portada: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null,
        icono: '▶',
        sonando: jugador.getPlayerState() === 1,
        actual: jugador.getCurrentTime?.() || 0,
        total: jugador.getDuration?.() || 0,
        conPasos: enLista,
      };
    }
    if (pista) {
      // Himno: la página de letra que corresponde a este segundo (misma regla que la presentación)
      let letra = null;
      if (pista.fuente === 'himno' && pista.diapositivas) {
        const n = paginaEn(pista, motor.currentTime) || 1;
        letra = { url: urlPagina(pista, n), pagina: n, total: pista.diapositivas };
      }
      return {
        tipo: 'audio',
        titulo: pista.titulo,
        sub: letra ? `${pista.sub} · página ${letra.pagina} de ${letra.total}` : pista.sub,
        portada: null,
        icono: pista.icono,
        letra,
        sonando: !motor.paused,
        actual: motor.currentTime,
        total: motor.duration,
        conPasos: tienePasos(),
      };
    }
    return null;
  }

  // ----- acciones (se ejecutan en la página principal) -----

  function alternar() {
    const f = fuenteActual();
    if (!f) return;
    if (f.tipo === 'video') {
      if (f.sonando) yt().pauseVideo();
      else yt().playVideo();
    } else {
      alternarReproduccion();
    }
    setTimeout(pintar, 150);
  }

  function paso(n) {
    const f = fuenteActual();
    if (!f?.conPasos) return;
    if (f.tipo === 'audio') return pasoDePista(n);
    // En listas de YouTube se saltan los videos marcados como no disponibles
    const total = idsDeLista.length;
    let i = yt().getPlaylistIndex();
    for (let k = 0; k < total; k++) {
      i = (i + n + total) % total;
      if (!motivoNoDisponible(idsDeLista[i])) return yt().playVideoAt(i);
    }
  }

  function saltarA(segundos) {
    const f = fuenteActual();
    if (!f) return;
    if (f.tipo === 'video') yt().seekTo(segundos, true);
    else motor.currentTime = segundos;
  }

  // Volver a la app en la pantalla de lo que suena
  function volverALaApp() {
    window.focus();
    const f = fuenteActual();
    if (f?.tipo === 'video') abrirVideos();
    else if (pista?.fuente === 'musica') abrirMusica();
    else if (pista?.fuente === 'himno') abrirHimno(pista.numero);
  }

  // ----- video dentro de la ventana -----

  // YouTube rechaza reproductores en páginas sin dirección (la ventana flotante es una página
  // en blanco). Por eso el reproductor va dentro de video-flotante.html, que sí tiene la
  // dirección de la app, cargada en un iframe de la ventana. Desde aquí se controla directo.
  function crearJugadorEnVentana() {
    if (!apiEnVentana) {
      apiEnVentana = new Promise((resolve, reject) => {
        const marco = ventana.document.createElement('iframe');
        marco.src = '/video-flotante.html';
        marco.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        marco.title = 'Video';
        const limite = setTimeout(() => reject(new Error('El video tardó demasiado en cargar. ¿Hay internet?')), 20000);
        marco.onload = () => {
          marco.contentWindow
            .crearJugador({
              alCambiarEstado: alCambiarEstadoEnVentana,
              alError: alErrorEnVentana,
            })
            .then((jugador) => {
              clearTimeout(limite);
              resolve(jugador);
            }, reject);
        };
        elementos.video.replaceChildren(marco);
      });
    }
    return apiEnVentana;
  }

  // Datos para continuar el video en otro reproductor: qué video, en qué segundo, si sonaba
  function estadoDeVideo(jugador) {
    const enLista = videoActual?.tipo === 'lista';
    return {
      enLista,
      lista: enLista ? videoActual.id : null,
      indice: enLista ? Math.max(0, jugador.getPlaylistIndex?.() ?? 0) : 0,
      id: jugador.getVideoData?.()?.video_id || videoActual?.id,
      segundo: Math.floor(jugador.getCurrentTime?.() || 0),
      sonaba: [1, 3].includes(jugador.getPlayerState?.()),
    };
  }

  function continuarEn(jugador, e) {
    if (e.enLista) {
      const datos = { list: e.lista, listType: 'playlist', index: e.indice, startSeconds: e.segundo };
      if (e.sonaba) jugador.loadPlaylist(datos);
      else jugador.cuePlaylist(datos);
    } else {
      const datos = { videoId: e.id, startSeconds: e.segundo };
      if (e.sonaba) jugador.loadVideoById(datos);
      else jugador.cueVideoById(datos);
    }
  }

  async function pasarVideoAVentana() {
    if (!ventana || !videoActual || !reproductor?.getPlayerState) return;
    const e = estadoDeVideo(reproductor);
    reproductor.pauseVideo();
    // Mientras el video se ve en la ventana, el de la página queda mudo: si se elige otro
    // video, arranca un instante en la página antes de pasar aquí y no debe oírse doble
    reproductor.mute();
    modoVideo = true;
    ventana.document.body.classList.add('modo-video');
    actualizarFlotantes(); // en la página se oculta el video
    try {
      const jugador = await crearJugadorEnVentana();
      if (!ventana) return;
      ytVentana = jugador;
      continuarEn(ytVentana, e);
      // Si Chrome no deja arrancar solo con sonido, se avisa que toque ▶ en la ventanita
      if (e.sonaba) {
        setTimeout(() => {
          if (modoVideo && ytVentana?.getPlayerState?.() !== 1) avisarEnVentana('Toca ▶ para continuar el video');
        }, 4000);
      }
    } catch (error) {
      // Si no se pudo, el video sigue en la página como antes
      modoVideo = false;
      ventana?.document.body.classList.remove('modo-video');
      actualizarFlotantes();
      if (e.sonaba) reproductor.playVideo();
      avisar(error.message);
    }
  }

  // Al cerrar la ventana el video vuelve a la página, en el punto donde quedó
  function devolverVideoALaPagina() {
    if (!modoVideo || !ytVentana) return;
    const e = estadoDeVideo(ytVentana);
    modoVideo = false;
    ytVentana = null;
    apiEnVentana = null;
    actualizarFlotantes();
    if (reproductor) {
      reproductor.unMute();
      continuarEn(reproductor, e);
    }
  }

  // Mensaje corto en la ventanita (en lugar del subtítulo) por unos segundos
  function avisarEnVentana(texto) {
    if (!elementos) return;
    elementos.sub.textContent = texto;
    elementos.sub.dataset.aviso = String(Date.now() + 4000);
  }

  function alCambiarEstadoEnVentana(ev) {
    if (ev.data === 1) {
      // Igual que en la página: al sonar el video, se calla el audio y el fondo
      ultimaFuente = 'video';
      Fondo.detener();
      motor.pause();
    } else if (ev.data === 2 || ev.data === 0) {
      revisarSilencio();
    }
    pintar();
  }

  // Mismo criterio que en la página: se marca como no disponible y se salta al siguiente
  function alErrorEnVentana(codigo) {
    const estado = codigo === 100 ? 'no-existe' : codigo === 101 || codigo === 150 ? 'no-embebible' : 'error';
    const id = ytVentana?.getVideoData?.()?.video_id;
    if (id) {
      titulosDeLista[id] = { ...(titulosDeLista[id] || {}), estado };
      api('/videos/no-disponible', { method: 'POST', body: { id, estado } }).catch(() => {});
      pintarVideosDeLista();
      pintarVideos();
    }
    avisar(MOTIVOS_NO_DISPONIBLE[estado] + (videoActual?.tipo === 'lista' ? '. Pasando al siguiente…' : ''));
    if (videoActual?.tipo === 'lista') setTimeout(() => paso(1), 1500);
  }

  // ----- la ventana -----

  async function abrir() {
    if (!soportada) {
      avisar('Este navegador no permite ventanas flotantes. Usa Google Chrome o Microsoft Edge.');
      return;
    }
    if (ventana) {
      ventana.focus();
      return;
    }
    const hayVideo = ultimaFuente === 'video' && videoActual;
    // Con video o con letra de himno la ventana es grande (16:9 + controles); con música, compacta
    const grande = hayVideo || pista?.fuente === 'himno' || pendienteVideo;
    ventana = await documentPictureInPicture.requestWindow(grande ? { width: 480, height: 400 } : { width: 380, height: 190 });
    pendienteVideo = false;
    const doc = ventana.document;
    doc.title = 'Himnario';
    const estilo = doc.createElement('style');
    estilo.textContent = ESTILOS;
    doc.head.append(estilo);
    doc.body.innerHTML = `
      <div class="video jugador"></div>
      <div class="letra"><img alt=""></div>
      <div class="arriba">
        <div class="portada"></div>
        <div class="textos"><div class="titulo"></div><div class="sub"></div></div>
        <button class="volver" title="Volver a la app">⤢</button>
      </div>
      <div class="barra"><span class="t-actual">0:00</span><input type="range" min="0" max="1000" value="0" aria-label="Posición"><span class="t-total">0:00</span></div>
      <div class="controles">
        <button class="anterior" title="Anterior">⏮</button>
        <button class="play" title="Reproducir o pausar">▶</button>
        <button class="siguiente" title="Siguiente">⏭</button>
      </div>
      <div class="pie"><label><input type="checkbox" class="auto"> Abrir esta ventana sola al reproducir</label></div>`;
    const $v = (s) => doc.querySelector(s);
    elementos = {
      video: $v('.jugador'), letra: $v('.letra img'), portada: $v('.portada'), titulo: $v('.titulo'), sub: $v('.sub'), actual: $v('.t-actual'),
      total: $v('.t-total'), barra: $v('.barra input'), play: $v('.play'), anterior: $v('.anterior'),
      siguiente: $v('.siguiente'), auto: $v('.auto'),
    };
    elementos.play.onclick = alternar;
    elementos.anterior.onclick = () => paso(-1);
    elementos.siguiente.onclick = () => paso(1);
    $v('.volver').onclick = volverALaApp;
    elementos.auto.checked = abrirSola;
    elementos.auto.onchange = () => {
      abrirSola = elementos.auto.checked;
      try {
        localStorage.setItem('himnario-flotante-auto', abrirSola ? 'si' : 'no');
      } catch {
        /* no importa */
      }
    };
    // Barra: al arrastrar se previsualiza el tiempo; al soltar se salta
    elementos.barra.addEventListener('input', () => {
      arrastrando = true;
      const f = fuenteActual();
      if (f) elementos.actual.textContent = formatoTiempo((elementos.barra.value / 1000) * f.total);
    });
    elementos.barra.addEventListener('change', () => {
      arrastrando = false;
      const f = fuenteActual();
      if (f && Number.isFinite(f.total) && f.total > 0) saltarA((elementos.barra.value / 1000) * f.total);
    });
    // Barra espaciadora = play/pausa, flechas = ±10 s (cuando la ventanita tiene el foco)
    doc.addEventListener('keydown', (e) => {
      if (e.target === elementos.barra) return;
      const f = fuenteActual();
      if (e.code === 'Space') { e.preventDefault(); alternar(); }
      if (f && e.code === 'ArrowRight') saltarA(Math.min(f.actual + 10, f.total || f.actual + 10));
      if (f && e.code === 'ArrowLeft') saltarA(Math.max(f.actual - 10, 0));
    });

    ventana.addEventListener('pagehide', () => {
      clearInterval(reloj);
      cerradaEn = Date.now();
      devolverVideoALaPagina();
      ventana = null;
      elementos = null;
      ultimaPortada = '';
    });
    reloj = setInterval(pintar, 250);
    pintar();
    if (hayVideo) pasarVideoAVentana();
  }

  let ultimaPortada = '';

  // La ventana abierta en tamaño chico (audio) se agranda para mostrar video o letra.
  // Chrome puede no permitirlo sin un toque; entonces queda como está y se puede estirar a mano.
  function agrandar() {
    if (!ventana || ventana.innerHeight >= 330) return;
    try {
      ventana.resizeTo(480, 400);
    } catch {
      /* el navegador no lo permitió: se puede agrandar arrastrando el borde */
    }
  }

  function pintar() {
    if (!elementos) return;
    const f = fuenteActual();
    if (!f) {
      elementos.titulo.textContent = 'Nada sonando';
      elementos.sub.textContent = 'Elige un himno, una canción o un video';
      elementos.play.disabled = elementos.anterior.disabled = elementos.siguiente.disabled = elementos.barra.disabled = true;
      return;
    }
    // Modo letra: la página del himno que suena, en grande
    const conLetra = Boolean(f.letra) && !modoVideo;
    const cuerpo = elementos.letra.ownerDocument.body;
    if (conLetra && !cuerpo.classList.contains('modo-letra')) agrandar();
    cuerpo.classList.toggle('modo-letra', conLetra);
    if (conLetra && !elementos.letra.src.endsWith(f.letra.url)) {
      elementos.letra.src = f.letra.url;
      elementos.letra.alt = `Letra, página ${f.letra.pagina} de ${f.letra.total}`;
      // Precarga la siguiente para que el cambio sea inmediato
      if (f.letra.pagina < f.letra.total) new Image().src = urlPagina(pista, f.letra.pagina + 1);
    }
    elementos.titulo.textContent = f.titulo || '';
    // Un aviso reciente tiene prioridad sobre el subtítulo normal
    if (Date.now() > Number(elementos.sub.dataset.aviso || 0)) elementos.sub.textContent = f.sub || '';
    const portada = f.portada || `icono:${f.icono}`;
    if (portada !== ultimaPortada) {
      ultimaPortada = portada;
      elementos.portada.replaceChildren();
      if (f.portada) {
        const img = elementos.portada.ownerDocument.createElement('img');
        img.src = f.portada;
        img.alt = '';
        elementos.portada.append(img);
      } else {
        elementos.portada.textContent = f.icono || '♫';
      }
    }
    elementos.play.disabled = false;
    elementos.play.textContent = f.sonando ? '⏸' : '▶';
    elementos.anterior.disabled = elementos.siguiente.disabled = !f.conPasos;
    const valido = Number.isFinite(f.total) && f.total > 0;
    elementos.barra.disabled = !valido;
    if (!arrastrando) {
      elementos.barra.value = valido ? Math.round((f.actual / f.total) * 1000) : 0;
      elementos.actual.textContent = formatoTiempo(f.actual);
    }
    elementos.total.textContent = formatoTiempo(f.total);
  }

  // Abrir sola al reproducir. El navegador solo lo permite justo después de un toque
  // del usuario; si no (por ejemplo cuando pasa sola a la siguiente canción), no pasa nada.
  let cerradaEn = 0;

  async function alReproducir() {
    if (!abrirSola || ventana || !soportada || !navigator.userActivation?.isActive) return;
    // Recién cerrada: el video que vuelve a la página no debe reabrirla
    if (Date.now() - cerradaEn < 5000) return;
    try {
      await abrir();
    } catch {
      /* el navegador no lo permitió en este momento */
    }
  }

  // Un video empezó a sonar en la página: si la ventana está abierta, se pasa a ella.
  // También cuando la ventana ya mostraba otro video: el nuevo lo reemplaza.
  function alSonarVideoPrincipal() {
    if (ventana) pasarVideoAVentana();
    else alReproducir();
  }

  motor.addEventListener('play', alReproducir);

  // Videos: la ventana se abre en el mismo toque al elegir un video o una lista (si se espera
  // a que YouTube arranque, Chrome puede ya no permitir abrirla). Cuando el video empieza
  // en la página, alSonarVideoPrincipal lo pasa a la ventana.
  let pendienteVideo = false;
  document.addEventListener('click', (e) => {
    const item = e.target.closest('#lista-videos li, #videos-de-lista li');
    if (!item || item.classList.contains('no-disponible') || e.target.closest('button')) return;
    pendienteVideo = true;
    alReproducir();
  }, true);

  document.querySelectorAll('.btn-ventana').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      abrir().catch(() => avisar('Este navegador no pudo abrir la ventana flotante. Ábrela desde Google Chrome o Microsoft Edge.'));
    });
  });

  // ----- controles del sistema (recuadro multimedia de Windows y teclas del teclado) -----
  // Se agrega adelantar/retrasar y la posición de la canción
  if ('mediaSession' in navigator) {
    const acciones = {
      seekto: (d) => saltarA(d.seekTime),
      seekbackward: (d) => { const f = fuenteActual(); if (f) saltarA(Math.max(f.actual - (d.seekOffset || 10), 0)); },
      seekforward: (d) => { const f = fuenteActual(); if (f) saltarA(f.actual + (d.seekOffset || 10)); },
      previoustrack: () => paso(-1),
      nexttrack: () => paso(1),
    };
    for (const [accion, fn] of Object.entries(acciones)) {
      try {
        navigator.mediaSession.setActionHandler(accion, fn);
      } catch {
        /* el navegador no soporta esa acción */
      }
    }
    motor.addEventListener('timeupdate', () => {
      if (!Number.isFinite(motor.duration) || motor.duration <= 0) return;
      try {
        navigator.mediaSession.setPositionState({ duration: motor.duration, position: Math.min(motor.currentTime, motor.duration), playbackRate: 1 });
      } catch {
        /* posición inválida mientras carga */
      }
    });
  }

  if (!soportada) document.querySelectorAll('.btn-ventana').forEach((b) => (b.hidden = true));

  return {
    abrir,
    estaAbierta: () => Boolean(ventana),
    soportada,
    videoEnVentana: () => modoVideo,
    videoSonando: () => modoVideo && ytVentana?.getPlayerState?.() === 1,
    pausarVideo: () => ytVentana?.pauseVideo?.(),
    alSonarVideoPrincipal,
  };
})();
