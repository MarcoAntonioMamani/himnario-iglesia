package com.marcomamani.himnario

import android.content.Context
import android.util.Log
import com.marcomamani.himnario.ServidorHttp.Companion.json
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.Normalizer
import java.util.concurrent.ConcurrentHashMap

/**
 * La misma API que servidor.js, para que la interfaz web funcione igual en el celular.
 * Datos personales en filesDir/datos; audios e imágenes guardados en filesDir/descargas.
 */
class Api(private val ctx: Context) {

    private val origen = "https://adventista7.com/app/himnario"
    private val dirDatos = File(ctx.filesDir, "datos").apply { mkdirs() }
    private val dirDescargas = File(ctx.filesDir, "descargas").apply { mkdirs() }
    private val dirMusica = File(dirDescargas, "musica").apply { mkdirs() }
    // Pistas de fondo propias: Android/data/com.marcomamani.himnario/files/musica-fondo
    private val dirFondo: File = (ctx.getExternalFilesDir("musica-fondo") ?: File(ctx.filesDir, "musica-fondo")).apply { mkdirs() }

    private data class Tema(val id: String, val nombre: String, val desde: Int, val hasta: Int)

    private val temas = listOf(
        Tema("culto", "Culto", 1, 52), Tema("padre", "Dios el Padre", 53, 77),
        Tema("cristo", "Jesucristo", 78, 189), Tema("espiritu", "Espíritu Santo", 190, 203),
        Tema("escrituras", "Las Sagradas Escrituras", 204, 208), Tema("evangelio", "El Evangelio", 209, 344),
        Tema("vida", "La Vida Cristiana", 345, 527), Tema("iglesia", "La Iglesia", 528, 588),
        Tema("hogar", "El Hogar Cristiano", 589, 613),
    )
    private fun temaDe(n: Int) = temas.firstOrNull { n in it.desde..it.hasta }
    private val tiposAudio = mapOf("cantado" to "Cantado", "instrumental" to "Instrumental")
    private val extAudio = Regex("\\.(mp3|mpeg|m4a|wav|ogg|oga|aac|flac|opus)$", RegexOption.IGNORE_CASE)
    private val extFondo = Regex("\\.(mp3|mpeg|m4a|mp4|wav|ogg|oga|aac|flac|opus|webm)$", RegexOption.IGNORE_CASE)
    private val carpetaDriveInicial = JSONObject().put("id", "1aNpvd4MlIA26NG1aT72XJM0j8ipiY5Iq").put("nombre", "Música de la iglesia")

    // ===================== utilidades =====================

    private fun tres(n: Int) = n.toString().padStart(3, '0')
    private fun dos(n: Int) = n.toString().padStart(2, '0')

    private fun leerTextoAsset(ruta: String) = ctx.assets.open(ruta).use { String(it.readBytes(), Charsets.UTF_8) }

    private fun leerObjeto(nombre: String): JSONObject {
        val f = File(dirDatos, nombre)
        return if (f.exists()) JSONObject(f.readText()) else JSONObject()
    }

    private fun leerArreglo(nombre: String, porDefecto: JSONArray = JSONArray()): JSONArray {
        val f = File(dirDatos, nombre)
        return if (f.exists()) JSONArray(f.readText()) else porDefecto
    }

    // Escribe en un temporal y renombra: si se corta, no queda el archivo a medias
    @Synchronized
    private fun guardar(nombre: String, contenido: String) {
        val f = File(dirDatos, nombre)
        val tmp = File(dirDatos, "$nombre.tmp")
        tmp.writeText(contenido)
        if (!tmp.renameTo(f)) {
            f.delete(); tmp.renameTo(f)
        }
    }

