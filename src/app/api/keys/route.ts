// ============================================================
// /api/keys — External API key management
//
//   GET    — list keys for the caller's account.  Any member.
//   POST   — create a new key.                        Agent+.
//
// DELETE lives at /api/keys/[id].
// ============================================================

import { NextResponse } from 'next/server'

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { generateApiKey } from '@/lib/api-auth'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    const { data: keys, error } = await ctx.supabase
      .from('api_keys')
      .select('id, name, key_prefix, key_tail, created_at, last_used_at, revoked_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[GET /api/keys] error:', error)
      return NextResponse.json(
        { error: 'Failed to load API keys' },
        { status: 500 },
      )
    }

    return NextResponse.json({ keys: keys ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const limit = checkRateLimit(
      `admin:createApiKey:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as {
      name?: unknown
    } | null
    if (!body || !body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'name is required and must be a string' },
        { status: 400 },
      )
    }

    const name = body.name.trim()
    if (!name) {
      return NextResponse.json(
        { error: 'name must not be empty' },
        { status: 400 },
      )
    }

    // Generate the raw key and its hash.
    const { rawKey, hash, prefix } = generateApiKey()
    const tail = rawKey.slice(-4)

    const { data: keyRecord, error: insertErr } = await ctx.supabase
      .from('api_keys')
      .insert({
        account_id: ctx.accountId,
        name,
        key_hash: hash,
        key_prefix: prefix,
        key_tail: tail,
        created_by_user_id: ctx.userId,
      })
      .select('id, name, created_at')
      .single()

    if (insertErr) {
      // Collision on key_hash is extremely unlikely (SHA-256) but
      // we handle it gracefully.
      console.error('[POST /api/keys] insert error:', insertErr)
      return NextResponse.json(
        { error: 'Failed to create API key' },
        { status: 500 },
      )
    }

    return NextResponse.json(
      {
        id: keyRecord.id,
        name: keyRecord.name,
        // The raw key is returned exactly once — it will never be
        // retrievable again.
        key: rawKey,
        created_at: keyRecord.created_at,
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
