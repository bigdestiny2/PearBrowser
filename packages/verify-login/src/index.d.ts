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
