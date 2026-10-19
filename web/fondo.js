// Música de fondo: suena sola cuando nada más está sonando.
// Se elige UNA pista de fondo entre:
//  - Pistas incluidas, generadas aquí mismo con Web Audio (sin archivos, sin internet):
//      · "Ambiente suave": pad de acordes suspendidos, ni triste ni alegre.
//      · "Sublime gracia": arreglo instrumental propio de la melodía "New Britain" (1829),
//        de dominio público, tocada lenta con timbre de flauta sobre acordes suaves.
//  - Canciones de ♫ Música marcadas con 🌙 (se repiten en bucle).
// Developed by Marco Antonio Mamani

const Fondo = (() => {
  const VERSION_AJUSTES = 3;
  // Pista prioritaria: va primera en la lista y es la elegida por defecto.
  // Si el archivo no está en la carpeta musica-fondo, se usa Sublime gracia.
  const PISTA_PRIORITARIA = 'local:LlamadoSermon.mp3';
  const PISTA_RESPALDO = 'sublime-gracia';
  const AJUSTES_POR_DEFECTO = { version: VERSION_AJUSTES, activo: true, volumen: 0.25, espera: 3, pista: PISTA_PRIORITARIA, canciones: [] };
  let ajustes = { ...AJUSTES_POR_DEFECTO };
  try {
    const guardados = JSON.parse(localStorage.getItem('himnario-fondo') || '{}');
    delete guardados.fuente; // formato anterior
    // Ajustes guardados antes de que existiera la pista prioritaria: se pasa a ella
    if ((guardados.version || 1) < VERSION_AJUSTES) {
      guardados.pista = PISTA_PRIORITARIA;
      guardados.version = VERSION_AJUSTES;
    }
    ajustes = { ...AJUSTES_POR_DEFECTO, ...guardados };
  } catch {
    /* sin almacenamiento: se usan los valores por defecto */
  }

  let sonando = false;
  let pistaSonando = null;
  let temporizadorEspera = null;
  const avisos = new Set();

  function guardar() {
    try {
      localStorage.setItem('himnario-fondo', JSON.stringify(ajustes));
    } catch {
      /* no importa si no se puede guardar */
    }
  }

  function notificar() {
    avisos.forEach((fn) => fn({ sonando, ...ajustes }));
  }

  // ===================== Motor de sonido generado (Web Audio) =====================

  let ctx = null;
  let salida = null; // ganancia general: aquí se hacen los fade in/out
  let voces = [];
  let relojes = [];

  const frecuencia = (midi) => 440 * 2 ** ((midi - 69) / 12);

  function crearReverb() {
    // Respuesta al impulso: ruido que se apaga en ~4 s (sala grande y cálida)
    const largo = ctx.sampleRate * 4;
    const impulso = ctx.createBuffer(2, largo, ctx.sampleRate);
    for (let canal = 0; canal < 2; canal++) {
      const datos = impulso.getChannelData(canal);
      for (let i = 0; i < largo; i++) datos[i] = (Math.random() * 2 - 1) * (1 - i / largo) ** 2.5;
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulso;
    return conv;
  }

  function prepararAudio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    salida = ctx.createGain();
    salida.gain.value = 0;
    const compresor = ctx.createDynamicsCompressor();
    compresor.threshold.value = -18;
    compresor.ratio.value = 3;
    const reverb = crearReverb();
    const mezclaReverb = ctx.createGain();
    mezclaReverb.gain.value = 0.55;
    reverb.connect(mezclaReverb).connect(compresor);
    salida.connect(compresor);
    salida.connect(reverb);
    compresor.connect(ctx.destination);
  }

  // Timbres: "pad" (colchón lento) y "flauta" (melodía suave con un vibrato leve)
  const TIMBRES = {
    pad: { ataque: 3, caida: 4, filtro: () => 900 + Math.random() * 400, capas: [['sine', 0, 0.5], ['triangle', 6, 0.35], ['sine', -5, 0.5]] },
    acorde: { ataque: 0.8, caida: 1.2, filtro: () => 800, capas: [['sine', 0, 0.5], ['triangle', 4, 0.25], ['sine', -4, 0.4]] },
    flauta: { ataque: 0.08, caida: 0.45, filtro: () => 2400, capas: [['sine', 0, 0.7], ['triangle', 0, 0.12]], vibrato: true },
  };

  function nota(midi, inicio, duracion, volumen, timbre = 'pad') {
    const t = TIMBRES[timbre];
    const caida = Math.min(t.caida, duracion * 0.6);
    const g = ctx.createGain();
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = t.filtro();
    filtro.Q.value = 0.4;
    g.gain.setValueAtTime(0, inicio);
    g.gain.linearRampToValueAtTime(volumen, inicio + Math.min(t.ataque, duracion * 0.4));
    g.gain.setValueAtTime(volumen, inicio + duracion - caida);
    g.gain.linearRampToValueAtTime(0, inicio + duracion);
    let lfo = null;
    if (t.vibrato) {
      // Vibrato que entra despacio, como un flautista
      lfo = ctx.createOscillator();
      lfo.frequency.value = 5;
      const profundidad = ctx.createGain();
      profundidad.gain.setValueAtTime(0, inicio);
      profundidad.gain.linearRampToValueAtTime(5, inicio + Math.min(0.6, duracion));
      lfo.connect(profundidad);
      lfo.start(inicio);
      lfo.stop(inicio + duracion + 0.1);
      lfo.profundidad = profundidad;
    }
    const oscs = t.capas.map(([tipo, cents, nivel]) => {
      const o = ctx.createOscillator();
      o.type = tipo;
      o.frequency.value = frecuencia(midi);
      o.detune.value = cents;
      if (lfo) lfo.profundidad.connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = nivel;
      o.connect(og).connect(filtro);
      o.start(inicio);
      o.stop(inicio + duracion + 0.1);
      return o;
    });
    filtro.connect(g).connect(salida);
    const voz = { oscs: lfo ? [...oscs, lfo] : oscs };
    voces.push(voz);
    oscs[0].onended = () => {
      voces = voces.filter((v) => v !== voz);
      g.disconnect();
    };
  }

  function pararGeneradas() {
    relojes.forEach((r) => {
      clearInterval(r);
      clearTimeout(r);
    });
    relojes = [];
    const ahora = ctx?.currentTime ?? 0;
    voces.forEach((v) => v.oscs.forEach((o) => {
      try {
        o.stop(ahora + 0.05);
      } catch {
        /* ya estaba detenido */
      }
    }));
    voces = [];
  }

  // ----- Pista incluida 1: Ambiente suave -----
  // En Re: Dsus2 · Bm7(add11) · Gmaj7 · Asus4 — suspendidos y abiertos, sin dramatismo
  const ACORDES_AMBIENTE = [
    [50, 57, 62, 64, 69],
    [47, 54, 62, 64, 69],
    [43, 54, 59, 62, 66],
    [45, 52, 57, 62, 64],
  ];
  const DESTELLOS = [74, 76, 78, 81, 83, 86];

  function arrancarAmbiente() {
    let i = 0;
    const acorde = () => {
      const ahora = ctx.currentTime + 0.05;
      const notas = ACORDES_AMBIENTE[i++ % ACORDES_AMBIENTE.length];
      notas.forEach((m, k) => nota(m, ahora, 13, k === 0 ? 0.05 : 0.035, 'pad'));
      nota(notas[0] - 12, ahora, 13, 0.04, 'pad');
    };
    acorde();
    relojes.push(setInterval(acorde, 9000));
    relojes.push(setInterval(() => {
      if (Math.random() < 0.6) nota(DESTELLOS[Math.floor(Math.random() * DESTELLOS.length)], ctx.currentTime + 0.05, 7, 0.012, 'pad');
    }, 5000));
  }

  // ----- Pista incluida 2: Sublime gracia (melodía "New Britain", dominio público) -----
  // Arreglo propio en Sol mayor, 3/4, muy lento. Cada nota: [midi, duración en tiempos].
  const D4 = 62, E4 = 64, G4 = 67, A4 = 69, B4 = 71, D5 = 74;
  const MELODIA_GRACIA = [
    [D4, 1],
    [G4, 2], [B4, 0.5], [G4, 0.5], [B4, 2], [A4, 1], [G4, 2], [E4, 1], [D4, 2], [D4, 1],
    [G4, 2], [B4, 0.5], [G4, 0.5], [B4, 2], [A4, 1], [D5, 3], [D5, 2], [B4, 1],
    [D5, 2], [B4, 0.5], [G4, 0.5], [B4, 2], [A4, 1], [G4, 2], [E4, 1], [D4, 2], [D4, 1],
    [G4, 2], [B4, 0.5], [G4, 0.5], [B4, 2], [A4, 1], [G4, 3], [G4, 2],
  ];
  // Un acorde por compás (16 compases después de la anacrusa)
  const G = [43, 55, 59, 62], C = [48, 52, 55, 60], Dm = [50, 54, 57, 62], G7 = [43, 53, 59, 62];
  const ACORDES_GRACIA = [G, G, C, G, G, G, Dm, Dm, G, G7, C, G, G, Dm, G, G];
  const SEGUNDOS_POR_TIEMPO = 1.1; // ~55 negras por minuto: lento y tranquilo

  function arrancarSublimeGracia() {
    let vuelta = 0;
    const tocarVuelta = () => {
      const inicio = ctx.currentTime + 0.3;
      const s = SEGUNDOS_POR_TIEMPO;
      // En vueltas pares la melodía va una octava abajo: más cálida y variada
      const octava = vuelta % 2 === 1 ? -12 : 0;
      let t = inicio;
      MELODIA_GRACIA.forEach(([m, tiempos]) => {
        nota(m + octava, t, tiempos * s * 0.98, 0.07, 'flauta');
        t += tiempos * s;
      });
      ACORDES_GRACIA.forEach((acorde, compas) => {
        const tc = inicio + (1 + compas * 3) * s; // después de la anacrusa
        acorde.forEach((m, k) => nota(m, tc, 3 * s + 0.6, k === 0 ? 0.035 : 0.022, 'acorde'));
      });
      vuelta++;
      // Pausa de un compás entre vueltas, luego se repite
      const duracionVuelta = (t - inicio) + 3 * s;
      relojes.push(setTimeout(tocarVuelta, duracionVuelta * 1000));
    };
    tocarVuelta();
  }

  // ===================== Canciones de Drive marcadas con 🌙 =====================

  const audioFondo = new Audio();
  audioFondo.preload = 'auto';
  audioFondo.loop = true;
  let relojFade = null;

  function fadeAudio(destino, segundos, alTerminar) {
    clearInterval(relojFade);
    const pasos = Math.max(1, Math.round(segundos * 20));
    const inicio = audioFondo.volume;
    let paso = 0;
    relojFade = setInterval(() => {
      paso++;
      audioFondo.volume = Math.min(1, Math.max(0, inicio + ((destino - inicio) * paso) / pasos));
      if (paso >= pasos) {
        clearInterval(relojFade);
        alTerminar?.();
      }
    }, 50);
  }

  // ===================== Catálogo de pistas de fondo =====================

  const INCLUIDAS = [
    { id: 'ambiente', titulo: 'Ambiente suave', detalle: 'Incluida · sin internet', arrancar: arrancarAmbiente },
    { id: 'sublime-gracia', titulo: 'Sublime gracia (instrumental suave)', detalle: 'Incluida · sin internet', arrancar: arrancarSublimeGracia },
  ];

  // Archivos de la carpeta musica-fondo (los entrega el servidor al cargar la app)
  let locales = [];
  let localesCargados = false;

  function cargarLocales(lista) {
    locales = Array.isArray(lista) ? lista : [];
    localesCargados = true;
    notificar();
  }

  function pistas() {
    const todas = [
      ...INCLUIDAS.map(({ id, titulo, detalle }) => ({ id, titulo, detalle })),
      ...locales.map((l) => ({ id: `local:${l.archivo}`, titulo: l.titulo, detalle: 'Carpeta musica-fondo · sin internet', archivo: l.archivo })),
      ...ajustes.canciones.map((c) => ({ id: `drive:${c.id}`, titulo: c.titulo, detalle: 'De ♫ Música', cancion: c })),
    ];
    // La prioritaria va primera y marcada
    const i = todas.findIndex((p) => p.id === PISTA_PRIORITARIA);
    if (i > 0) {
      const [prioritaria] = todas.splice(i, 1);
      todas.unshift({ ...prioritaria, detalle: `★ Prioridad · ${prioritaria.detalle}` });
    }
    return todas;
  }

  function pistaElegida() {
    return pistas().find((p) => p.id === ajustes.pista) || pistas().find((p) => p.id === PISTA_RESPALDO);
  }

  // ===================== Control general =====================

  function iniciar() {
    clearTimeout(temporizadorEspera);
    temporizadorEspera = null;
    if (sonando) return;
    sonando = true;
    const p = pistaElegida();
    pistaSonando = p.id;
    if (p.cancion || p.archivo) {
      audioFondo.volume = 0;
      audioFondo.src = p.archivo
        ? `/medios/fondo/${encodeURIComponent(p.archivo)}`
        : `/medios/musica/${encodeURIComponent(p.cancion.id)}`;
      audioFondo.play().catch(() => {});
      fadeAudio(ajustes.volumen, 3);
    } else {
      prepararAudio();
      ctx.resume();
      INCLUIDAS.find((i) => i.id === p.id).arrancar();
      salida.gain.cancelScheduledValues(ctx.currentTime);
      salida.gain.setValueAtTime(salida.gain.value, ctx.currentTime);
      salida.gain.linearRampToValueAtTime(ajustes.volumen, ctx.currentTime + 4);
    }
    notificar();
  }

  function detener(rapido = true) {
    clearTimeout(temporizadorEspera);
    temporizadorEspera = null;
    if (!sonando) return;
    sonando = false;
    pistaSonando = null;
    const segundos = rapido ? 0.8 : 2.5;
    if (!audioFondo.paused) fadeAudio(0, segundos, () => audioFondo.pause());
    if (ctx && voces.length) {
      salida.gain.cancelScheduledValues(ctx.currentTime);
      salida.gain.setValueAtTime(salida.gain.value, ctx.currentTime);
      salida.gain.linearRampToValueAtTime(0, ctx.currentTime + segundos);
      setTimeout(() => !sonando && pararGeneradas(), segundos * 1000 + 100);
    } else {
      pararGeneradas();
    }
    notificar();
  }

  // Se llama cuando todo quedó en silencio: espera unos segundos por si viene otra pista
  function programar() {
    clearTimeout(temporizadorEspera);
    if (!ajustes.activo || sonando) return;
    temporizadorEspera = setTimeout(iniciar, ajustes.espera * 1000);
  }

  function cancelarEspera() {
    clearTimeout(temporizadorEspera);
    temporizadorEspera = null;
  }

  function configurar(cambios) {
    ajustes = { ...ajustes, ...cambios };
    // Si la pista elegida ya no existe se vuelve a Sublime gracia
    // (las de la carpeta solo se validan cuando ya se sabe qué archivos hay)
    const esperandoLocales = ajustes.pista.startsWith('local:') && !localesCargados;
    if (!esperandoLocales && !pistas().some((p) => p.id === ajustes.pista)) ajustes.pista = PISTA_RESPALDO;
    guardar();
    if ('volumen' in cambios && sonando) {
      if (!audioFondo.paused) fadeAudio(ajustes.volumen, 0.3);
      if (ctx && voces.length) salida.gain.linearRampToValueAtTime(ajustes.volumen, ctx.currentTime + 0.3);
    }
    if ('activo' in cambios && !ajustes.activo) detener();
    // Si cambió la pista elegida mientras suena, se pasa a la nueva con un fade
    if (sonando && pistaSonando !== ajustes.pista) {
      detener();
      setTimeout(iniciar, 900);
    }
    notificar();
  }

  // Marca/desmarca una canción de Drive como opción de fondo (y la elige al marcarla)
  function alternarCancion(cancion) {
    const ya = ajustes.canciones.some((c) => c.id === cancion.id);
    if (ya) {
      configurar({ canciones: ajustes.canciones.filter((c) => c.id !== cancion.id) });
    } else {
      configurar({
        canciones: [...ajustes.canciones, { id: cancion.id, titulo: cancion.titulo }],
        pista: `drive:${cancion.id}`,
      });
    }
    return !ya;
  }

  return {
    iniciar,
    detener,
    programar,
    cancelarEspera,
    configurar,
    alternarCancion,
    cargarLocales,
    pistas,
    esDeFondo: (id) => ajustes.canciones.some((c) => c.id === id),
    ajustes: () => ({ ...ajustes }),
    estaSonando: () => sonando,
    alCambiar: (fn) => avisos.add(fn),
    // Para revisar problemas desde la consola del navegador: estado real del audio
    diagnostico: () => ({
      sonando,
      pista: pistaSonando,
      esperando: Boolean(temporizadorEspera),
      generada: ctx ? { estado: ctx.state, volumen: +salida.gain.value.toFixed(3), notasSonando: voces.length } : null,
      cancion: { pausado: audioFondo.paused, volumen: +audioFondo.volume.toFixed(2), tiempo: +audioFondo.currentTime.toFixed(1) },
    }),
  };
})();
