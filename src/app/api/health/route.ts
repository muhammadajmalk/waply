// ============================================================
// /api/health — Container liveness probe
//
//   GET — returns 200 OK with no dependencies (no auth, no DB).
//   Used by docker-compose healthcheck (see docker-compose.yml
//   and docker-compose.prod.yml) and any external uptime monitor.
// ============================================================

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}
