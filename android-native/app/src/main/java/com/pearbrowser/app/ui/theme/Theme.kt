package com.pearbrowser.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

/**
 * PearBrowser theme — mirrors `app/lib/theme.ts` exactly so the Android
 * shell is visually identical to the RN shell during the migration.
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
    // We always want dark mode — matches the RN app's theme.ts.
    // Parameter kept for API symmetry with standard Material scaffolds.
    darkTheme: Boolean = true,
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = PearColors.Bg.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    MaterialTheme(colorScheme = PearColorScheme, content = content)
}
