import crypto from 'crypto'

// ============================================================
// API-key authentication for external API consumers.
//
// The external API (e.g. POST /api/messages/send) does not use
// Supabase Auth cookies — callers authenticate via an API key
// (Bearer token) they generated from the Web UI.
//
// We store a SHA-256 hash of the key (prefixed) so a leaked DB
// snapshot never yields usable credentials. The prefix is the
// first 8 hex chars of the hash — it lets us locate candidate
// rows without a full scan or exposing the full hash in logs.
//
// Key format
// ----------
//   wacrm_{base64url(24 random bytes)}
// Example: wacrm_abc123def456ghi789jklmno
//
// The prefix stored alongside the full hash is the first 8 hex
// chars of the SHA-256 digest. This serves two purposes:
//   1. Indexed lookups — we query `WHERE key_hash LIKE prefix || '%'`
//      to narrow candidate rows from the whole table to ~1-2 rows.
//   2. Safe logging — we can emit "key prefix abc12345" in audit
//      logs without revealing enough of the hash to reconstruct
//      the full key.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client'

/** The prefix length (in hex chars) of key_hash used for indexed lookups. */
const PREFIX_LEN = 8

// ------------------------------------------------------------
// Key generation (for the CREATE endpoint)
// ------------------------------------------------------------

export interface GeneratedKey {
  rawKey: string
  hash: string
  prefix: string
}

/**
 * Generate a new API key.
 *
 * Format: wacrm_{base64url(24 random bytes)}
 * Returns both the raw key (shown once) and its SHA-256 hash + prefix.
 */
export function generateApiKey(): GeneratedKey {
  const bytes = crypto.randomBytes(24)
  const rawKey = 'wacrm_' + bytes.toString('base64url')
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const prefix = hash.slice(0, PREFIX_LEN)
  return { rawKey, hash, prefix }
}

// ------------------------------------------------------------
// Key validation
// ------------------------------------------------------------

/** Shape returned after a successful key validation. */
export interface ValidatedKey {
  accountId: string
  keyId: string
  createdByUserId: string | null
}

/**
 * Validate a Bearer token and return the owning account_id + key details.
 *
 * Returns `null` when the token is missing, malformed, or unknown.
 *
 * Usage:
 *   const auth = await validateBearer(request)
 *   if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
 *   // auth.accountId, auth.keyId
 */
export async function validateBearer(
  request: Request,
): Promise<ValidatedKey | null> {
  const header = request.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return null

  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  return validateApiKey(token)
}

/**
 * Validate a raw API key against the database.
 *
 * Uses a two-step lookup: first narrow by prefix (indexed),
 * then compare the full hash (constant-time within the
 * candidate set).
 */
export async function validateApiKey(
  apiKey: string,
): Promise<ValidatedKey | null> {
  const fullHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  const prefix = fullHash.slice(0, PREFIX_LEN)

  const db = supabaseAdmin()

  const { data: candidates, error } = await db
    .from('api_keys')
    .select('id, account_id, key_hash, created_by_user_id')
    .like('key_hash', `${prefix}%`)
    .is('revoked_at', null)

  if (error || !candidates || candidates.length === 0) return null

  for (const row of candidates) {
    if (row.key_hash.length !== fullHash.length) continue

    // Constant-time comparison within the candidate set to
    // prevent timing side-channels.
    let match = 0
    for (let i = 0; i < row.key_hash.length; i++) {
      match |= row.key_hash.charCodeAt(i) ^ fullHash.charCodeAt(i)
    }

    if (match === 0) {
      // Touch last_used_at asynchronously — never block the
      // hot path on a write.
      db.from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', row.id)
        .then(({ error: updateErr }) => {
          if (updateErr) {
            console.warn('[api-auth] Failed to update last_used_at:', updateErr.message)
          }
        })

      return {
        accountId: row.account_id,
        keyId: row.id,
        createdByUserId: row.created_by_user_id,
      }
    }
  }

  return null
}
