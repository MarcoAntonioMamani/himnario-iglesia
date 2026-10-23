package com.marcomamani.himnario

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * App de una sola pantalla: arranca el servidor interno (ServidorHttp + Api) y muestra la
 * interfaz web del Himnario en un WebView a pantalla completa, con comportamiento de app nativa.
 * Developed by Marco Antonio Mamani
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var contenedor: FrameLayout
    private var vistaPantallaCompleta: View? = null
    private var alSalirDePantallaCompleta: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)

        val puerto = servidor(this)

        contenedor = FrameLayout(this)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#F8F9FF"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // ajustes de la música de fondo, etc.
            settings.mediaPlaybackRequiresUserGesture = false // que pase sola a la siguiente canción
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.setSupportZoom(false)
            settings.textZoom = 100 // la interfaz ya está pensada para celular
            // Respeta el ancho del celular que pide la página y, si algo quedara más ancho,
            // ajusta todo a la pantalla en vez de cortarlo a la derecha
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            addJavascriptInterface(Puente(), "Android")
            // Que Android no cierre el motor de la página cuando la app no está a la vista
            // (si no, la música se corta en segundo plano)
            setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            webViewClient = Cliente()
            webChromeClient = Navegador()
        }
        contenedor.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Android 15 dibuja la app debajo de la hora y de los botones del sistema: se reserva
        // ese espacio, pintado con el azul de la app (con íconos blancos encima)
        contenedor.setBackgroundColor(Color.parseColor("#1A3FB0"))
        contenedor.setOnApplyWindowInsetsListener { vista, insets ->
            val (izq, arr, der, aba) = if (android.os.Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
                listOf(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                listOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            if (vistaPantallaCompleta == null) vista.setPadding(izq, arr, der, aba)
            insets
        }
        setContentView(contenedor)

        Avisos.crearCanales(this)
        pedirPermisoNotificaciones()
        Avisos.programar(this)
        Avisos.revisarAhora(this)
        registrarControlesDeMusica()

        val inicio = "http://127.0.0.1:$puerto/" + if (intent?.getStringExtra(EXTRA_ABRIR) == "cumple") "#cumple" else ""
        if (estado != null) web.restoreState(estado) else web.loadUrl(inicio)
    }

    // Al tocar la notificación de un cumpleaños con la app ya abierta
    override fun onNewIntent(nuevo: Intent) {
        super.onNewIntent(nuevo)
        if (nuevo.getStringExtra(EXTRA_ABRIR) == "cumple") web.evaluateJavascript("abrirCumple && abrirCumple()", null)
    }

    private fun pedirPermisoNotificaciones() {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onRequestPermissionsResult(codigo: Int, permisos: Array<out String>, resultados: IntArray) {
        super.onRequestPermissionsResult(codigo, permisos, resultados)
        // Recién aceptado el permiso: si hoy hay cumpleaños, se avisa ya
        if (codigo == 1) Avisos.revisarAhora(this)
    }

    // Botones ⏮ ⏯ ⏭ de la notificación y de la ventanita PiP: se pasan a la interfaz web,
    // que decide si controla el audio (himno/música) o el video de YouTube
    private val controlesMusica = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context, i: Intent) {
            val accion = when (i.action) {
                ServicioMusica.ACCION_ALTERNAR -> "alternar"
                ServicioMusica.ACCION_SIGUIENTE -> "siguiente"
                ServicioMusica.ACCION_ANTERIOR -> "anterior"
                else -> return
            }
            web.evaluateJavascript("window.androidAccion && androidAccion('$accion')", null)
        }
    }

    // ---------- Imagen en imagen (PiP) para los videos de YouTube ----------
    // YouTube no deja que sus videos sigan con el reproductor oculto; en PiP el video sigue
    // a la vista en una ventanita sobre las demás apps, así que sí continúa.
    private var videoSonando = false
    private var videoSonandoTitulo = ""

    private fun parametrosPip(): android.app.PictureInPictureParams {
        fun accion(icono: Int, titulo: String, accion: String, codigo: Int) = android.app.RemoteAction(
            android.graphics.drawable.Icon.createWithResource(this, icono), titulo, titulo,
            android.app.PendingIntent.getBroadcast(this, 100 + codigo, Intent(accion).setPackage(packageName),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE),
        )
        val b = android.app.PictureInPictureParams.Builder()
            .setAspectRatio(android.util.Rational(16, 9))
            .setActions(listOf(
                accion(android.R.drawable.ic_media_previous, "Anterior", ServicioMusica.ACCION_ANTERIOR, 1),
                accion(if (videoSonando) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (videoSonando) "Pausar" else "Reproducir", ServicioMusica.ACCION_ALTERNAR, 2),
                accion(android.R.drawable.ic_media_next, "Siguiente", ServicioMusica.ACCION_SIGUIENTE, 3),
            ))
        // Android 12+: entra solo a PiP al ir a inicio con un video sonando
        if (android.os.Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(videoSonando).setSeamlessResizeEnabled(true)
        return b.build()
    }

    private fun actualizarPip() {
        try { setPictureInPictureParams(parametrosPip()) } catch (e: Exception) { /* el celular no tiene PiP */ }
    }

    // Android 8 a 11: al tocar "inicio" con un video sonando, se pasa a PiP a mano
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (videoSonando && android.os.Build.VERSION.SDK_INT < 31) {
            try { enterPictureInPictureMode(parametrosPip()) } catch (e: Exception) { /* sin PiP */ }
        }
    }

    override fun onPictureInPictureModeChanged(enPip: Boolean, config: android.content.res.Configuration) {
        super.onPictureInPictureModeChanged(enPip, config)
        // En la ventanita no hace falta dejar lugar para la hora ni los botones del sistema
        if (enPip) contenedor.setPadding(0, 0, 0, 0) else contenedor.requestApplyInsets()
        web.evaluateJavascript("window.androidPip && androidPip($enPip)", null)
    }

    private fun registrarControlesDeMusica() {
        val filtro = android.content.IntentFilter().apply {
            addAction(ServicioMusica.ACCION_ALTERNAR)
            addAction(ServicioMusica.ACCION_SIGUIENTE)
            addAction(ServicioMusica.ACCION_ANTERIOR)
        }
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(controlesMusica, filtro, RECEIVER_NOT_EXPORTED)
        else @Suppress("UnspecifiedRegisterReceiverFlag") registerReceiver(controlesMusica, filtro)
    }

    override fun onSaveInstanceState(salida: Bundle) {
        super.onSaveInstanceState(salida)
        web.saveState(salida)
    }

    // No se llama a web.onPause(): así la música sigue sonando si se cambia a otra app

    @Deprecated("Se mantiene por compatibilidad con Android 8 a 12")
    override fun onBackPressed() {
        // Primero sale de la pantalla completa de un video
        if (vistaPantallaCompleta != null) {
            web.webChromeClient?.onHideCustomView()
            return
        }
        // La interfaz decide: cierra lo que esté abierto o vuelve a la pantalla anterior.
        // Si ya está en la lista principal, la app se va al fondo (la música sigue sonando).
        web.evaluateJavascript("window.androidAtras ? window.androidAtras() : 'salir'") { resultado ->
            if (resultado?.contains("salir") == false) return@evaluateJavascript
            // En el inicio: primer atrás avisa, el segundo (dentro de 2 s) sale, como las apps profesionales
            val ahora = System.currentTimeMillis()
            if (ahora - ultimoAtras < 2000) {
                avisoSalir?.cancel()
                moveTaskToBack(true) // la música sigue sonando si estaba sonando
            } else {
                ultimoAtras = ahora
                avisoSalir = android.widget.Toast.makeText(this, "Presiona atrás otra vez para salir", android.widget.Toast.LENGTH_SHORT)
                    .also { it.show() }
            }
        }
    }

    private var ultimoAtras = 0L
    private var avisoSalir: android.widget.Toast? = null

    override fun onDestroy() {
        try { unregisterReceiver(controlesMusica) } catch (e: Exception) { /* ya no estaba */ }
        ServicioMusica.detener(this)
        contenedor.removeAllViews()
        web.destroy()
        super.onDestroy()
    }

    /** Lo que la interfaz web puede pedirle a Android. */
    inner class Puente {
        @JavascriptInterface
        fun mantenerPantalla(encendida: Boolean) = runOnUiThread {
            if (encendida) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        @JavascriptInterface
        fun abrirEnNavegador(url: String) = runOnUiThread { abrirFuera(url) }

        // La interfaz avisa qué suena: mantiene la música en segundo plano con su notificación
        @JavascriptInterface
        fun reproduccion(titulo: String, detalle: String, sonando: Boolean, conPasos: Boolean) =
            ServicioMusica.actualizar(this@MainActivity, titulo, detalle, sonando, conPasos)

        @JavascriptInterface
        fun sinReproduccion() = ServicioMusica.detener(this@MainActivity)

        // Si un video está sonando, al salir de la app pasa a la ventanita PiP
        @JavascriptInterface
        fun estadoVideo(sonando: Boolean, titulo: String) = runOnUiThread {
            if (sonando != videoSonando || titulo != videoSonandoTitulo) {
                videoSonando = sonando
                videoSonandoTitulo = titulo
                actualizarPip()
            }
        }
    }

    private fun abrirFuera(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Log.w(ServidorHttp.TAG, "No se pudo abrir $url: ${e.message}")
        }
    }

    private inner class Cliente : WebViewClient() {
        // Los enlaces externos (himnario.net, Drive…) se abren en el navegador del celular
        override fun shouldOverrideUrlLoading(vista: WebView, pedido: WebResourceRequest): Boolean {
            if (!pedido.isForMainFrame) return false
            val url = pedido.url
            // tel: (llamar a un líder), whatsapp:, mailto:… se abren con la app del celular
            if (url.scheme != "http" && url.scheme != "https") {
                abrirFuera(url.toString())
                return true
            }
            if (url.host == "127.0.0.1") return false
            abrirFuera(url.toString())
            return true
        }
    }

    private inner class Navegador : WebChromeClient() {
        // Pantalla completa de los videos de YouTube y de la presentación
        override fun onShowCustomView(vista: View, callback: CustomViewCallback) {
            if (vistaPantallaCompleta != null) {
                callback.onCustomViewHidden(); return
            }
            vistaPantallaCompleta = vista
            alSalirDePantallaCompleta = callback
            contenedor.addView(vista, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            web.visibility = View.GONE
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }

        override fun onHideCustomView() {
            val vista = vistaPantallaCompleta ?: return
            contenedor.removeView(vista)
            vistaPantallaCompleta = null
            web.visibility = View.VISIBLE
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
            alSalirDePantallaCompleta?.onCustomViewHidden()
            alSalirDePantallaCompleta = null
        }

        override fun onConsoleMessage(m: ConsoleMessage): Boolean {
            Log.d(ServidorHttp.TAG, "web: ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
            return true
        }
    }

    companion object {
        // Puerto fijo: así la página tiene siempre la misma dirección y conserva sus ajustes
        private const val PUERTO = 37460
        const val EXTRA_ABRIR = "abrir"
        private var servidor: ServidorHttp? = null

        /** Un solo servidor para toda la vida de la app (sobrevive a girar la pantalla). */
        @Synchronized
        fun servidor(actividad: Activity): Int {
            servidor?.let { return it.puerto }
            val api = Api(actividad.applicationContext)
            val s = ServidorHttp(api::manejar)
            s.iniciar(PUERTO)
            servidor = s
            return s.puerto
        }
    }
}
