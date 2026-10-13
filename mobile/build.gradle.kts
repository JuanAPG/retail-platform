// Build file raíz. No declara dependencias de la app, solo los plugins
// que los módulos (en este caso ":app") pueden aplicar, con la versión
// fijada aquí para que no haya conflictos entre módulos si el proyecto crece.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("com.google.devtools.ksp") version "1.9.24-1.0.20" apply false
}
