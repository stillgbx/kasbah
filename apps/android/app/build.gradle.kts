plugins {
    id("com.android.application")
}

android {
    namespace = "org.kasbah.auto"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.kasbah.auto"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
    }
}

dependencies {
    implementation("androidx.car.app:app:1.7.0")
    // Car data (model, energy, speed, odometer) when the phone is projected by Android Auto.
    implementation("androidx.car.app:app-projected:1.7.0")
}
