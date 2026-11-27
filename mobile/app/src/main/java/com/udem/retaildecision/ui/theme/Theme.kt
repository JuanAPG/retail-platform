package com.udem.retaildecision.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColors = lightColorScheme(
    primary = Brand,
    onPrimary = OnBrand,
    primaryContainer = BrandSoft,
    onPrimaryContainer = Brand,
    secondary = Sage,
    onSecondary = OnBrand,
    secondaryContainer = SurfaceLight,
    onSecondaryContainer = Brand,
    tertiary = Accent,
    onTertiary = OnBrand,
    tertiaryContainer = AccentSoft,
    onTertiaryContainer = Accent,
    background = Background,
    onBackground = TextPrimary,
    surface = SurfaceArena,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceLight,
    onSurfaceVariant = TextMuted,
    surfaceTint = Brand,
    surfaceContainerLowest = SurfaceArena,
    surfaceContainerLow = SurfaceArena,
    surfaceContainer = SurfaceArena,
    surfaceContainerHigh = SurfaceLight,
    surfaceContainerHighest = SurfaceLight,
    outline = TextMuted,
    outlineVariant = Outline,
    error = Danger,
    onError = OnBrand,
    errorContainer = DangerSoft,
    onErrorContainer = Danger,
)

private val DarkColors = darkColorScheme(
    primary = DarkBrand,
    onPrimary = DarkBackground,
    primaryContainer = DarkBrandSoft,
    onPrimaryContainer = DarkBrand,
    secondary = DarkBrand,
    onSecondary = DarkBackground,
    secondaryContainer = DarkBrandSoft,
    onSecondaryContainer = DarkBrand,
    tertiary = DarkError,
    onTertiary = DarkBackground,
    background = DarkBackground,
    onBackground = DarkText,
    surface = DarkSurface,
    onSurface = DarkText,
    surfaceVariant = DarkBrandSoft,
    onSurfaceVariant = DarkMuted,
    surfaceTint = DarkBrand,
    surfaceContainerLowest = DarkBackground,
    surfaceContainerLow = DarkSurface,
    surfaceContainer = DarkSurface,
    surfaceContainerHigh = DarkBrandSoft,
    surfaceContainerHighest = DarkBrandSoft,
    outline = DarkMuted,
    outlineVariant = DarkOutline,
    error = DarkError,
    onError = DarkBackground,
    errorContainer = DarkErrorContainer,
    onErrorContainer = DarkOnErrorContainer,
)

/**
 * Tema de toda la app. Al envolver la app con RetailTheme, TODOS los componentes Material 3
 * (botones, campos, tarjetas, barras) toman estos colores, formas y tipografías automáticamente,
 * incluso las pantallas que no se reescribieron (Catálogo, Zonas, Precios).
 */
@Composable
fun RetailTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors

    // La barra de estado queda del color de la marca, con iconos claros (se ve como la barra lateral del escritorio).
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = (if (darkTheme) colors.background else colors.primary).toArgb()
            // false = iconos claros (blancos) sobre la barra oscura
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    MaterialTheme(
        colorScheme = colors,
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}