    private fun conexion(url: String, rango: String? = null): HttpURLConnection {
        var actual = url
        repeat(5) {
            val c = URL(actual).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000
            c.readTimeout = 60_000
            c.instanceFollowRedirects = false
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) HimnarioApp")
            if (rango != null) c.setRequestProperty("Range", rango)
            val codigo = c.responseCode
            if (codigo in 300..399) {
                val destino = c.getHeaderField("Location") ?: return c
                actual = URL(URL(actual), destino).toString()
                c.disconnect()
            } else {
                return c
            }
        }
        throw Exception("Demasiadas redirecciones")
    }

    private fun bajarTexto(url: String, juego: java.nio.charset.Charset = Charsets.UTF_8): String {
        val c = conexion(url)
        if (c.responseCode !in 200..299) throw Exception("El sitio respondió ${c.responseCode}")
        return c.inputStream.use { String(it.readBytes(), juego) }
    }

    private val enCurso = ConcurrentHashMap<String, Any>()

    // Baja un archivo una sola vez (si dos piden lo mismo a la vez, el segundo espera)
    private fun bajarArchivo(url: String, destino: File, rechazarHtml: Boolean = false) {
        val candado = enCurso.getOrPut(destino.path) { Any() }
        synchronized(candado) {
            if (destino.exists()) return
            val c = conexion(url)
            if (c.responseCode !in 200..299) throw Exception("El sitio respondió ${c.responseCode}")
            if (rechazarHtml && (c.contentType ?: "").contains("text/html")) {
                throw Exception("No llegó el archivo (¿es público?)")
            }
            destino.parentFile?.mkdirs()
            val parte = File(destino.path + ".part")
            c.inputStream.use { entrada -> parte.outputStream().use { entrada.copyTo(it, 64 * 1024) } }
            if (!parte.renameTo(destino)) throw Exception("No se pudo guardar ${destino.name}")
        }
        enCurso.remove(destino.path)
    }

    private fun decodificarHtml(t: String) = t
        .replace(Regex("&#(\\d+);")) { it.groupValues[1].toInt().toChar().toString() }
        .replace("&quot;", "\"").replace("&apos;", "'").replace("&#39;", "'")
        .replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")

    private fun sinTildes(t: String) =
        Normalizer.normalize(t, Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase().trim()

    // ===================== catálogo =====================

    @Volatile private var catalogo: JSONArray = cargarCatalogo()

    private fun cargarCatalogo(): JSONArray {
        val propio = File(dirDatos, "catalogo.json")
        return when {
            propio.exists() -> JSONArray(propio.readText())
            else -> try { JSONArray(leerTextoAsset("datos/catalogo.json")) } catch (e: Exception) { JSONArray() }
        }
    }

    private fun actualizarCatalogo(): JSONArray {
        val html = bajarTexto("$origen/", Charsets.ISO_8859_1)
        val himnos = mutableListOf<JSONObject>()
        Regex("<span class=\"himn\"([^>]*)>").findAll(html).forEach { m ->
            val atr = m.groupValues[1]
            fun valor(n: String) = Regex("data-$n=\"([^\"]*)\"").find(atr)?.groupValues?.get(1)
            val numero = valor("number")?.toIntOrNull() ?: return@forEach
            val tiempos = JSONArray()
            (valor("times") ?: "").split(',').mapNotNull { it.trim().toIntOrNull() }.filter { it > 0 }.forEach { tiempos.put(it) }
            himnos += JSONObject()
                .put("numero", numero)
                .put("titulo", decodificarHtml(valor("title") ?: ""))
                .put("diapositivas", valor("slides")?.toIntOrNull() ?: 1)
                .put("tiempos", tiempos)
                .put("tema", temaDe(numero)?.id ?: "")
        }
        if (himnos.size < 100) throw Exception("Se esperaban ~613 himnos y llegaron ${himnos.size}")
        val arreglo = JSONArray(himnos.sortedBy { it.getInt("numero") })
        guardar("catalogo.json", arreglo.toString())
        catalogo = arreglo
        return arreglo
    }

    private fun himno(n: Int): JSONObject? {
        for (i in 0 until catalogo.length()) {
            val h = catalogo.getJSONObject(i)
            if (h.getInt("numero") == n) return h
        }
        return null
    }

    private fun himnoValido(texto: String): JSONObject =
        texto.toIntOrNull()?.let { himno(it) } ?: throw ErrorCliente(404, "No existe el himno $texto")

    private fun copiar(h: JSONObject) = JSONObject(h.toString())

    // ===================== descargas de himnos =====================

    private fun carpetaHimno(n: Int) = File(dirDescargas, tres(n))
    private fun rutaAudio(n: Int, tipo: String) = File(carpetaHimno(n), "$tipo.mp3")
    private fun rutaLetra(n: Int, i: Int) = File(carpetaHimno(n), "letra-${dos(i)}.jpg")

    private fun estadoDescarga(h: JSONObject): JSONObject {
        val n = h.getInt("numero")
        val letra = (1..h.optInt("diapositivas", 1)).all { rutaLetra(n, it).exists() }
        return JSONObject()
            .put("cantado", rutaAudio(n, "cantado").exists())
            .put("instrumental", rutaAudio(n, "instrumental").exists())
            .put("letra", letra)
    }

    private fun asegurarLetra(h: JSONObject, i: Int): File {
        val n = h.getInt("numero")
        val f = rutaLetra(n, i)
        if (!f.exists()) bajarArchivo("$origen/Letra/${tres(n)}/${dos(i)}.jpg", f)
        return f
    }

    private fun asegurarAudio(h: JSONObject, tipo: String): File {
        val n = h.getInt("numero")
        val f = rutaAudio(n, tipo)
        if (!f.exists()) bajarArchivo("$origen/Musica/${tiposAudio[tipo]}/${tres(n)}.mp3", f)
        return f
    }

    // ===================== Biblia y meditaciones =====================

    private val libros = mapOf(
        "genesis" to "GEN", "exodo" to "EXO", "levitico" to "LEV", "numeros" to "NUM", "deuteronomio" to "DEU",
        "josue" to "JOS", "jueces" to "JDG", "rut" to "RUT", "1 samuel" to "1SA", "2 samuel" to "2SA",
        "1 reyes" to "1KI", "2 reyes" to "2KI", "1 cronicas" to "1CH", "2 cronicas" to "2CH", "esdras" to "EZR",
        "nehemias" to "NEH", "ester" to "EST", "job" to "JOB", "salmo" to "PSA", "salmos" to "PSA",
        "proverbios" to "PRO", "eclesiastes" to "ECC", "cantares" to "SOL", "isaias" to "ISA", "jeremias" to "JER",
        "lamentaciones" to "LAM", "ezequiel" to "EZE", "daniel" to "DAN", "oseas" to "HOS", "joel" to "JOE",
        "amos" to "AMO", "abdias" to "OBA", "jonas" to "JON", "miqueas" to "MIC", "nahum" to "NAH",
        "habacuc" to "HAB", "sofonias" to "ZEP", "hageo" to "HAG", "zacarias" to "ZEC", "malaquias" to "MAL",
        "mateo" to "MAT", "marcos" to "MAR", "lucas" to "LUK", "juan" to "JOH", "hechos" to "ACT",
        "romanos" to "ROM", "1 corintios" to "1CO", "2 corintios" to "2CO", "galatas" to "GAL", "efesios" to "EPH",
        "filipenses" to "PHI", "colosenses" to "COL", "1 tesalonicenses" to "1TH", "2 tesalonicenses" to "2TH",
        "1 timoteo" to "1TI", "2 timoteo" to "2TI", "tito" to "TIT", "filemon" to "PHM", "hebreos" to "HEB",
        "santiago" to "JAM", "1 pedro" to "1PE", "2 pedro" to "2PE", "1 juan" to "1JO", "2 juan" to "2JO",
        "3 juan" to "3JO", "judas" to "JUD", "apocalipsis" to "REV",
    )

    private val biblia: JSONObject by lazy {
        JSONObject(leerTextoAsset("datos/biblia-rv1909.json")).getJSONObject("libros")
    }
    private val meditacionesTema: JSONObject by lazy { JSONObject(leerTextoAsset("datos/meditaciones.json")) }
    private val meditacionesHimno: JSONObject by lazy {
        try { JSONObject(leerTextoAsset("datos/meditaciones-himnos.json")) } catch (e: Exception) { JSONObject() }
    }

    // "Juan 14:16-18, 26" -> [{v:'14:16', t:'…'}, …]   "Salmo 23" -> capítulo completo
    private fun textoDeCita(referencia: String): JSONArray {
        val salida = JSONArray()
        val m = Regex("^(.+?)\\s+(\\d+)(?::(.+))?$").find(referencia.trim()) ?: return salida
        val codigo = libros[sinTildes(m.groupValues[1])] ?: return salida
        val capitulo = biblia.optJSONObject(codigo)?.optJSONObject(m.groupValues[2]) ?: return salida
        val numeros = mutableListOf<Int>()
        if (m.groupValues[3].isNotEmpty()) {
            for (tramo in m.groupValues[3].split(',')) {
                val lim = tramo.split('-').map { it.trim().toIntOrNull() }
                val desde = lim.getOrNull(0) ?: continue
                val hasta = lim.getOrNull(1) ?: desde
                var v = desde
                while (v <= hasta && v - desde < 60) { numeros += v; v++ }
            }
        } else {
            capitulo.keys().forEach { k -> k.toIntOrNull()?.let { numeros += it } }
            numeros.sort()
        }
        numeros.forEach { v ->
            if (capitulo.has(v.toString())) salida.put(JSONObject().put("v", "${m.groupValues[2]}:$v").put("t", capitulo.getString(v.toString())))
        }
        return salida
    }

    // Orden: la que escribiste tú > la hecha para ese himno > una de su tema
    private fun meditacionDe(h: JSONObject): JSONObject? {
        val n = h.getInt("numero").toString()
        val propias = leerObjeto("mis-meditaciones.json")
        val m: JSONObject = when {
            propias.has(n) -> JSONObject(propias.getJSONObject(n).toString()).put("propia", true)
            meditacionesHimno.has(n) -> JSONObject(meditacionesHimno.getJSONObject(n).toString()).put("propia", false).put("delHimno", true)
            else -> {
                val lista = meditacionesTema.optJSONArray(h.optString("tema")) ?: return null
                if (lista.length() == 0) return null
                JSONObject(lista.getJSONObject(h.getInt("numero") % lista.length()).toString()).put("propia", false)
            }
        }
        val citas = m.optJSONArray("citas") ?: JSONArray()
        for (i in 0 until citas.length()) {
            val c = citas.getJSONObject(i)
            c.put("versiculos", textoDeCita(c.optString("referencia")))
        }
        m.put("citas", citas)
        return m
    }

    // ===================== YouTube =====================

    private fun leerEnlaceYoutube(texto: String): JSONObject? {
        val url = try { java.net.URI(texto.trim()) } catch (e: Exception) { return null }
        val host = (url.host ?: return null).removePrefix("www.").removePrefix("m.").removePrefix("music.")
        val valido = { id: String? -> if (id != null && Regex("^[\\w-]{6,64}$").matches(id)) id else null }
        val consulta = (url.rawQuery ?: "").split('&').mapNotNull {
            val p = it.split('='); if (p.size == 2) p[0] to java.net.URLDecoder.decode(p[1], "UTF-8") else null
        }.toMap()
        if (host == "youtu.be") return valido(url.path.trimStart('/'))?.let { JSONObject().put("tipo", "video").put("id", it) }
        if (host != "youtube.com" && host != "youtube-nocookie.com") return null
        val video = valido(consulta["v"]) ?: valido(Regex("^/(?:shorts|embed|live)/([\\w-]+)").find(url.path ?: "")?.groupValues?.get(1))
        if (video != null) return JSONObject().put("tipo", "video").put("id", video)
        return valido(consulta["list"])?.let { JSONObject().put("tipo", "lista").put("id", it) }
    }

    // 200 -> ok · 401/403 -> no-embebible · 400/404 -> no-existe · sin respuesta -> desconocido
    private fun infoYoutube(tipo: String, id: String): JSONObject {
        val destino = if (tipo == "video") "https://www.youtube.com/watch?v=$id" else "https://www.youtube.com/playlist?list=$id"
        return try {
            val c = conexion("https://www.youtube.com/oembed?format=json&url=${URLEncoder.encode(destino, "UTF-8")}")
            when (c.responseCode) {
                in 200..299 -> JSONObject().put("titulo", JSONObject(c.inputStream.use { String(it.readBytes()) }).optString("title").take(200)).put("estado", "ok")
                401, 403 -> JSONObject().put("titulo", "").put("estado", "no-embebible")
                400, 404 -> JSONObject().put("titulo", "").put("estado", "no-existe")
                else -> JSONObject().put("titulo", "").put("estado", "desconocido")
            }
        } catch (e: Exception) {
            JSONObject().put("titulo", "").put("estado", "desconocido")
        }
    }

    private fun tituloYoutube(tipo: String, id: String) =
        infoYoutube(tipo, id).optString("titulo").ifEmpty { if (tipo == "lista") "Lista de reproducción" else "Video" }

    private val revisarNoDisponiblesCada = 7L * 24 * 3600 * 1000

    private fun normalizarInfo(v: Any?): JSONObject? = when (v) {
        is String -> JSONObject().put("titulo", v).put("estado", "ok").put("revisado", 0)
        is JSONObject -> v
        else -> null
    }

    private fun infoDeVideos(ids: List<String>): JSONObject {
        val cache = leerObjeto("youtube-titulos.json")
        val ahora = System.currentTimeMillis()
        val faltan = ids.filter { id ->
            val info = normalizarInfo(cache.opt(id))
            info == null || (info.optString("estado") != "ok" && ahora - info.optLong("revisado") > revisarNoDisponiblesCada)
        }
        var cambio = false
        // De a 8 a la vez para no saturar la conexión
        faltan.chunked(8).forEach { grupo ->
            val hilos = grupo.map { id -> Thread { val info = infoYoutube("video", id); synchronized(cache) {
                if (info.optString("estado") != "desconocido") {
                    val anterior = normalizarInfo(cache.opt(id))
                    cache.put(id, JSONObject().put("titulo", info.optString("titulo").ifEmpty { anterior?.optString("titulo") ?: "" })
                        .put("estado", info.optString("estado")).put("revisado", ahora))
                    cambio = true
                }
            } }.apply { start() } }
            hilos.forEach { it.join() }
        }
        if (cambio) guardar("youtube-titulos.json", cache.toString())
        val salida = JSONObject()
        ids.forEach { id -> salida.put(id, normalizarInfo(cache.opt(id)) ?: JSONObject().put("titulo", "").put("estado", "desconocido")) }
        return salida
    }

    // ===================== Google Drive =====================

    private fun tituloDeArchivo(nombre: String) = nombre
        .replace(extAudio, "").replace('_', ' ')
        .replace(Regex("([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])"), "$1 $2")
        .replace(Regex("\\s+"), " ").trim()

    private fun listarCarpetaDrive(id: String, ruta: String = "", profundidad: Int = 0): List<JSONObject> {
        val html = bajarTexto("https://drive.google.com/embeddedfolderview?id=${URLEncoder.encode(id, "UTF-8")}")
        val salida = mutableListOf<JSONObject>()
        Regex("<div class=\"flip-entry\" id=\"entry-([\\w-]+)\"[\\s\\S]*?href=\"([^\"]+)\"[\\s\\S]*?flip-entry-title\">([^<]*)")
            .findAll(html).forEach { m ->
                val (eid, enlace, crudo) = m.destructured
                val nombre = decodificarHtml(crudo).trim()
                if (enlace.contains("/folders/")) {
                    if (profundidad < 3) salida += listarCarpetaDrive(eid, if (ruta.isEmpty()) nombre else "$ruta / $nombre", profundidad + 1)
                } else if (extAudio.containsMatchIn(nombre)) {
                    salida += JSONObject().put("id", eid).put("nombre", nombre).put("titulo", tituloDeArchivo(nombre)).put("subcarpeta", ruta)
                }
            }
        return salida
    }

    private fun idDeCarpetaDrive(t: String): String? {
        val s = t.trim()
        return Regex("/folders/([\\w-]{10,})").find(s)?.groupValues?.get(1)
            ?: Regex("[?&]id=([\\w-]{10,})").find(s)?.groupValues?.get(1)
            ?: Regex("^([\\w-]{20,})$").find(s)?.groupValues?.get(1)
    }

    private fun carpetasMusica() = leerArreglo("musica.json", JSONArray().put(carpetaDriveInicial))

    private fun extension(nombre: String) = nombre.substringAfterLast('.', "").lowercase().let { if (it.isEmpty()) "" else ".$it" }
    private fun rutaCancion(c: JSONObject) = File(dirMusica, c.getString("id") + extension(c.getString("nombre")))

    private fun listaMusica(): JSONObject {
        val carpetas = carpetasMusica()
        val cache = leerObjeto("musica-cache.json")
        var sinConexion = false
        val canciones = mutableListOf<JSONObject>()
        for (i in 0 until carpetas.length()) {
            val carpeta = carpetas.getJSONObject(i)
            val id = carpeta.getString("id")
            try {
                cache.put(id, JSONArray(listarCarpetaDrive(id)))
            } catch (e: Exception) {
                Log.w(ServidorHttp.TAG, "Drive $id: ${e.message}")
                sinConexion = true
            }
            val lista = cache.optJSONArray(id) ?: JSONArray()
            for (k in 0 until lista.length()) canciones += JSONObject(lista.getJSONObject(k).toString()).put("carpeta", carpeta.optString("nombre"))
        }
        guardar("musica-cache.json", cache.toString())
        canciones.forEach { it.put("guardada", rutaCancion(it).exists()) }
        canciones.sortWith(compareBy(java.text.Collator.getInstance(java.util.Locale("es"))) { it.optString("titulo") })
        return JSONObject().put("carpetas", carpetas).put("canciones", JSONArray(canciones)).put("sinConexion", sinConexion)
    }

    private fun cancionConocida(id: String): JSONObject? {
        val cache = leerObjeto("musica-cache.json")
        cache.keys().forEach { k ->
            val lista = cache.optJSONArray(k) ?: return@forEach
            for (i in 0 until lista.length()) if (lista.getJSONObject(i).optString("id") == id) return lista.getJSONObject(i)
        }
        return null
    }

    private fun asegurarCancion(c: JSONObject): File {
        val f = rutaCancion(c)
        if (!f.exists()) bajarArchivo("https://drive.usercontent.google.com/download?id=${URLEncoder.encode(c.getString("id"), "UTF-8")}&export=download", f, rechazarHtml = true)
        return f
    }

    // ===================== hoja de Google de la iglesia =====================
    // Roles, ancianos, cumpleaños y líderes vienen de la hoja compartida. Con internet se descarga
    // cada pestaña como CSV y se guarda en el celular; sin internet se usa esa última copia.

    private val hojaId = "1klO4DD1TQn3tZgQt3XIb5oLFUmiUYhTxItrss6NhXEU"
    private val hojaUrl = "https://docs.google.com/spreadsheets/d/$hojaId/edit"

    // CSV con comillas, comas y saltos de línea dentro de los campos -> lista de filas (título -> valor)
    private fun leerCsv(texto: String): List<Map<String, String>> {
        val filas = mutableListOf<MutableList<String>>()
        var fila = mutableListOf<String>()
        val campo = StringBuilder()
        var comillas = false
        var i = 0
        while (i < texto.length) {
            val c = texto[i]
            if (comillas) {
                if (c == '"' && i + 1 < texto.length && texto[i + 1] == '"') { campo.append('"'); i++ }
                else if (c == '"') comillas = false
                else campo.append(c)
            } else when (c) {
                '"' -> comillas = true
                ',' -> { fila.add(campo.toString()); campo.clear() }
                '\n', '\r' -> {
                    if (c == '\r' && i + 1 < texto.length && texto[i + 1] == '\n') i++
                    fila.add(campo.toString()); campo.clear(); filas.add(fila); fila = mutableListOf()
                }
                else -> campo.append(c)
            }
            i++
        }
        if (campo.isNotEmpty() || fila.isNotEmpty()) { fila.add(campo.toString()); filas.add(fila) }
        val utiles = filas.filter { f -> f.any { it.isNotBlank() } }
        if (utiles.isEmpty()) return emptyList()
        val claves = utiles[0].map { sinTildes(it) }
        return utiles.drop(1).map { f -> claves.mapIndexed { j, k -> k to (f.getOrNull(j) ?: "").trim() }.toMap() }
    }

    private fun bajarPestana(nombre: String): List<Map<String, String>> {
        val texto = bajarTexto("https://docs.google.com/spreadsheets/d/$hojaId/gviz/tq?tqx=out:csv&sheet=${URLEncoder.encode(nombre, "UTF-8").replace("+", "%20")}")
        if (texto.take(200).contains("<html", ignoreCase = true)) throw Exception("La hoja no está compartida con enlace")
        return leerCsv(texto)
    }

    private val diasSemana = mapOf("domingo" to 7, "lunes" to 1, "martes" to 2, "miercoles" to 3, "jueves" to 4, "viernes" to 5, "sabado" to 6)

    // "03/10/2026" (día/mes/año) o "2026-10-03". Si el día de la semana no coincide, se prueba mes/día.
    private fun fechaIso(texto: String, diaSemana: Int?): java.time.LocalDate? {
        val t = texto.trim()
        Regex("^(\\d{4})-(\\d{1,2})-(\\d{1,2})").find(t)?.let { m ->
            return try { java.time.LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) } catch (e: Exception) { null }
        }
        val m = Regex("^(\\d{1,2})/(\\d{1,2})/(\\d{4})").find(t) ?: return null
        val (a, b, anio) = m.destructured
        val opcion1 = try { java.time.LocalDate.of(anio.toInt(), b.toInt(), a.toInt()) } catch (e: Exception) { null }
        val opcion2 = try { java.time.LocalDate.of(anio.toInt(), a.toInt(), b.toInt()) } catch (e: Exception) { null }
        if (diaSemana != null && opcion1?.dayOfWeek?.value != diaSemana && opcion2?.dayOfWeek?.value == diaSemana) return opcion2
        return opcion1
    }

    private fun idDeArchivoDrive(enlace: String): String? =
        Regex("/d/([\\w-]{10,})").find(enlace)?.groupValues?.get(1) ?: Regex("[?&]id=([\\w-]{10,})").find(enlace)?.groupValues?.get(1)

    private fun bajarFotoDrive(id: String, destino: File) {
        val c = conexion("https://drive.usercontent.google.com/download?id=$id&export=download")
        if (c.responseCode !in 200..299 || !(c.contentType ?: "").startsWith("image/")) throw Exception("no es una imagen pública")
        destino.parentFile?.mkdirs()
        val parte = File(destino.path + ".part")
        c.inputStream.use { e -> parte.outputStream().use { e.copyTo(it) } }
        parte.renameTo(destino)
    }

    private val candadoHoja = Any()

    /** Descarga la hoja y la guarda en el celular. Si falla, queda la copia anterior. */
    fun sincronizarHoja(soloCumpleanos: Boolean = false): JSONObject = synchronized(candadoHoja) {
        val archivoEstado = File(dirDatos, "sincronizacion.json")
        try {
            val avisos = JSONArray()
            if (!soloCumpleanos) {
                // Base: la copia del celular o, la primera vez, la que viene en la APK (con las fotos)
                val anterior = try { JSONObject(File(dirDatos, "roles.json").readText()) } catch (e: Exception) {
                    try { JSONObject(leerTextoAsset("datos/roles.json")) } catch (x: Exception) { JSONObject() }
                }
                val roles = JSONObject()
                val sabados = JSONObject(); val miercoles = JSONObject(); val meses = JSONObject()
                for (f in bajarPestana("Roles")) {
                    val fecha = fechaIso(f["fecha"] ?: "", diasSemana[sinTildes(f["dia"] ?: "")])
                    if (fecha == null) { if (!f["fecha"].isNullOrEmpty()) avisos.put("Fecha no válida: ${f["fecha"]}"); continue }
                    val quien = f["predicador / a cargo"] ?: f["predicador"] ?: ""
                    when (fecha.dayOfWeek) {
                        java.time.DayOfWeek.WEDNESDAY -> miercoles.put(fecha.toString(), JSONObject().put("predicador", quien))
                        java.time.DayOfWeek.SATURDAY -> sabados.put(fecha.toString(), JSONObject().put("predicador", quien)
                            .put("acompanantes", f["acompanantes"] ?: "").put("ja", f["ja tarde"] ?: "").put("flores", f["flores"] ?: ""))
                        else -> avisos.put("${f["fecha"]} no es sábado ni miércoles")
                    }
                }
                val previosMeses = anterior.optJSONObject("meses") ?: JSONObject()
                for (f in bajarPestana("Ancianos")) {
                    val anio = (f["ano"] ?: f["año"])?.toIntOrNull() ?: continue
                    val mes = f["mes"]?.toIntOrNull()?.takeIf { it in 1..12 } ?: continue
                    val clave = "%d-%02d".format(anio, mes)
                    val dato = JSONObject().put("anciano", f["anciano de turno"] ?: "")
                    val idFoto = idDeArchivoDrive(f["foto (enlace de google drive)"] ?: f["foto"] ?: "")
                    val previo = previosMeses.optJSONObject(clave) ?: JSONObject()
                    val archivoFoto = File(dirFotos, "anciano-$clave.jpg")
                    if (idFoto != null && previo.optString("fotoId") != idFoto) {
                        try {
                            bajarFotoDrive(idFoto, archivoFoto)
                            dato.put("foto", System.currentTimeMillis()).put("fotoId", idFoto)
                        } catch (e: Exception) {
                            avisos.put("No se pudo bajar la foto de $clave: ${e.message}")
                            if (previo.has("foto")) dato.put("foto", previo.get("foto"))
                        }
                    } else if (previo.has("foto")) {
                        // Se conserva la foto que ya había (la bajada antes o la que viene en la APK)
                        dato.put("foto", previo.get("foto"))
                        if (previo.has("fotoId")) dato.put("fotoId", previo.get("fotoId"))
                    }
                    meses.put(clave, dato)
                }
                roles.put("meses", meses).put("sabados", sabados).put("miercoles", miercoles)
                guardar("roles.json", roles.toString())

                val lideres = JSONArray()
                for (f in bajarPestana("Líderes")) {
                    val nombre = f["nombre"] ?: ""
                    val gestion = f["gestion"] ?: ""
                    if (nombre.isEmpty() || gestion.isEmpty()) continue
                    val l = JSONObject().put("gestion", gestion).put("nombre", nombre).put("cargo", f["cargo"] ?: "").put("celular", f["celular"] ?: "")
                    idDeArchivoDrive(f["foto"] ?: f["foto (enlace de google drive)"] ?: "")?.let { id ->
                        val archivo = File(dirFotos, "lider-$id.jpg")
                        try {
                            if (!archivo.exists()) bajarFotoDrive(id, archivo)
                            l.put("foto", archivo.name)
                        } catch (e: Exception) { avisos.put("No se pudo bajar la foto de $nombre: ${e.message}") }
                    }
                    lideres.put(l)
                }
                guardar("lideres.json", JSONObject().put("lideres", lideres).toString())
            }

            val personas = bajarPestana("Cumpleaños").mapNotNull { f ->
                val nombre = f["nombre"] ?: return@mapNotNull null
                val dia = f["dia"]?.toIntOrNull()?.takeIf { it in 1..31 } ?: return@mapNotNull null
                val mes = f["mes"]?.toIntOrNull()?.takeIf { it in 1..12 } ?: return@mapNotNull null
                if (nombre.isBlank()) null else JSONObject().put("nombre", nombre).put("dia", dia).put("mes", mes)
            }.sortedWith(compareBy({ it.getInt("mes") }, { it.getInt("dia") }, { it.getString("nombre") }))
            guardar("cumpleanos.json", JSONObject().put("origen", "Google Sheets").put("personas", JSONArray(personas)).toString())

            val estado = JSONObject().put("ok", true).put("fecha", java.time.Instant.now().toString()).put("avisos", avisos)
            if (!soloCumpleanos) guardar("sincronizacion.json", estado.toString())
            estado
        } catch (e: Exception) {
            Log.w(ServidorHttp.TAG, "Hoja de Google: ${e.message}")
            val previo = try { JSONObject(archivoEstado.readText()) } catch (x: Exception) { JSONObject() }
            previo.put("ok", false).put("error", e.message ?: "sin conexión").put("intento", java.time.Instant.now().toString())
            if (!soloCumpleanos) guardar("sincronizacion.json", previo.toString())
            previo
        }
    }

    private fun estadoHoja(): JSONObject {
        val f = File(dirDatos, "sincronizacion.json")
        val estado = try { JSONObject(f.readText()) } catch (e: Exception) { JSONObject() }
        return estado.put("url", hojaUrl)
    }

    // ===================== archivos de la interfaz =====================

    private val tiposMime = mapOf(
        "html" to "text/html; charset=utf-8", "css" to "text/css; charset=utf-8", "js" to "text/javascript; charset=utf-8",
        "json" to "application/json; charset=utf-8", "svg" to "image/svg+xml", "webmanifest" to "application/manifest+json",
        "mp3" to "audio/mpeg", "mpeg" to "audio/mpeg", "m4a" to "audio/mp4", "mp4" to "video/mp4", "aac" to "audio/aac",
        "wav" to "audio/wav", "ogg" to "audio/ogg", "oga" to "audio/ogg", "opus" to "audio/ogg", "flac" to "audio/flac",
        "webm" to "video/webm", "jpg" to "image/jpeg", "png" to "image/png",
    )
    private fun mime(nombre: String) = tiposMime[nombre.substringAfterLast('.').lowercase()] ?: "application/octet-stream"

    private fun servirArchivo(f: File) =
        if (f.exists()) ServidorHttp.Respuesta(200, mime(f.name), archivo = f, cabeceras = mapOf("Cache-Control" to "public, max-age=86400"))
        else json(404, """{"error":"No encontrado"}""")

    private fun servirInterfaz(ruta: String): ServidorHttp.Respuesta {
        val relativa = if (ruta == "/" || ruta.isEmpty()) "index.html" else ruta.trimStart('/')
        if (relativa.contains("..")) throw ErrorCliente(403, "Prohibido")
        return try {
            val bytes = ctx.assets.open("web/$relativa").use { it.readBytes() }
            ServidorHttp.Respuesta(200, mime(relativa), bytes, cabeceras = mapOf("Cache-Control" to "no-cache"))
        } catch (e: Exception) {
            json(404, """{"error":"No encontrado"}""")
        }
    }

    // ===================== rutas =====================

    fun manejar(p: ServidorHttp.Peticion): ServidorHttp.Respuesta {
        val partes = p.partes
        if (partes.firstOrNull() != "api" && partes.firstOrNull() != "medios") return servirInterfaz(p.ruta)

        if (partes[0] == "medios") return medios(partes)

        val cuerpo = { if (p.cuerpo.isEmpty()) JSONObject() else try { JSONObject(p.texto()) } catch (e: Exception) { throw ErrorCliente(400, "JSON inválido") } }
        val ruta = "${p.metodo} /${partes.drop(1).joinToString("/")}"

        when (ruta) {
            "GET /himnos" -> {
                val favoritos = leerArreglo("favoritos.json").let { a -> (0 until a.length()).map { a.getInt(it) }.toSet() }
                val lista = JSONArray()
                for (i in 0 until catalogo.length()) {
                    val h = copiar(catalogo.getJSONObject(i))
                    h.put("favorito", favoritos.contains(h.getInt("numero"))).put("descargado", estadoDescarga(h))
                    lista.put(h)
                }
                val arrTemas = JSONArray()
                temas.forEach { arrTemas.put(JSONObject().put("id", it.id).put("nombre", it.nombre).put("desde", it.desde).put("hasta", it.hasta)) }
                return json(200, JSONObject().put("temas", arrTemas).put("himnos", lista).toString())
            }
            "POST /catalogo/actualizar" -> return try {
                json(200, JSONObject().put("total", actualizarCatalogo().length()).toString())
            } catch (e: Exception) {
                throw ErrorCliente(503, "No se pudo actualizar el catálogo. ¿Hay internet?")
            }
            "GET /hoja" -> return json(200, estadoHoja().toString())
            "POST /hoja/sincronizar" -> {
                val siPasaron = cuerpo().optLong("siPasaron", 0)
                val previo = estadoHoja()
                val ultima = try { java.time.Instant.parse(previo.optString("fecha")).toEpochMilli() } catch (e: Exception) { 0L }
                // No volver a bajar si la última vez (exitosa) fue hace menos de "siPasaron" segundos
                if (siPasaron > 0 && previo.optBoolean("ok") && System.currentTimeMillis() - ultima < siPasaron * 1000) {
                    return json(200, previo.put("cambio", false).toString())
                }
                sincronizarHoja()
                return json(200, estadoHoja().put("cambio", true).toString())
            }
            // Líderes por gestión (nombre, cargo, celular)
            "GET /lideres" -> {
                val propio = File(dirDatos, "lideres.json")
                val texto = try {
                    if (propio.exists()) propio.readText() else leerTextoAsset("datos/lideres.json")
                } catch (e: Exception) {
                    return json(200, "[]")
                }
                return json(200, (JSONObject(texto).optJSONArray("lideres") ?: JSONArray()).toString())
            }
            // Cumpleaños de los miembros (viene en la APK; si se copia uno nuevo a datos/ manda ese)
            "GET /cumpleanos" -> {
                val propio = File(dirDatos, "cumpleanos.json")
                val texto = try {
                    if (propio.exists()) propio.readText() else leerTextoAsset("datos/cumpleanos.json")
                } catch (e: Exception) {
                    return json(200, "[]")
                }
                return json(200, (JSONObject(texto).optJSONArray("personas") ?: JSONArray()).toString())
            }
            "GET /fondo/pistas" -> {
                val lista = JSONArray()
                (dirFondo.listFiles() ?: emptyArray()).filter { extFondo.containsMatchIn(it.name) }.sortedBy { it.name.lowercase() }.forEach {
                    lista.put(JSONObject().put("archivo", it.name).put("titulo", it.name.replace(extFondo, "").trim()))
                }
                return json(200, lista.toString())
            }
            "GET /musica" -> return json(200, listaMusica().toString())
            "POST /musica/carpetas" -> {
                val id = idDeCarpetaDrive(cuerpo().optString("url")) ?: throw ErrorCliente(400, "Pega el enlace de una carpeta de Google Drive")
                val carpetas = carpetasMusica()
                if ((0 until carpetas.length()).none { carpetas.getJSONObject(it).optString("id") == id }) {
                    val archivos = try { listarCarpetaDrive(id) } catch (e: Exception) { throw ErrorCliente(400, "No se pudo abrir la carpeta. ¿Es pública y hay internet?") }
                    carpetas.put(JSONObject().put("id", id).put("nombre", "Carpeta ${carpetas.length() + 1} (${archivos.size} audios)"))
                    guardar("musica.json", carpetas.toString())
                }
                return json(200, listaMusica().toString())
            }
            "GET /videos" -> return json(200, leerArreglo("videos.json").toString())
            "POST /videos/titulos" -> {
                val ids = cuerpo().optJSONArray("ids") ?: JSONArray()
                val validos = (0 until ids.length()).map { ids.optString(it) }.filter { Regex("^[\\w-]{6,64}$").matches(it) }.take(300)
                return json(200, infoDeVideos(validos).toString())
            }
            "POST /videos/no-disponible" -> {
                val c = cuerpo()
                val id = c.optString("id")
                if (!Regex("^[\\w-]{6,64}$").matches(id)) throw ErrorCliente(400, "Video inválido")
                val estado = c.optString("estado").takeIf { it in listOf("no-existe", "no-embebible", "error") } ?: "error"
                val cache = leerObjeto("youtube-titulos.json")
                val info = JSONObject().put("titulo", normalizarInfo(cache.opt(id))?.optString("titulo") ?: "").put("estado", estado).put("revisado", System.currentTimeMillis())
                cache.put(id, info)
                guardar("youtube-titulos.json", cache.toString())
                return json(200, info.toString())
            }
            "POST /videos" -> {
                val c = cuerpo()
                val enlaces = c.optString("url").split(Regex("\\s+")).filter { it.isNotBlank() }
                if (enlaces.isEmpty()) throw ErrorCliente(400, "Pega uno o más enlaces de YouTube")
                val videos = leerArreglo("videos.json")
                var agregados = 0
                val invalidos = JSONArray()
                for (e in enlaces.take(100)) {
                    val enlace = leerEnlaceYoutube(e)
                    if (enlace == null) { invalidos.put(e); continue }
                    val ya = (0 until videos.length()).any { videos.getJSONObject(it).optString("tipo") == enlace.getString("tipo") && videos.getJSONObject(it).optString("id") == enlace.getString("id") }
                    if (ya) continue
                    val titulo = c.optString("titulo").trim().takeIf { enlaces.size == 1 && it.isNotEmpty() } ?: tituloYoutube(enlace.getString("tipo"), enlace.getString("id"))
                    videos.put(enlace.put("titulo", titulo.take(200)).put("agregado", java.time.Instant.now().toString()))
                    agregados++
                }
                if (agregados == 0 && invalidos.length() > 0) throw ErrorCliente(400, "Ese enlace no parece de YouTube")
                guardar("videos.json", videos.toString())
                return json(200, JSONObject().put("agregados", agregados).put("invalidos", invalidos).put("videos", videos).toString())
            }
        }

        // Roles del sábado: la primera vez se parte de los que vienen en la APK; los cambios
        // se guardan en el celular
        if (partes.getOrNull(1) == "roles") {
            val propio = File(dirDatos, "roles.json")
            fun leerRoles(): JSONObject = try {
                JSONObject(if (propio.exists()) propio.readText() else leerTextoAsset("datos/roles.json"))
            } catch (e: Exception) {
                JSONObject().put("meses", JSONObject()).put("sabados", JSONObject())
            }
            fun limpiar(t: String) = t.trim().take(200)
            if (p.metodo == "GET" && partes.size == 2) return json(200, leerRoles().toString())
            if (p.metodo == "PUT" && partes.getOrNull(2) == "sabado" && partes.size >= 4) {
                val fecha = partes[3]
                val esSabado = try {
                    java.time.LocalDate.parse(fecha).dayOfWeek == java.time.DayOfWeek.SATURDAY
                } catch (e: Exception) { false }
                if (!esSabado) throw ErrorCliente(400, "La fecha debe ser un sábado (AAAA-MM-DD)")
                val c = cuerpo()
                val roles = leerRoles()
                val sabados = roles.optJSONObject("sabados") ?: JSONObject().also { roles.put("sabados", it) }
                val dato = JSONObject().put("predicador", limpiar(c.optString("predicador")))
                    .put("acompanantes", limpiar(c.optString("acompanantes"))).put("ja", limpiar(c.optString("ja")))
                    .put("flores", limpiar(c.optString("flores")))
                val vacio = listOf("predicador", "acompanantes", "ja", "flores").all { dato.optString(it).isEmpty() }
                if (vacio) sabados.remove(fecha) else sabados.put(fecha, dato)
                guardar("roles.json", roles.toString())
                return json(200, roles.toString())
            }
            // Miércoles de culto: quién lo dirige
            if (p.metodo == "PUT" && partes.getOrNull(2) == "miercoles" && partes.size >= 4) {
                val fecha = partes[3]
                val esMiercoles = try {
                    java.time.LocalDate.parse(fecha).dayOfWeek == java.time.DayOfWeek.WEDNESDAY
                } catch (e: Exception) { false }
                if (!esMiercoles) throw ErrorCliente(400, "La fecha debe ser un miércoles (AAAA-MM-DD)")
                val quien = limpiar(cuerpo().optString("predicador"))
                val roles = leerRoles()
                val miercoles = roles.optJSONObject("miercoles") ?: JSONObject().also { roles.put("miercoles", it) }
                if (quien.isEmpty()) miercoles.remove(fecha) else miercoles.put(fecha, JSONObject().put("predicador", quien))
                guardar("roles.json", roles.toString())
                return json(200, roles.toString())
            }
            // Foto del anciano de turno (llega achicada desde la app, JPEG en base64)
            if (p.metodo == "PUT" && partes.getOrNull(2) == "mes" && partes.size >= 5 && partes[4] == "foto") {
                val mes = partes[3]
                if (!Regex("^\\d{4}-\\d{2}$").matches(mes)) throw ErrorCliente(400, "El mes debe ser AAAA-MM")
                val m = Regex("^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$").find(cuerpo().optString("imagen"))
                    ?: throw ErrorCliente(400, "Imagen no válida")
                dirFotos.mkdirs()
                File(dirFotos, "anciano-$mes.jpg").writeBytes(android.util.Base64.decode(m.groupValues[1], android.util.Base64.DEFAULT))
                val roles = leerRoles()
                val meses = roles.optJSONObject("meses") ?: JSONObject().also { roles.put("meses", it) }
                val datosMes = meses.optJSONObject(mes) ?: JSONObject().also { meses.put(mes, it) }
                datosMes.put("foto", System.currentTimeMillis())
                guardar("roles.json", roles.toString())
                return json(200, roles.toString())
            }
            if (p.metodo == "PUT" && partes.getOrNull(2) == "mes" && partes.size >= 4) {
                val mes = partes[3]
                if (!Regex("^\\d{4}-\\d{2}$").matches(mes)) throw ErrorCliente(400, "El mes debe ser AAAA-MM")
                val anciano = limpiar(cuerpo().optString("anciano"))
                val roles = leerRoles()
                val meses = roles.optJSONObject("meses") ?: JSONObject().also { roles.put("meses", it) }
                // Se conserva la foto si ya había una
                val datosMes = meses.optJSONObject(mes) ?: JSONObject()
                datosMes.put("anciano", anciano)
                if (anciano.isEmpty() && !datosMes.has("foto")) meses.remove(mes) else meses.put(mes, datosMes)
                guardar("roles.json", roles.toString())
                return json(200, roles.toString())
            }
        }

        if (p.metodo == "DELETE" && partes.getOrNull(1) == "videos" && partes.size >= 4) {
            val videos = leerArreglo("videos.json")
            val restantes = JSONArray()
            for (i in 0 until videos.length()) {
                val v = videos.getJSONObject(i)
                if (!(v.optString("tipo") == partes[2] && v.optString("id") == partes[3])) restantes.put(v)
            }
            guardar("videos.json", restantes.toString())
            return json(200, restantes.toString())
        }

        if (p.metodo == "DELETE" && partes.getOrNull(1) == "musica" && partes.getOrNull(2) == "carpetas" && partes.size >= 4) {
            val carpetas = carpetasMusica()
            val restantes = JSONArray()
            for (i in 0 until carpetas.length()) if (carpetas.getJSONObject(i).optString("id") != partes[3]) restantes.put(carpetas.getJSONObject(i))
            guardar("musica.json", restantes.toString())
            return json(200, listaMusica().toString())
        }

        if (p.metodo == "POST" && partes.getOrNull(1) == "musica" && partes.getOrNull(2) == "guardar" && partes.size >= 4) {
            val c = cancionConocida(partes[3]) ?: throw ErrorCliente(404, "Canción no encontrada")
            try { asegurarCancion(c) } catch (e: Exception) { throw ErrorCliente(503, "No se pudo guardar. ¿Hay internet?") }
            return json(200, """{"guardada":true}""")
        }

        if (partes.getOrNull(1) == "himnos" && partes.size >= 3) {
            val h = himnoValido(partes[2])
            val n = h.getInt("numero")
            when (p.metodo to (partes.getOrNull(3) ?: "")) {
                "GET" to "" -> {
                    val favoritos = leerArreglo("favoritos.json")
                    val esFavorito = (0 until favoritos.length()).any { favoritos.getInt(it) == n }
                    val salida = copiar(h)
                        .put("temaNombre", temaDe(n)?.nombre ?: "")
                        .put("favorito", esFavorito)
                        .put("descargado", estadoDescarga(h))
                        .put("meditacion", meditacionDe(h) ?: JSONObject.NULL)
                        .put("letraTexto", leerObjeto("mis-letras.json").optString(n.toString(), ""))
                    return json(200, salida.toString())
                }
                "POST" to "favorito" -> {
                    val quiere = cuerpo().optBoolean("favorito")
                    val actual = leerArreglo("favoritos.json").let { a -> (0 until a.length()).map { a.getInt(it) }.toMutableSet() }
                    if (quiere) actual += n else actual -= n
                    guardar("favoritos.json", JSONArray(actual.sorted()).toString())
                    return json(200, JSONObject().put("favorito", actual.contains(n)).toString())
                }
                "POST" to "descargar" -> {
                    val tipos = cuerpo().optJSONArray("tipos")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: listOf("cantado", "instrumental")
                    try {
                        (1..h.optInt("diapositivas", 1)).forEach { asegurarLetra(h, it) }
                        tipos.filter { tiposAudio.containsKey(it) }.forEach { asegurarAudio(h, it) }
                    } catch (e: Exception) {
                        throw ErrorCliente(503, "No se pudo descargar. ¿Hay internet?")
                    }
                    return json(200, estadoDescarga(h).toString())
                }
                "PUT" to "meditacion" -> {
                    val c = cuerpo()
                    val propias = leerObjeto("mis-meditaciones.json")
                    if (c.optString("titulo").isEmpty() && c.optString("reflexion").isEmpty()) {
                        propias.remove(n.toString())
                    } else {
                        val citas = JSONArray()
                        val origenCitas = c.optJSONArray("citas") ?: JSONArray()
                        for (i in 0 until minOf(origenCitas.length(), 10)) {
                            val ci = origenCitas.optJSONObject(i) ?: continue
                            citas.put(JSONObject().put("referencia", ci.optString("referencia").take(100)).put("nota", ci.optString("nota").take(1000)))
                        }
                        propias.put(n.toString(), JSONObject().put("titulo", c.optString("titulo").take(200)).put("reflexion", c.optString("reflexion").take(5000)).put("citas", citas))
                    }
                    guardar("mis-meditaciones.json", propias.toString())
                    return json(200, (meditacionDe(h) ?: JSONObject()).toString())
                }
                "PUT" to "letra" -> {
                    val texto = cuerpo().optString("letra").replace("\r\n", "\n").trim().take(20_000)
                    val letras = leerObjeto("mis-letras.json")
                    if (texto.isEmpty()) letras.remove(n.toString()) else letras.put(n.toString(), texto)
                    guardar("mis-letras.json", letras.toString())
                    return json(200, JSONObject().put("letraTexto", texto).toString())
                }
            }
        }

        throw ErrorCliente(404, "Ruta no encontrada")
    }

    private val dirFotos = File(dirDatos, "fotos")

    private fun medios(partes: List<String>): ServidorHttp.Respuesta {
        // /medios/foto/anciano-AAAA-MM.jpg: la que se subió en el celular, o la que viene en la APK
        if (partes.getOrNull(1) == "foto" && partes.size >= 3) {
            val nombre = partes[2]
            if (!Regex("^(anciano-\\d{4}-\\d{2}|lider-[\\w-]{10,})\\.jpg$").matches(nombre)) throw ErrorCliente(400, "Archivo no válido")
            val propia = File(dirFotos, nombre)
            if (propia.exists()) return servirArchivo(propia)
            return try {
                val bytes = ctx.assets.open("datos/fotos/$nombre").use { it.readBytes() }
                ServidorHttp.Respuesta(200, "image/jpeg", bytes, cabeceras = mapOf("Cache-Control" to "public, max-age=86400"))
            } catch (e: Exception) {
                json(404, """{"error":"No encontrado"}""")
            }
        }
        // /medios/fondo/:archivo
        if (partes.getOrNull(1) == "fondo" && partes.size >= 3) {
            val nombre = partes[2]
            if (nombre.contains('/') || nombre.contains("..") || !extFondo.containsMatchIn(nombre)) throw ErrorCliente(400, "Archivo no válido")
            return servirArchivo(File(dirFondo, nombre))
        }
        // /medios/musica/:id
        if (partes.getOrNull(1) == "musica" && partes.size >= 3) {
            val c = cancionConocida(partes[2]) ?: throw ErrorCliente(404, "Canción no encontrada")
            return try { servirArchivo(asegurarCancion(c)) } catch (e: Exception) {
                Log.w(ServidorHttp.TAG, "Canción ${c.optString("nombre")}: ${e.message}")
                throw ErrorCliente(503, "No está guardada y no hay internet para bajarla")
            }
        }
        // /medios/:n/cantado.mp3 · instrumental.mp3 · letra-NN.jpg
        if (partes.size == 3) {
            val h = himnoValido(partes[1])
            val audio = Regex("^(cantado|instrumental)\\.mp3$").find(partes[2])
            val letra = Regex("^letra-(\\d{2})\\.jpg$").find(partes[2])
            try {
                if (audio != null) return servirArchivo(asegurarAudio(h, audio.groupValues[1]))
                if (letra != null) {
                    val i = letra.groupValues[1].toInt()
                    if (i < 1 || i > h.optInt("diapositivas", 1)) throw ErrorCliente(404, "Página de letra inexistente")
                    return servirArchivo(asegurarLetra(h, i))
                }
            } catch (e: ErrorCliente) {
                throw e
            } catch (e: Exception) {
                Log.w(ServidorHttp.TAG, "Himno ${h.optInt("numero")}: ${e.message}")
                throw ErrorCliente(503, "No está guardado en el celular y no hay internet para bajarlo")
            }
        }
        throw ErrorCliente(404, "Archivo no reconocido")
    }
}
