//  PearBrowser — PearColors.swift
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
