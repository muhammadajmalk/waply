// ============================================================
// DELETE /api/keys/[id]
//
// Admin+. Revokes an API key by setting revoked_at. We soft-
// delete (rather than hard-delete) so the audit trail stays
// intact — the key list shows revoked keys with a timestamp.
//
// RLS on api_keys restricts DELETE to admins of the owning
// account, so a cross-account attempt returns 404 (RLS hides
// the row).
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(
      `admin:revokeApiKey:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params

    const { error, count } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    if (error) {
      console.error('[DELETE /api/keys/[id]] error:', error)
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 500 },
      )
    }

    if (count === 0) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
