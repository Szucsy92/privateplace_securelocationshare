package hu.privateplace.app.ui

import androidx.compose.ui.graphics.Color

fun parseColor(hex: String): Color = Color(android.graphics.Color.parseColor(hex))
