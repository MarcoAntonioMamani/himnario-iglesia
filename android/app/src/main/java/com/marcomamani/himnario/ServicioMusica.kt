package com.marcomamani.himnario

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder

/**
 * Servicio en primer plano mientras hay algo para reproducir: Android no cierra la app y la
 * música sigue con la pantalla apagada o en otra app. Muestra una notificación con ⏮ ⏯ ⏭
 * (los botones los recibe MainActivity y se los pasa a la interfaz web).
 */
class ServicioMusica : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    // Con la pantalla apagada Android duerme el procesador y apaga el WiFi para ahorrar batería,
    // y eso corta el audio. Mientras algo suena se le pide que los mantenga despiertos
    // (lo mismo que hacen los reproductores de música); al pausar se sueltan.
    private var procesadorDespierto: android.os.PowerManager.WakeLock? = null
    private var wifiDespierto: android.net.wifi.WifiManager.WifiLock? = null

    private fun mantenerDespierto(sonando: Boolean) {
        if (sonando) {
            if (procesadorDespierto == null) {
                procesadorDespierto = getSystemService(android.os.PowerManager::class.java)
                    .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "LasAmericas:musica")
                    .apply { setReferenceCounted(false) }
            }
            // Con límite de seguridad por si algo falla y nunca se suelta
            procesadorDespierto?.acquire(4 * 60 * 60 * 1000L)
            if (wifiDespierto == null) {
                val wm = applicationContext.getSystemService(android.net.wifi.WifiManager::class.java)
                @Suppress("DEPRECATION")
                val modo = if (Build.VERSION.SDK_INT >= 29) android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                else android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF
                wifiDespierto = wm.createWifiLock(modo, "LasAmericas:musica").apply { setReferenceCounted(false) }
            }
            if (wifiDespierto?.isHeld == false) wifiDespierto?.acquire()
        } else {
            if (procesadorDespierto?.isHeld == true) procesadorDespierto?.release()
            if (wifiDespierto?.isHeld == true) wifiDespierto?.release()
        }
    }

    override fun onDestroy() {
        mantenerDespierto(false)
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val titulo = intent?.getStringExtra("titulo") ?: "LasAmericas"
        val detalle = intent?.getStringExtra("detalle") ?: ""
        val sonando = intent?.getBooleanExtra("sonando", false) ?: false
        val conPasos = intent?.getBooleanExtra("conPasos", false) ?: false
        val n = notificacion(titulo, detalle, sonando, conPasos)
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(ID, n)
        mantenerDespierto(sonando)
        return START_NOT_STICKY
    }

    private fun accion(accion: String, codigo: Int) = PendingIntent.getBroadcast(
        this, codigo, Intent(accion).setPackage(packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun notificacion(titulo: String, detalle: String, sonando: Boolean, conPasos: Boolean): Notification {
        val abrir = PendingIntent.getActivity(
            this, 30, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val b = Notification.Builder(this, Avisos.CANAL_MUSICA)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setColor(0xFF1E5BD8.toInt())
            .setContentTitle(titulo)
            .setContentText(detalle)
            .setContentIntent(abrir)
            .setOngoing(sonando)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        val indices = mutableListOf<Int>()
        if (conPasos) {
            b.addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_previous), "Anterior", accion(ACCION_ANTERIOR, 1)).build())
            indices += 0
        }
        b.addAction(
            Notification.Action.Builder(
                Icon.createWithResource(this, if (sonando) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
                if (sonando) "Pausar" else "Reproducir", accion(ACCION_ALTERNAR, 2),
            ).build()
        )
        indices += if (conPasos) 1 else 0
        if (conPasos) {
            b.addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_next), "Siguiente", accion(ACCION_SIGUIENTE, 3)).build())
            indices += 2
        }
        b.setStyle(Notification.MediaStyle().setShowActionsInCompactView(*indices.toIntArray()))
        return b.build()
    }

    companion object {
        private const val ID = 7
        const val ACCION_ALTERNAR = "com.marcomamani.himnario.ALTERNAR"
        const val ACCION_SIGUIENTE = "com.marcomamani.himnario.SIGUIENTE"
        const val ACCION_ANTERIOR = "com.marcomamani.himnario.ANTERIOR"

        fun actualizar(ctx: Context, titulo: String, detalle: String, sonando: Boolean, conPasos: Boolean) {
            val i = Intent(ctx, ServicioMusica::class.java)
                .putExtra("titulo", titulo).putExtra("detalle", detalle)
                .putExtra("sonando", sonando).putExtra("conPasos", conPasos)
            try {
                ctx.startForegroundService(i)
            } catch (e: Exception) {
                // Android no deja iniciarlo si la app ya está en segundo plano sin estar sonando
                android.util.Log.w(ServidorHttp.TAG, "No se pudo iniciar el servicio de música: ${e.message}")
            }
        }

        fun detener(ctx: Context) {
            ctx.stopService(Intent(ctx, ServicioMusica::class.java))
        }
    }
}
