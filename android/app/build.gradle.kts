import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing is read from keystore.properties (not in version control).
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "io.github.agenga0320.formosarail"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.agenga0320.formosarail"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.1.0"
    }

    signingConfigs {
        if (!keystoreProperties.isEmpty) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

base.archivesName.set("FormosaRailTycoon-v${android.defaultConfig.versionName}")

// The game itself lives at the repo root; copy it into the APK assets on every build.
val syncWeb by tasks.registering(Sync::class) {
    from(rootDir.parentFile) { include("index.html", "css/**", "js/**") }
    into(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(syncWeb) }
