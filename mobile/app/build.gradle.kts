import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp") // necesario para que Room genere código en compilación
}

// ---------------------------------------------------------------------------------------------
// URLs de los microservicios POR VARIANTE (BuildConfig). Nada de esto va escrito en el código.
//  - debug: servicios locales del docker-compose vistos desde el emulador (10.0.2.2), HTTP.
//  - release (la variante de entrega): HTTPS, sin 10.0.2.2, sin localhost y sin puertos.
//    Los valores de abajo son MARCADORES (dominio .invalid, que no existe): los llena Juan Ángel
//    con las URLs de GCP, en mobile/gradle.properties o al compilar, por ejemplo:
//      gradle assembleRelease -Pretail.release.syncUrl=https://sync.ejemplo.com/
// ---------------------------------------------------------------------------------------------
val urlsLocales = mapOf(
    "API_BASE_URL" to "http://10.0.2.2:3101/", // auth-service
    "CATALOG_BASE_URL" to "http://10.0.2.2:3102/", // catalog-service
    "PRICING_BASE_URL" to "http://10.0.2.2:3103/", // pricing-service
    "SEGMENTATION_BASE_URL" to "http://10.0.2.2:3112/", // income-segmentation-service
    "AVAILABILITY_BASE_URL" to "http://10.0.2.2:3114/", // availability-service
    "SYNC_BASE_URL" to "http://10.0.2.2:3118/", // offline-sync-service
)

fun urlDeEntrega(propiedad: String, marcador: String): String =
    (project.findProperty(propiedad) as String?)?.takeIf { it.isNotBlank() } ?: marcador

val urlsEntrega = mapOf(
    "API_BASE_URL" to urlDeEntrega("retail.release.authUrl", "https://auth-service.PENDIENTE-GCP.invalid/"),
    "CATALOG_BASE_URL" to urlDeEntrega("retail.release.catalogUrl", "https://catalog-service.PENDIENTE-GCP.invalid/"),
    "PRICING_BASE_URL" to urlDeEntrega("retail.release.pricingUrl", "https://pricing-service.PENDIENTE-GCP.invalid/"),
    "SEGMENTATION_BASE_URL" to urlDeEntrega("retail.release.segmentationUrl", "https://income-segmentation-service.PENDIENTE-GCP.invalid/"),
    "AVAILABILITY_BASE_URL" to urlDeEntrega("retail.release.availabilityUrl", "https://availability-service.PENDIENTE-GCP.invalid/"),
    "SYNC_BASE_URL" to urlDeEntrega("retail.release.syncUrl", "https://offline-sync-service.PENDIENTE-GCP.invalid/"),
)

/** La variante de entrega no compila con una URL local o sin HTTPS. */
fun validarUrlsDeEntrega(urls: Map<String, String>) {
    val prohibidos = listOf("10.0.2.2", "localhost", "127.0.0.1", "0.0.0.0")
    urls.forEach { (nombre, url) ->
        val uri = URI(url)
        val problema = when {
            uri.scheme != "https" -> "debe usar https://"
            prohibidos.any { url.contains(it, ignoreCase = true) } -> "no puede apuntar a un host local"
            uri.port != -1 -> "no lleva puerto (el balanceador de GCP expone 443)"
            !url.endsWith("/") -> "debe terminar en / (Retrofit lo exige)"
            else -> null
        }
        if (problema != null) throw GradleException("release: $nombre = $url $problema.")
    }
}
validarUrlsDeEntrega(urlsEntrega)

android {
    namespace = "com.udem.retaildecision"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.udem.retaildecision"
        minSdk = 26 // mínimo razonable para EncryptedSharedPreferences + CameraX sin parches extra
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            urlsLocales.forEach { (nombre, url) -> buildConfigField("String", nombre, "\"$url\"") }
            // HTTP plano solo en debug (servicios locales). Ver android:usesCleartextTraffic en el manifiesto.
            manifestPlaceholders["usarHttpPlano"] = "true"
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            urlsEntrega.forEach { (nombre, url) -> buildConfigField("String", nombre, "\"$url\"") }
            manifestPlaceholders["usarHttpPlano"] = "false"
        }
    }

    testOptions {
        // Las pruebas unitarias corren en la JVM; si algo toca una clase de Android, recibe un valor vacío.
        unitTests.isReturnDefaultValues = true
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // --- UI: Jetpack Compose ---
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation("androidx.core:core-ktx:1.13.1")

    // --- Red: Retrofit habla JSON con las 4 APIs (requisito: móvil = solo JSON) ---
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // --- Persistencia local: Room, para RF-38 (guardado offline) ---
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // --- Corrutinas, para todo lo asíncrono (red, Room, sync) ---
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // --- Guardado seguro del token (login/token storage), requisito explícito ---
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // --- RF-34: cámara + lectura de código de barras ---
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    // --- RF-37: ubicación GPS de la tienda ---
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // --- RF-39: sincronización automática en background al reconectar ---
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    testImplementation("junit:junit:4.13.2")
    // SQLite en la JVM, para probar la migración de Room 1 → 2 sin emulador (MigracionTest).
    testImplementation("org.xerial:sqlite-jdbc:3.46.1.3")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    implementation("androidx.compose.material:material-icons-extended")
}
