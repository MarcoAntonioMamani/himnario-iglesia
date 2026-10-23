package com.marcomamani.himnario

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar

/**
 * Avisos nativos de cumpleaños: el día antes y el mismo día, aunque la app esté cerrada.
 * Una alarma diaria (8:00) revisa la lista; también se revisa al abrir la app.
 * Cada aviso se muestra una sola vez por día y por persona.
 */
object Avisos {
    const val CANAL_CUMPLE = "cumpleanos"
    const val CANAL_MUSICA = "musica"
    private const val HORA_AVISO = 8

    fun crearCanales(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CANAL_CUMPLE, "Cumpleaños", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Aviso el día antes y el mismo día del cumpleaños de un miembro"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CANAL_MUSICA, "Reproducción", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Controles de lo que está sonando"
                setShowBadge(false)
            }
        )
    }

    /** Programa la revisión diaria (la próxima a las 8:00) */
    fun programar(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val proxima = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, HORA_AVISO); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
        }
        // Inexacta: no necesita permisos especiales y Android la agrupa para ahorrar batería
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, proxima.timeInMillis, AlarmManager.INTERVAL_DAY, intentAlarma(ctx))
    }

    private fun intentAlarma(ctx: Context) = PendingIntent.getBroadcast(
        ctx, 10, Intent(ctx, ReceptorAvisos::class.java).setAction(ReceptorAvisos.ACCION_REVISAR),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun leerCumpleanos(ctx: Context): JSONArray {
        val propio = File(ctx.filesDir, "datos/cumpleanos.json")
        val texto = try {
            if (propio.exists()) propio.readText()
            else ctx.assets.open("datos/cumpleanos.json").use { String(it.readBytes(), Charsets.UTF_8) }
        } catch (e: Exception) {
            return JSONArray()
        }
        return JSONObject(texto).optJSONArray("personas") ?: JSONArray()
    }

    // Días hasta el próximo cumpleaños (0 = hoy). El 29/2 se festeja el 28 en años no bisiestos.
    private fun diasPara(dia: Int, mes: Int, hoy: Calendar): Int {
        fun fechaEn(anio: Int) = Calendar.getInstance().apply {
            clear(); set(Calendar.YEAR, anio); set(Calendar.MONTH, mes - 1)
            set(Calendar.DAY_OF_MONTH, minOf(dia, getActualMaximum(Calendar.DAY_OF_MONTH)))
        }
        val base = Calendar.getInstance().apply { clear(); set(hoy.get(Calendar.YEAR), hoy.get(Calendar.MONTH), hoy.get(Calendar.DAY_OF_MONTH)) }
        var f = fechaEn(base.get(Calendar.YEAR))
        if (f.before(base)) f = fechaEn(base.get(Calendar.YEAR) + 1)
        return ((f.timeInMillis - base.timeInMillis) / 86_400_000L).toInt()
    }

    /** Revisa la lista y muestra los avisos de hoy y de mañana que todavía no se mostraron */
    fun revisarAhora(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val hoy = Calendar.getInstance()
        val claveDia = "${hoy.get(Calendar.YEAR)}-${hoy.get(Calendar.MONTH) + 1}-${hoy.get(Calendar.DAY_OF_MONTH)}"
        val prefs = ctx.getSharedPreferences("avisos", Context.MODE_PRIVATE)
        val personas = leerCumpleanos(ctx)
        val deHoy = mutableListOf<String>()
        val deManana = mutableListOf<String>()
        for (i in 0 until personas.length()) {
            val p = personas.getJSONObject(i)
            when (diasPara(p.optInt("dia"), p.optInt("mes"), hoy)) {
                0 -> deHoy += p.optString("nombre")
                1 -> deManana += p.optString("nombre")
            }
        }
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val editor = prefs.edit()
        // Una notificación por persona (así cada una se puede tocar y descartar por separado)
        deHoy.forEach { nombre ->
            val clave = "$claveDia|hoy|$nombre"
            if (!prefs.getBoolean(clave, false)) {
                nm.notify(clave.hashCode(), notificacion(ctx, "🎂 ¡Hoy cumple años!", "$nombre. ¡No olvides felicitarlo!"))
                editor.putBoolean(clave, true)
            }
        }
        deManana.forEach { nombre ->
            val clave = "$claveDia|manana|$nombre"
            if (!prefs.getBoolean(clave, false)) {
                nm.notify(clave.hashCode(), notificacion(ctx, "⏰ Mañana cumple años", nombre))
                editor.putBoolean(clave, true)
            }
        }
        // Se borran las marcas de días anteriores para no acumular
        prefs.all.keys.filter { !it.startsWith(claveDia) }.forEach { editor.remove(it) }
        editor.apply()
        Log.i(ServidorHttp.TAG, "Cumpleaños revisados: hoy ${deHoy.size}, mañana ${deManana.size}")
    }

    private fun notificacion(ctx: Context, titulo: String, texto: String): Notification {
        val abrir = PendingIntent.getActivity(
            ctx, 20, Intent(ctx, MainActivity::class.java).putExtra(MainActivity.EXTRA_ABRIR, "cumple")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(ctx, CANAL_CUMPLE)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setColor(0xFF1E5BD8.toInt())
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(Notification.BigTextStyle().bigText(texto))
            .setContentIntent(abrir)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .build()
    }
}

/** Recibe la alarma diaria y el reinicio del celular */
class ReceptorAvisos : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Avisos.crearCanales(ctx)
                Avisos.programar(ctx)
                Avisos.revisarAhora(ctx)
            }
            ACCION_REVISAR -> {
                Avisos.crearCanales(ctx)
                // Antes de avisar se intenta traer los cumpleaños nuevos de la hoja de Google
                // (si no hay internet se usa la última copia guardada)
                val pendiente = goAsync()
                Thread {
                    try {
                        Api(ctx.applicationContext).sincronizarHoja(soloCumpleanos = true)
                    } catch (e: Exception) {
                        android.util.Log.w(ServidorHttp.TAG, "Sin hoja para los avisos: ${e.message}")
                    }
                    Avisos.revisarAhora(ctx)
                    pendiente.finish()
                }.start()
            }
        }
    }

    companion object {
        const val ACCION_REVISAR = "com.marcomamani.himnario.REVISAR_CUMPLEANOS"
    }
}
