plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.marcomamani.himnario"
    compileSdk = 35
    buildToolsVersion = "35.0.1"

    defaultConfig {
        applicationId = "com.marcomamani.himnario"
        minSdk = 26
        targetSdk = 35
        versionCode = 19
        versionName = "2.8"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // La interfaz y los datos se toman del proyecto Himnario al compilar (ver prepararWeb)
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generado/assets"))
}

// Copia la interfaz y los datos del Himnario (la carpeta de arriba de android/).
// A index.html se le agregan los ajustes para celular (movil.css y movil.js).
val himnario = rootDir.resolve("..")

val prepararWeb by tasks.registering(Sync::class) {
    description = "Copia la interfaz y los datos del Himnario a la APK"
    into(layout.buildDirectory.dir("generado/assets"))

    from(himnario.resolve("web")) {
        into("web")
        filesMatching("index.html") {
            filter { linea ->
                linea
                    .replace("</head>", "  <link rel=\"stylesheet\" href=\"movil.css\">\n</head>")
                    .replace(
                        "<script src=\"flotante.js\"></script>",
                        "<script src=\"flotante.js\"></script>\n  <script src=\"movil.js\"></script>",
                    )
            }
        }
    }
    from(rootDir.resolve("movil")) { into("web") }
    from(himnario.resolve("datos")) {
        into("datos")
        // Solo lo que viene con la app; lo personal (favoritos, etc.) se crea en el celular
        include("biblia-rv1909.json", "meditaciones.json", "meditaciones-himnos.json", "catalogo.json", "cumpleanos.json", "roles.json", "lideres.json", "fotos/*.jpg")
    }

    doFirst {
        check(himnario.resolve("web/index.html").exists()) {
            "No se encontró el proyecto Himnario en ${himnario.canonicalPath}"
        }
    }
}

tasks.named("preBuild") { dependsOn(prepararWeb) }
