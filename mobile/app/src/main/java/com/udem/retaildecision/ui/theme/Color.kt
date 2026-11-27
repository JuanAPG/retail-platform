package com.udem.retaildecision.ui.theme

import androidx.compose.ui.graphics.Color

// Misma paleta que el sistema web y la app de escritorio: verde petróleo (principal), rojo vino
// (acento), verde salvia (secundario), crema (fondo) y arena (superficies).
// Contrastes de texto calculados con la fórmula WCAG 2.1 (mínimo 4.5:1).
val Brand = Color(0xFF003C3E)        // verde petróleo; crema encima: 11.5:1
val BrandSoft = Color(0xFFE3EBE6)    // contenedor del principal; petróleo encima: 10.1:1
val BrandDark = Color(0xFF002A2C)    // tono más oscuro para degradados
val BrandLight = Color(0xFF2A5753)   // tono más claro para degradados (más claro no da 4.5:1 con el texto crema al 80 %)

val OnBrand = Color(0xFFFAF8F2)      // texto e íconos sobre el verde petróleo (crema)

// Verde salvia #708D81 oscurecido: el original da 3.4:1 con texto crema encima y 3.1:1 sobre la
// arena, así que como secundario y como texto atenuado se usa este tono (5.3:1 y 4.7:1).
val Sage = Color(0xFF546D62)

val Accent = Color(0xFF8E0A0A)       // rojo vino: acentos y acciones destacadas; crema encima: 9.0:1
val AccentSoft = Color(0xFFF6E4E1)   // rojo vino encima: 7.8:1

val Background = Color(0xFFFAF8F2)   // crema
val SurfaceArena = Color(0xFFF0ECDF) // arena: tarjetas, campos
val SurfaceLight = Color(0xFFF4F0E6) // superficie clara
val Outline = Color(0xFFE2DCCB)      // borde derivado de la arena
val TextPrimary = Color(0xFF040404)  // 19.3:1 sobre crema, 17.4:1 sobre arena
val TextMuted = Sage                 // 5.3:1 sobre crema, 4.7:1 sobre arena, 4.9:1 sobre superficie clara

val Danger = Accent                  // el error usa el rojo vino
val DangerSoft = AccentSoft
val Success = Color(0xFF2A6339)      // 5.9:1 sobre su fondo; crema encima: 6.7:1
val SuccessSoft = Color(0xFFE2EDE0)
val Warning = Color(0xFF84470A)      // 6.0:1 sobre su fondo
val WarningSoft = Color(0xFFF6E9CC)
// Insignias de nivel de ingreso: bajo ámbar (Warning), medio azul, alto verde azulado. No indican bueno ni malo.
val Azul = Color(0xFF2C5274)         // 6.7:1 sobre su fondo
val AzulSoft = Color(0xFFE2E9EF)
val Teal = Color(0xFF0D5C57)         // 6.4:1 sobre su fondo
val TealSoft = Color(0xFFDBEBE8)

// Modo oscuro (mismos tonos, derivados para fondo oscuro)
val DarkBackground = Color(0xFF0E1514)
val DarkSurface = Color(0xFF172120)
val DarkOutline = Color(0xFF2C3A37)
val DarkText = Color(0xFFECE9E0)     // 13.6:1 sobre la superficie oscura
val DarkMuted = Color(0xFFA3B8AE)    // salvia clara: 7.9:1
val DarkBrand = Color(0xFF8CC5BF)    // petróleo claro: 8.5:1
val DarkBrandSoft = Color(0xFF1E3836)
val DarkError = Color(0xFFFFB4AB)    // rojo vino aclarado: 9.7:1
val DarkErrorContainer = Color(0xFF5C1010)
val DarkOnErrorContainer = Color(0xFFFFDAD5) // 10.6:1
