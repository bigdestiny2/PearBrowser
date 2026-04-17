/**
 * Backward-compat shim for the old bridge-inject module.
 *
 * The implementation has moved to `pear-bridge-spec.ts`, which is the single
 * source of truth for the bridge script across all shells (RN, bare-android,
 * bare-ios). New code should import from `pear-bridge-spec.ts` directly.
 *
 * This file re-exports `createBridgeScript` with the original `(port, token)`
 * signature so existing callers continue to work.
 *
 * See: docs/HOLEPUNCH_ALIGNMENT_PLAN.md (Phase 0 ticket 3)
 */

import { createBridgeScript as create, PEAR_BRIDGE_SCRIPT_TEMPLATE } from './pear-bridge-spec'

export { PEAR_BRIDGE_SCRIPT_TEMPLATE } from './pear-bridge-spec'
export type { PearAPI, PearSyncAPI, PearIdentityAPI, PearBridgeStatusAPI, BridgeScriptOptions } from './pear-bridge-spec'

/**
 * @deprecated Use `createBridgeScript({ port, apiToken })` from `pear-bridge-spec`.
 * Kept for backward compatibility with existing BrowseScreen call-sites.
 */
export function createBridgeScript(port: number, apiToken = ''): string {
  return create({ port, apiToken })
}

/** Legacy placeholder export (always returns an uninitialized script). */
export const BRIDGE_INJECT_JS: string = createBridgeScript(0, '')
