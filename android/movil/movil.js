// Ajustes para la APK de Android. Se agrega a index.html al compilar la app;
// el proyecto Himnario original no se modifica.
// Usa funciones globales de app.js (volver, cerrarPresentacion…) y el puente "Android" de MainActivity.

(() => {
  const $ = (s) => document.querySelector(s);

  // En el celular, los botones de sección muestran solo el ícono (el texto queda como ayuda)
  const soloIcono = (sel, icono) => {
    const b = $(sel);
    if (b) b.textContent = icono;
  };
  soloIcono('#btn-ir-musica', '♫');
  soloIcono('#btn-ir-videos', '▶');

  // Botón "atrás" de Android: cierra lo que esté abierto, si no vuelve a la pantalla anterior.
  // Devuelve 'salir' cuando ya está en la lista principal (la app se va al fondo).
  window.androidAtras = () => {
    if (typeof presentacion !== 'undefined' && presentacion.abierta) {
      cerrarPresentacion();
      return 'ok';
    }
    const dialogo = document.querySelector('dialog[open]');
    if (dialogo) {
      dialogo.close();
      return 'ok';
    }
    const visor = $('#visor');
    if (visor && !visor.hidden) {
      visor.hidden = true;
      return 'ok';
    }
    if (location.hash && location.hash !== '#') {
      volver();
      return 'ok';
    }
    return 'salir';
  };

  // ¿Lo que manda ahora es un video de YouTube (y no el audio)?
  const manda = () =>
    typeof ultimaFuente !== 'undefined' && ultimaFuente === 'video' && typeof videoActual !== 'undefined' && videoActual && typeof reproductor !== 'undefined' && reproductor?.getPlayerState
      ? 'video'
      : 'audio';

  // Botones ⏮ ⏯ ⏭ de la notificación y de la ventanita PiP (los manda MainActivity)
  window.androidAccion = (accion) => {
    if (manda() === 'video') {
      const j = reproductor;
      if (accion === 'alternar') {
        if (j.getPlayerState() === 1) j.pauseVideo();
        else j.playVideo();
      } else if (videoActual.tipo === 'lista' && idsDeLista.length) {
        // Siguiente o anterior saltando los videos marcados como no disponibles
        const paso = accion === 'siguiente' ? 1 : -1;
        const total = idsDeLista.length;
        let i = j.getPlaylistIndex();
        for (let k = 0; k < total; k++) {
          i = (i + paso + total) % total;
          if (!motivoNoDisponible(idsDeLista[i])) {
            j.playVideoAt(i);
            break;
          }
        }
      }
    } else if (accion === 'alternar') {
      alternarReproduccion();
    } else {
      pasoDePista(accion === 'siguiente' ? 1 : -1);
    }
    setTimeout(informar, 400);
  };

  // En la ventanita PiP de Android solo se ve el video, ocupando todo
  window.androidPip = (activo) => {
    document.body.classList.toggle('en-pip', activo);
    if (!activo && typeof ubicarVideo === 'function') setTimeout(ubicarVideo, 100);
  };

  // Se le avisa a Android qué suena: así muestra la notificación con ⏮ ⏯ ⏭, no corta la música
  // con la pantalla apagada y, si es un video, pasa a la ventanita PiP al salir de la app
  let ultimo = '';
  function informar() {
    if (!window.Android?.reproduccion) return;
    let titulo, detalle, sonando, conPasos;
    if (manda() === 'video') {
      const id = reproductor.getVideoData?.()?.video_id;
      titulo = titulosDeLista[id]?.titulo || reproductor.getVideoData?.()?.title || videoActual.titulo;
      detalle = videoActual.tipo === 'lista' ? `YouTube · ${videoActual.titulo}` : 'YouTube';
      sonando = reproductor.getPlayerState() === 1;
      conPasos = videoActual.tipo === 'lista';
    } else if (typeof pista !== 'undefined' && pista) {
      titulo = pista.titulo;
      detalle = pista.sub || '';
      sonando = !$('#motor').paused;
      conPasos = typeof tienePasos === 'function' ? tienePasos() : pista.fuente === 'musica';
    } else {
      if (ultimo) Android.sinReproduccion();
      ultimo = '';
      Android.estadoVideo?.(false, '');
      return;
    }
    Android.estadoVideo?.(manda() === 'video' && sonando, manda() === 'video' ? titulo : '');
    const estadoAhora = `${titulo}|${detalle}|${sonando}|${conPasos}`;
    if (estadoAhora === ultimo) return; // sin cambios: no se molesta a Android
    ultimo = estadoAhora;
    Android.reproduccion(titulo || 'LasAmericas', detalle, sonando, conPasos);
  }
  ['play', 'pause', 'ended', 'loadedmetadata'].forEach((e) => $('#motor')?.addEventListener(e, informar));
  // YouTube no avisa sus cambios a la página: se revisa cada segundo
  setInterval(informar, 1000);

  // Pantalla encendida mientras algo suena (en Android el Wake Lock del navegador no está disponible)
  if (window.Android?.mantenerPantalla) {
    let encendida = null;
    const revisar = () => {
      const suena = typeof algoSuena === 'function' ? algoSuena() : false;
      if (suena !== encendida) {
        encendida = suena;
        Android.mantenerPantalla(suena);
      }
    };
    ['play', 'pause', 'ended'].forEach((e) => $('#motor')?.addEventListener(e, revisar));
    setInterval(revisar, 3000);
  }
})();
