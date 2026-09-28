// Padel para Android: la versión NATIVA de padel.dotrino.com (CONVENCIONES §16). La PWA va
// delante; `versionName` es la versión de la PWA con la que esta está a la par (§16.3).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.dotrino.padel"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.dotrino.padel"
        minSdk = 31
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.0"
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // Los casos de oro del motor del torneo, sacados de la PWA (test/vectors/gen.mjs): los
    // mismos que prueba iOS.
    sourceSets["test"].resources.srcDir("../../test/vectors")
}

dependencies {
    implementation("com.dotrino:dotrino-native")   // includeBuild de ../native/android
    testImplementation("junit:junit:4.13.2")
}
