export interface LoginAttestation {
  appPubkey: string
  scopes: string[]
  grantedAt: number
  expiresAt: number
  loginProof: string
  tag: string
  profile: Record<string, string> | null
}

export interface VerifyOptions {
  /** Enforce the attestation was issued for a specific drive (your app's key). */
  expectedDriveKey?: string
  /** Enforce the attestation was issued for a specific HTTPS origin
   *  (e.g. "https://your-site.com"). The library derives the expected
   *  drive key internally — equivalent to passing
   *  `expectedDriveKey: originToDriveKey(opts.expectedOrigin)`.
   *  Mutually exclusive with expectedDriveKey; expectedDriveKey wins
   *  if both are set. */
  expectedOrigin?: string
  /** Reject if the attestation is older than this, regardless of embedded expiry. */
  maxAgeMs?: number
  /** Allowed forward drift for clock skew. Default 30s. */
  clockSkewMs?: number
  /** Override "now" for testing. */
  now?: number
}

export interface VerifySuccess {
  ok: true
  appPubkey: string
  scopes: string[]
  profile: Record<string, string> | null
  driveKey: string
  grantedAt: number
  expiresAt: number
}

export interface VerifyFailure {
  ok: false
  error: string
}

export function verifyLoginAttestation (
  attestation: LoginAttestation,
  opts?: VerifyOptions
): Promise<VerifySuccess | VerifyFailure>

export function verifyLoginMiddleware (opts?: VerifyOptions): (req: any, res: any, next: any) => Promise<void>

export function extractDriveKey (tag: string): string | null

/** Canonicalise an origin string to `scheme://host[:port]` (default
 *  ports stripped, host lowercased). Returns null for non-http(s)
 *  protocols or malformed input. */
export function canonicaliseOrigin (origin: string): string | null

/** Compute the pseudo-driveKey PearBrowser issues for a given HTTPS
 *  origin: `sha256("pear.origin.v1:" + canonical_origin).hex()`.
 *  Returns null if the origin string is malformed. */
export function originToDriveKey (origin: string): string | null
