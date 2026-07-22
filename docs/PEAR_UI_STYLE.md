# Pear UI Light - Mobile And Native Adoption

Canonical design system:

`design-system/README.md` from the workspace root, or `../../design-system/README.md` from this file.

Full app GUI spec:

`../../design-system/PEARBROWSER_FULL_APP_GUI_SPEC.md`

## Mobile Direction

Pear UI Light should be introduced as a named theme before it replaces the current dark theme. The existing RN, Android, and iOS shells are tightly coupled to the old dark color names, so migrate by semantic token rather than by ad hoc color swaps.

## Token Mapping

Use the platform exports from the shared design system:

- React Native: `design-system/platform/react-native/pear-ui.ts`
- Android Compose: `design-system/platform/android/PearUiTokens.kt`
- SwiftUI: `design-system/platform/ios/PearUiTokens.swift`

The semantic names intentionally mirror the existing mobile theme:

| Existing name | Pear UI Light value |
| --- | --- |
| `bg` | `#f6f8f7` |
| `surface` | `#ffffff` |
| `surfaceElevated` | `#eef3f1` |
| `border` | `#dde6e2` |
| `textPrimary` | `#17211b` |
| `textSecondary` | `#65736c` |
| `textMuted` | `#8a9790` |
| `accent` | `#16834f` |
| `success` | `#16834f` |
| `warning` | `#b97812` |
| `error` | `#c2412f` |
| `link` | `#0f766e` |

## Migration Order

1. Add `pearLightColors` beside the existing dark `colors` export in `app/lib/theme.ts`.
2. Add a feature flag or theme selector that keeps dark as the default until screens are ready.
3. Migrate Home and Browse first, because they establish the product frame.
4. Migrate catalog and site-publishing flows.
5. Migrate Settings, identity, login consent, and diagnostics.
6. Mirror the same token names in Android `PearColors` and iOS `PearColors`.

## Mobile Layout Notes

Keep browser controls thumb-friendly, but let the new visual language come from token values, spacing, and hierarchy rather than larger components. Address/search bars should remain compact, cards should stay at 8px radius, and P2P status should stay progressive: dot, short text, then detailed sheet.
