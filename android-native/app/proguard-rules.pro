# Phase 2 Android native shell — ProGuard rules.
# Keeps classes reachable through JNI (bare-kit native addons)
# and preserves anything the WebView bridge touches via reflection.

# bare-kit: preserve its Java surface so JNI callbacks resolve
-keep class to.holepunch.bare.kit.** { *; }
-keep class to.holepunch.bare.** { *; }

# The native Compose shell uses bare-kit's Worklet API directly via reflection.
# The local bare-kit AAR also ships React Native adapter classes for RN hosts;
# those classes reference RN symbols we intentionally do not package here.
-dontwarn com.facebook.proguard.annotations.DoNotStrip
-dontwarn com.facebook.react.**

# Kotlinx serialization (for RPC JSON payloads)
-keep,includedescriptorclasses class com.pearbrowser.app.rpc.** { *; }
-keepclassmembers class com.pearbrowser.app.rpc.** {
    *** Companion;
}
-keepclasseswithmembers class com.pearbrowser.app.rpc.** {
    kotlinx.serialization.KSerializer serializer(...);
}
