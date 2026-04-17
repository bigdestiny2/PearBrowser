pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Holepunch hosts bare-kit prebuilds as GitHub releases; consumers
        // download the .jar/.xcframework and place it in app/libs/ manually.
        // Once bare-kit is on mavenCentral we can remove the flatDir below.
        flatDir {
            dirs("app/libs")
        }
    }
}

rootProject.name = "PearBrowser"
include(":app")
