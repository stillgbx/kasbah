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
        versionCode = 4
        versionName = "0.4"
    }

    // The debug build installs next to the Play Store one (signed with another key, it could not replace
    // it): tests in the simulator without uninstalling the app used in the car.
    buildTypes {
        getByName("debug") { applicationIdSuffix = ".debug" }
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

android {
    testOptions {
        unitTests {
            // Robolectric (car screen tests) reads the app's resources: strings, drawables.
            isIncludeAndroidResources = true
            // Robolectric reaches into a JDK internal the Java 25 of Android Studio keeps closed.
            all { it.jvmArgs("--add-opens=java.base/jdk.internal.access=ALL-UNNAMED") }
        }
    }
}

dependencies {
    implementation("androidx.car.app:app:1.7.0")
    // Car data (model, energy, speed, odometer) when the phone is projected by Android Auto.
    implementation("androidx.car.app:app-projected:1.7.0")
    // The geofence around the house that wakes the app for the approach alert.
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // The notification classes the car's notification manager takes; already in the build through the
    // car library, at this version, but not visible to the app's code without it.
    implementation("androidx.core:core:1.7.0")

    // `./gradlew testDebugUnitTest`, on the computer: no phone, no car.
    testImplementation("junit:junit:4.13.2")
    // Android's org.json is only a stub on the JVM: the real one for the parsing tests.
    testImplementation("org.json:json:20260814")
    // Car screens built as Android Auto builds them (TestCarContext), on a simulated Android.
    testImplementation("androidx.car.app:app-testing:1.7.0")
    testImplementation("org.robolectric:robolectric:4.17")
}
