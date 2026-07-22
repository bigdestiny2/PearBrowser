package com.pearbrowser.app.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * PearBrowser dark runtime theme. Mirrors the legacy `colors` export in
 * `app/lib/theme.ts`; PearLightColors is available for the next UI migration.
 */
object PearColors {
    val Bg = Color(0xFF0A0A0A)
    val Surface = Color(0xFF1A1A1A)
    val SurfaceElevated = Color(0xFF2A2A2A)
    val Border = Color(0xFF333333)
    val TextPrimary = Color(0xFFE0E0E0)
    val TextSecondary = Color(0xFF888888)
    val TextMuted = Color(0xFF555555)
    val Accent = Color(0xFFFF9500)
    val Success = Color(0xFF4ADE80)
    val Warning = Color(0xFFFACC15)
    val Error = Color(0xFFEF4444)
    val Link = Color(0xFF4DABF7)
}

object PearLightColors {
    val Bg = Color(0xFFF6F8F7)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceElevated = Color(0xFFEEF3F1)
    val Border = Color(0xFFDDE6E2)
    val BorderStrong = Color(0xFFC9D6D0)
    val TextPrimary = Color(0xFF17211B)
    val TextSecondary = Color(0xFF65736C)
    val TextMuted = Color(0xFF8A9790)
    val Accent = Color(0xFF16834F)
    val AccentHover = Color(0xFF116C41)
    val AccentSoft = Color(0xFFE5F5EC)
    val Success = Accent
    val Warning = Color(0xFFB97812)
    val Error = Color(0xFFC2412F)
    val Link = Color(0xFF0F766E)
    val Teal = Color(0xFF0F766E)
    val TealSoft = Color(0xFFE2F3F1)
    val Coral = Color(0xFFE45D45)
    val CoralSoft = Color(0xFFFFF0ED)
    val Amber = Color(0xFFB97812)
    val AmberSoft = Color(0xFFFFF4DC)
}

private val PearColorScheme = darkColorScheme(
    primary = PearColors.Accent,
    onPrimary = PearColors.Bg,
    background = PearColors.Bg,
    onBackground = PearColors.TextPrimary,
    surface = PearColors.Surface,
    onSurface = PearColors.TextPrimary,
    surfaceVariant = PearColors.SurfaceElevated,
    onSurfaceVariant = PearColors.TextSecondary,
    error = PearColors.Error,
)

@Composable
fun PearBrowserTheme(
    // Keep the current runtime on dark mode until Pear UI Light migration starts.
    // Parameter kept for API symmetry with standard Material scaffolds.
    darkTheme: Boolean = true,
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    MaterialTheme(colorScheme = PearColorScheme, content = content)
}
