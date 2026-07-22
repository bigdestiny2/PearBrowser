//  PearBrowser - PearColors.swift
//
//  Matches app/lib/theme.ts and ui/theme/Theme.kt exactly.
//  Keep in sync across all three shells.

import SwiftUI

enum PearColors {
    static let bg               = Color(red: 0x0A/255, green: 0x0A/255, blue: 0x0A/255)
    static let surface          = Color(red: 0x1A/255, green: 0x1A/255, blue: 0x1A/255)
    static let surfaceElevated  = Color(red: 0x2A/255, green: 0x2A/255, blue: 0x2A/255)
    static let border           = Color(red: 0x33/255, green: 0x33/255, blue: 0x33/255)
    static let textPrimary      = Color(red: 0xE0/255, green: 0xE0/255, blue: 0xE0/255)
    static let textSecondary    = Color(red: 0x88/255, green: 0x88/255, blue: 0x88/255)
    static let textMuted        = Color(red: 0x55/255, green: 0x55/255, blue: 0x55/255)
    static let accent           = Color(red: 0xFF/255, green: 0x95/255, blue: 0x00/255)
    static let success          = Color(red: 0x4A/255, green: 0xDE/255, blue: 0x80/255)
    static let warning          = Color(red: 0xFA/255, green: 0xCC/255, blue: 0x15/255)
    static let error            = Color(red: 0xEF/255, green: 0x44/255, blue: 0x44/255)
    static let link             = Color(red: 0x4D/255, green: 0xAB/255, blue: 0xF7/255)
}

enum PearLightColors {
    static let bg               = Color(red: 0xF6/255, green: 0xF8/255, blue: 0xF7/255)
    static let surface          = Color(red: 0xFF/255, green: 0xFF/255, blue: 0xFF/255)
    static let surfaceElevated  = Color(red: 0xEE/255, green: 0xF3/255, blue: 0xF1/255)
    static let border           = Color(red: 0xDD/255, green: 0xE6/255, blue: 0xE2/255)
    static let borderStrong     = Color(red: 0xC9/255, green: 0xD6/255, blue: 0xD0/255)
    static let textPrimary      = Color(red: 0x17/255, green: 0x21/255, blue: 0x1B/255)
    static let textSecondary    = Color(red: 0x65/255, green: 0x73/255, blue: 0x6C/255)
    static let textMuted        = Color(red: 0x8A/255, green: 0x97/255, blue: 0x90/255)
    static let accent           = Color(red: 0x16/255, green: 0x83/255, blue: 0x4F/255)
    static let accentHover      = Color(red: 0x11/255, green: 0x6C/255, blue: 0x41/255)
    static let accentSoft       = Color(red: 0xE5/255, green: 0xF5/255, blue: 0xEC/255)
    static let success          = accent
    static let warning          = Color(red: 0xB9/255, green: 0x78/255, blue: 0x12/255)
    static let error            = Color(red: 0xC2/255, green: 0x41/255, blue: 0x2F/255)
    static let link             = Color(red: 0x0F/255, green: 0x76/255, blue: 0x6E/255)
    static let teal             = Color(red: 0x0F/255, green: 0x76/255, blue: 0x6E/255)
    static let tealSoft         = Color(red: 0xE2/255, green: 0xF3/255, blue: 0xF1/255)
    static let coral            = Color(red: 0xE4/255, green: 0x5D/255, blue: 0x45/255)
    static let coralSoft        = Color(red: 0xFF/255, green: 0xF0/255, blue: 0xED/255)
    static let amber            = Color(red: 0xB9/255, green: 0x78/255, blue: 0x12/255)
    static let amberSoft        = Color(red: 0xFF/255, green: 0xF4/255, blue: 0xDC/255)
}
