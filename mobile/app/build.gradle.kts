plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp") // necesario para que Room genere código en compilación
}

android {
    namespace = "com.udem.retaildecision"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.udem.retaildecision"
        minSdk = 26 // mínimo razonable para EncryptedSharedPreferences + CameraX sin parches extra
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        // La URL base del decision-service / gateway se inyecta como BuildConfig
        // para no hardcodear el host en el código y poder cambiarlo por build type
        // (ej. emulador vs. dispositivo físico vs. demo en clase).
        buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3101/\"")     // auth-service
        buildConfigField("String", "CATALOG_BASE_URL", "\"http://10.0.2.2:3102/\"") // catalog-service
        buildConfigField("String", "PRICING_BASE_URL", "\"http://10.0.2.2:3103/\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
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
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
