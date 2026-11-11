plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "hu.privateplace.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "hu.privateplace.app"
        minSdk = 26
        targetSdk = 35
        // A CI adja: versionCode = futás sorszáma (+ eltolás), versionName = dátumos verzió (pl. 2026.11.11-1530)
        versionCode = System.getenv("APP_VERSION_CODE")?.toIntOrNull() ?: (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = System.getenv("APP_VERSION_NAME") ?: (project.findProperty("versionName") as String?) ?: "dev"
        // Az OTA-frissítő ebből a GitHub-tárolóból keresi a legújabb kiadást
        buildConfigField("String", "RELEASE_REPOSITORY", "\"${System.getenv("GITHUB_REPOSITORY") ?: project.findProperty("releaseRepo") ?: ""}\"")
        // Jelzés: nyilvános Nostr-relék (cserélhető), opcionális TURN a nehéz hálózatokhoz
        buildConfigField("String", "NOSTR_RELAYS", "\"${System.getenv("NOSTR_RELAYS")?.takeIf { it.isNotBlank() } ?: project.findProperty("nostrRelays") ?: "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"}\"")
        buildConfigField("String", "TURN_URLS", "\"${System.getenv("TURN_URLS")?.takeIf { it.isNotBlank() } ?: project.findProperty("turnUrls") ?: ""}\"")
        buildConfigField("String", "TURN_USERNAME", "\"${System.getenv("TURN_USERNAME")?.takeIf { it.isNotBlank() } ?: project.findProperty("turnUsername") ?: ""}\"")
        buildConfigField("String", "TURN_CREDENTIAL", "\"${System.getenv("TURN_CREDENTIAL")?.takeIf { it.isNotBlank() } ?: project.findProperty("turnCredential") ?: ""}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    // Kiadási aláírás: ugyanaz az állandó kulcs, mint eddig (különben az OTA-frissítés nem települ a meglévő app fölé).
    // Kulcs nélkül a release build szándékosan elbukik – ideiglenes kulccsal aláírt APK-t soha nem készítünk.
    signingConfigs {
        create("release") {
            System.getenv("KS_FILE")?.let { f ->
                storeFile = file(f); storePassword = System.getenv("KS_PASSWORD")
                keyAlias = System.getenv("KS_ALIAS") ?: "privateplace"; keyPassword = System.getenv("KS_PASSWORD")
            }
        }
    }
    buildTypes { release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("release") } }
    packaging { resources.excludes += setOf("META-INF/versions/**", "META-INF/*.kotlin_module") }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui"); implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3"); implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-process:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.maplibre.gl:android-sdk:11.5.2")
    implementation("io.getstream:stream-webrtc-android:1.3.8")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    val camerax = "1.3.4"
    implementation("androidx.camera:camera-core:$camerax"); implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax"); implementation("androidx.camera:camera-view:$camerax")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
}
