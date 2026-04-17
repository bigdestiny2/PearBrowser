# Phase 2 Android native shell — ProGuard rules.
# Keeps classes reachable through JNI (bare-kit native addons)
# and preserves anything the WebView bridge touches via reflection.

# bare-kit: preserve its Java surface so JNI callbacks resolve
-keep class to.holepunch.bare.kit.** { *; }
-keep class to.holepunch.bare.** { *; }

# Kotlinx serialization (for RPC JSON payloads)
-keep,includedescriptorclasses class com.pearbrowser.app.rpc.** { *; }
-keepclassmembers class com.pearbrowser.app.rpc.** {
    *** Companion;
}
-keepclasseswithmembers class com.pearbrowser.app.rpc.** {
    kotlinx.serialization.KSerializer serializer(...);
}
