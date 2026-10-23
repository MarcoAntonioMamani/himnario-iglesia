package com.marcomamani.himnario

import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors

/**
 * Servidor HTTP mínimo que solo escucha en 127.0.0.1 (nunca sale del celular).
 * Cumple el mismo papel que servidor.js en la PC: la interfaz web le pide /api/... y /medios/...
 * Soporta "Range" para poder adelantar los audios.
 */
class ServidorHttp(private val manejar: (Peticion) -> Respuesta) {

    class Peticion(
        val metodo: String,
        val ruta: String, // sin la parte "?..."
        val cabeceras: Map<String, String>, // nombres en minúscula
        val cuerpo: ByteArray,
    ) {
        val partes: List<String> = ruta.split('/').filter { it.isNotEmpty() }
        fun texto() = String(cuerpo, Charsets.UTF_8)
    }

    class Respuesta(
        val estado: Int,
        val tipo: String,
        val bytes: ByteArray? = null,
        val archivo: File? = null,
        val cabeceras: Map<String, String> = emptyMap(),
    )

    private var socket: ServerSocket? = null
    private val hilos = Executors.newCachedThreadPool()
    var puerto: Int = 0
        private set

    /** Intenta el puerto preferido (para que la página tenga siempre la misma dirección). */
    fun iniciar(puertoPreferido: Int) {
        val s = try {
            ServerSocket(puertoPreferido, 50, InetAddress.getByName("127.0.0.1"))
        } catch (e: Exception) {
            Log.w(TAG, "Puerto $puertoPreferido ocupado, se usa otro: ${e.message}")
            ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        }
        socket = s
        puerto = s.localPort
        Thread({
            while (!s.isClosed) {
                try {
                    val cliente = s.accept()
                    hilos.execute { atender(cliente) }
                } catch (e: Exception) {
                    if (!s.isClosed) Log.e(TAG, "Error aceptando conexión", e)
                }
            }
        }, "servidor-himnario").start()
        Log.i(TAG, "Servidor en http://127.0.0.1:$puerto")
    }

    fun detener() {
        socket?.close()
        hilos.shutdownNow()
    }

    private fun atender(cliente: Socket) {
        cliente.use { s ->
            try {
                s.soTimeout = 30_000
                val entrada = BufferedInputStream(s.getInputStream())
                val salida = s.getOutputStream()
                val peticion = leerPeticion(entrada) ?: return
                val respuesta = try {
                    manejar(peticion)
                } catch (e: ErrorCliente) {
                    json(e.estado, """{"error":${citar(e.message ?: "Error")}}""")
                } catch (e: Exception) {
                    Log.e(TAG, "Error en ${peticion.metodo} ${peticion.ruta}", e)
                    json(500, """{"error":"Error interno"}""")
                }
                escribir(salida, peticion, respuesta)
            } catch (e: Exception) {
                // El navegador cortó la conexión (por ejemplo al adelantar un audio): es normal
                Log.d(TAG, "Conexión cerrada: ${e.message}")
            }
        }
    }

    private fun leerLinea(entrada: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val c = entrada.read()
            if (c == -1) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(c.toChar())
            if (sb.length > 16_384) throw ErrorCliente(431, "Cabecera demasiado larga")
        }
    }

    private fun leerPeticion(entrada: InputStream): Peticion? {
        val primera = leerLinea(entrada) ?: return null
        val partes = primera.split(' ')
        if (partes.size < 2) return null
        val cabeceras = mutableMapOf<String, String>()
        while (true) {
            val linea = leerLinea(entrada) ?: break
            if (linea.isEmpty()) break
            val i = linea.indexOf(':')
            if (i > 0) cabeceras[linea.substring(0, i).trim().lowercase()] = linea.substring(i + 1).trim()
        }
        val largo = cabeceras["content-length"]?.toIntOrNull() ?: 0
        if (largo > 1_000_000) throw ErrorCliente(413, "Cuerpo demasiado grande")
        val cuerpo = ByteArray(largo)
        var leidos = 0
        while (leidos < largo) {
            val n = entrada.read(cuerpo, leidos, largo - leidos)
            if (n == -1) break
            leidos += n
        }
        val rutaCruda = partes[1].substringBefore('?')
        val ruta = URLDecoder.decode(rutaCruda.replace("+", "%2B"), "UTF-8")
        return Peticion(partes[0].uppercase(), ruta, cabeceras, cuerpo)
    }

    private fun escribir(salida: OutputStream, peticion: Peticion, r: Respuesta) {
        val cab = linkedMapOf<String, String>()
        cab["Content-Type"] = r.tipo
        cab["Connection"] = "close"
        cab.putAll(r.cabeceras)
        var estado = r.estado
        var desde = 0L
        var hasta = -1L

        if (r.archivo != null) {
            val total = r.archivo.length()
            cab["Accept-Ranges"] = "bytes"
            val rango = Regex("bytes=(\\d*)-(\\d*)").find(peticion.cabeceras["range"] ?: "")
            if (rango != null && estado == 200) {
                desde = rango.groupValues[1].toLongOrNull() ?: 0L
                hasta = rango.groupValues[2].toLongOrNull()?.coerceAtMost(total - 1) ?: (total - 1)
                if (desde > hasta || desde >= total) {
                    salida.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */$total\r\nConnection: close\r\n\r\n".toByteArray())
                    return
                }
                estado = 206
                cab["Content-Range"] = "bytes $desde-$hasta/$total"
            } else {
                hasta = total - 1
            }
            cab["Content-Length"] = (hasta - desde + 1).toString()
        } else {
            cab["Content-Length"] = (r.bytes?.size ?: 0).toString()
        }

        val encabezado = StringBuilder("HTTP/1.1 $estado ${textoEstado(estado)}\r\n")
        cab.forEach { (k, v) -> encabezado.append(k).append(": ").append(v).append("\r\n") }
        encabezado.append("\r\n")
        salida.write(encabezado.toString().toByteArray(Charsets.UTF_8))
        if (peticion.metodo == "HEAD") return

        if (r.archivo != null) {
            RandomAccessFile(r.archivo, "r").use { raf ->
                raf.seek(desde)
                val buffer = ByteArray(64 * 1024)
                var restantes = hasta - desde + 1
                while (restantes > 0) {
                    val n = raf.read(buffer, 0, minOf(buffer.size.toLong(), restantes).toInt())
                    if (n == -1) break
                    salida.write(buffer, 0, n)
                    restantes -= n
                }
            }
        } else if (r.bytes != null) {
            salida.write(r.bytes)
        }
        salida.flush()
    }

    private fun textoEstado(e: Int) = when (e) {
        200 -> "OK"; 206 -> "Partial Content"; 400 -> "Bad Request"; 403 -> "Forbidden"
        404 -> "Not Found"; 413 -> "Payload Too Large"; 416 -> "Range Not Satisfiable"
        500 -> "Internal Server Error"; 503 -> "Service Unavailable"; else -> "OK"
    }

    companion object {
        const val TAG = "Himnario"

        fun json(estado: Int, texto: String) = Respuesta(
            estado, "application/json; charset=utf-8", texto.toByteArray(Charsets.UTF_8),
            cabeceras = mapOf("Cache-Control" to "no-store"),
        )

        fun citar(s: String) = org.json.JSONObject.quote(s)
    }
}

/** Error que se devuelve al navegador con su código (404, 503…) y un mensaje para el usuario. */
class ErrorCliente(val estado: Int, mensaje: String) : Exception(mensaje)
