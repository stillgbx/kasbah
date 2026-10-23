import java.util.Properties

plugins {
    id("com.android.application")
}

// The Play upload key stays out of the repository: keystore.properties (untracked, next to this
// project's settings.gradle.kts) names the keystore and its passwords. Without it, only the debug build
// can be made.
val keystore = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { file ->
    Properties().apply { file.inputStream().use(::load) }
}

android {
    namespace = "org.kasbah.auto"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.kasbah.auto"
        minSdk = 29
        targetSdk = 36
        versionCode = 2
        versionName = "0.2"
    }

    if (keystore != null) {
        signingConfigs {
            create("upload") {
                storeFile = file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
        buildTypes {
            getByName("release") { signingConfig = signingConfigs.getByName("upload") }
        }
    }
}

dependencies {
    implementation("androidx.car.app:app:1.7.0")
    // Car data (model, energy, speed, odometer) when the phone is projected by Android Auto.
    implementation("androidx.car.app:app-projected:1.7.0")
}
