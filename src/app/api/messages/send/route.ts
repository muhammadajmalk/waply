// ============================================================
// POST /api/messages/send — External API to send WhatsApp messages
//
// Authentication: Bearer token (API key). Not Supabase cookies.
//
// Request body:
//   {
//     "to": "+1234567890",          // Recipient phone (E.164)
//     "text": "Hello world",        // Free-form text (mutually exclusive with template)
//     "template": {                  // OR a template object (mutually exclusive with text)
//       "name": "hello_world",      // Template name (from Meta)
//       "language": "en_US",        // Optional, default "en_US"
//       "params": ["value1"],       // Optional, legacy body-only params
//     }
//   }
//
// Response:
//   { "success": true, "messageId": "uuid" }
// ============================================================

import { NextResponse } from 'next/server'
import {
  sendTextMessage,
  sendTemplateMessage,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { validateBearer } from '@/lib/api-auth'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  normalizePhone,
} from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  checkRateLimit,
  rateLimitResponse,
} from '@/lib/rate-limit'

interface TemplatePayload {
  name: string
  language?: string
  params?: string[]
}

interface SendBody {
  to?: unknown
  text?: unknown
  template?: unknown
}

export async function POST(request: Request) {
  try {
    // --- Auth (API key) ---
    const auth = await validateBearer(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide a valid API key via Authorization: Bearer <key>' },
        { status: 401 },
      )
    }

    // Per-account rate limit for the external API. Keys against the
    // account so one key can't exhaust the budget for another.
    const limit = checkRateLimit(`api:send:${auth.accountId}`, {
      limit: 120,
      windowMs: 60_000,
    })
    if (!limit.success) return rateLimitResponse(limit)

    const db = supabaseAdmin()

    // --- Parse body ---
    const body = (await request.json().catch(() => null)) as SendBody | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { to, text, template } = body

    if (!to || typeof to !== 'string') {
      return NextResponse.json(
        { error: 'to (phone number) is required' },
        { status: 400 },
      )
    }

    if (!text && !template) {
      return NextResponse.json(
        { error: 'Either text or template is required' },
        { status: 400 },
      )
    }

    if (text && template) {
      return NextResponse.json(
        { error: 'Provide either text or template, not both' },
        { status: 400 },
      )
    }

    // --- Resolve contact ---
    const rawPhone = normalizePhone(to)
    if (!rawPhone) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }

    const existingContact = await findExistingContact(db, auth.accountId, rawPhone)
    let contactId: string
    let contactPhone = rawPhone

    // Resolve WhatsApp config early so we can fall back to its user_id
    // for FK references below.
    const { data: config, error: configErr } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', auth.accountId)
      .single()

    if (configErr || !config) {
      return NextResponse.json(
        { error: 'WhatsApp is not configured for this account' },
        { status: 400 },
      )
    }

    // Resolve the user_id to stamp on contacts/conversations:
    // prefer the API key creator, fall back to the config owner.
    const effectiveUserId = auth.createdByUserId ?? config.user_id

    if (existingContact) {
      contactId = existingContact.id
      contactPhone = existingContact.phone
    } else {
      const { data: newContact, error: createErr } = await db
        .from('contacts')
        .insert({
          account_id: auth.accountId,
          user_id: effectiveUserId,
          phone: rawPhone,
          name: rawPhone,
        })
        .select()
        .single()

      if (createErr) {
        if (isUniqueViolation(createErr)) {
          const raced = await findExistingContact(db, auth.accountId, rawPhone)
          if (raced) {
            contactId = raced.id
            contactPhone = raced.phone
          } else {
            return NextResponse.json(
              { error: 'Failed to create contact (race condition)' },
              { status: 500 },
            )
          }
        } else {
          console.error('[api/messages/send] contact create error:', createErr)
          return NextResponse.json(
            { error: 'Failed to create contact' },
            { status: 500 },
          )
        }
      } else {
        contactId = newContact.id
      }
    }

    // --- Resolve conversation ---
    let conversationId: string
    const { data: existingConv } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', auth.accountId)
      .eq('contact_id', contactId)
      .maybeSingle()

    if (existingConv) {
      conversationId = existingConv.id
    } else {
      const { data: newConv, error: convErr } = await db
        .from('conversations')
        .insert({
          account_id: auth.accountId,
          user_id: effectiveUserId,
          contact_id: contactId,
        })
        .select()
        .single()

      if (convErr) {
        console.error('[api/messages/send] conversation create error:', convErr)
        return NextResponse.json(
          { error: 'Failed to create conversation' },
          { status: 500 },
        )
      }
      conversationId = newConv.id
    }

    const accessToken = decrypt(config.access_token)

    // --- Send via Meta ---
    const sanitizedPhone = sanitizePhoneForMeta(contactPhone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format after sanitization' },
        { status: 400 },
      )
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    const attempt = async (phone: string): Promise<string> => {
      if (template) {
        const tpl = template as TemplatePayload
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          templateName: tpl.name,
          language: tpl.language || 'en_US',
          params: tpl.params || [],
        })
        return result.messageId
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: text as string,
      })
      return result.messageId
    }

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(message)) throw err
          lastError = err
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[api/messages/send] Meta send failed:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      )
    }

    // Update contact phone if variant succeeded with a different format.
    if (workingPhone !== sanitizedPhone) {
      await db
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contactId)
    }

    // --- Persist message record ---
    const contentText = template ? null : (text as string)
    const contentType = template ? 'template' : 'text'
    const tplName = template ? (template as TemplatePayload).name : null

    const { data: messageRecord, error: msgErr } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: contentType,
        content_text: contentText,
        template_name: tplName,
        message_id: waMessageId,
        status: 'sent',
      })
      .select()
      .single()

    if (msgErr) {
      console.error('[api/messages/send] message insert error:', msgErr)
      return NextResponse.json(
        { error: 'Message sent to Meta but failed to save to DB' },
        { status: 500 },
      )
    }

    // --- Update conversation ---
    await db
      .from('conversations')
      .update({
        last_message_text:
          contentText || (tplName ? `[template:${tplName}]` : ''),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({
      success: true,
      messageId: messageRecord.id,
    })
  } catch (error) {
    console.error('[api/messages/send] unexpected error:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 },
    )
  }
}
