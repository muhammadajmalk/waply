# External API — Programmatic WhatsApp Messaging

wacrm provides a REST API for sending WhatsApp messages programmatically.
Authentication is via **API keys** generated from the Web UI.

---

## Quick Start

```bash
# 1. Generate an API key from Settings → API Keys
# 2. Send your first message
curl -X POST https://your-app.com/api/messages/send \
  -H "Authorization: Bearer wacrm_abc123def456ghi789jklmno" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "text": "Hello from the API!"
  }'
```

---

## Authentication

All API requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer wacrm_abc123def456ghi789jklmno
```

API keys are generated from the Web UI:
1. Go to **Settings → API Keys**
2. Click **Create API Key**
3. Give it a name (e.g. "Production Bot")
4. Copy the key — **it is shown only once**

### Key format

Keys follow the format `wacrm_{base64url(24 random bytes)}` — 35 characters
total. They are prefixed with `wacrm_` for easy identification.

### Key permissions

API keys inherit the permissions of the user who created them. To send
messages, the creator must have at least the **Agent** role.

---

## Endpoints

### Send a message

```
POST /api/messages/send
```

Send a free-form text message or a pre-approved WhatsApp template.

#### Request body

| Field      | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `to`       | string | Yes      | Recipient phone number (E.164 format).           |
| `text`     | string | See note | Free-form message text. Mutually exclusive with `template`. |
| `template` | object | See note | Template object (see below). Mutually exclusive with `text`. |

> You must provide either `text` or `template`, but not both.

#### Template object

| Field      | Type     | Required | Description                                      |
|------------|----------|----------|--------------------------------------------------|
| `name`     | string   | Yes      | Template name as registered in Meta.             |
| `language` | string   | No       | Language code (default: `en_US`).                |
| `params`   | string[] | No       | Body variable values (ordered by position).      |

#### Response (200)

```json
{
  "success": true,
  "messageId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Error responses

| Status | Meaning                                     |
|--------|---------------------------------------------|
| 400    | Invalid request (missing fields, bad phone) |
| 401    | Missing or invalid API key                  |
| 429    | Rate limit exceeded                         |
| 502    | Meta API error (bad gateway)                |

#### Examples

**Send a text message:**

```bash
curl -X POST https://your-app.com/api/messages/send \
  -H "Authorization: Bearer wacrm_abc123def456ghi789jklmno" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "text": "Hi there! This message was sent via the API."
  }'
```

**Send a template message:**

```bash
curl -X POST https://your-app.com/api/messages/send \
  -H "Authorization: Bearer wacrm_abc123def456ghi789jklmno" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "template": {
      "name": "hello_world",
      "language": "en_US",
      "params": ["Alice"]
    }
  }'
```

**Response for a successfully sent message:**

```json
{
  "success": true,
  "messageId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### Manage API keys

#### List keys

```
GET /api/keys
```

Returns all non-revoked and revoked keys for your account.

**Response (200):**

```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "Production Bot",
      "key_prefix": "a1b2c3d4",
      "key_tail": "mnop",
      "created_at": "2026-06-23T12:00:00Z",
      "last_used_at": "2026-06-23T12:30:00Z",
      "revoked_at": null
    }
  ]
}
```

#### Create a key

```
POST /api/keys
Content-Type: application/json

{
  "name": "My API Key"
}
```

**Response (201):**

```json
{
  "id": "uuid",
  "name": "My API Key",
  "key": "wacrm_abc123def456ghi789jklmno",
  "created_at": "2026-06-23T12:00:00Z"
}
```

> **Save the key immediately.** The raw key is returned only once and
> cannot be retrieved later. If lost, revoke it and create a new one.

#### Revoke a key

```
DELETE /api/keys/{id}
```

**Response (200):**

```json
{
  "ok": true
}
```

Revoked keys are soft-deleted (they remain in the database with a
`revoked_at` timestamp) and can no longer authenticate requests.

---

## Rate Limiting

The API enforces per-account rate limits based on the **account** linked
to the API key (not per key). All keys sharing an account draw from the
same budget.

| Endpoint             | Limit          |
|----------------------|----------------|
| `POST /api/messages/send` | 120 requests per minute |

When exceeded, the API returns:

```json
// Status 429 Too Many Requests
{
  "error": "Rate limit exceeded. Try again later."
}
```

Headers included in the 429 response (RFC 6585):

| Header                     | Description                        |
|----------------------------|------------------------------------|
| `Retry-After`              | Seconds to wait before retrying    |
| `X-RateLimit-Limit`        | Max requests per window            |
| `X-RateLimit-Remaining`    | Requests remaining in this window  |
| `X-RateLimit-Reset`        | Epoch timestamp when the window resets |

---

## Errors

All errors return a JSON body with an `error` field:

```json
{
  "error": "Human-readable description of what went wrong."
}
```

| Status | Common causes                                               |
|--------|-------------------------------------------------------------|
| 400    | Missing `to`, missing `text`/`template`, invalid phone, or both `text` and `template` provided. |
| 401    | Missing `Authorization` header, invalid Bearer token, or revoked API key. |
| 404    | Resource not found (e.g. DELETE on a non-existent API key). |
| 429    | Rate limit exceeded.                                        |
| 500    | Internal server error.                                      |
| 502    | Meta API rejected the send (bad template, unconfigured WhatsApp, etc.). |

---

## Notes

- Messages are sent through the WhatsApp Cloud API associated with the
  account that owns the API key. The account must have WhatsApp
  configured.
- Sending outside the 24-hour customer service window requires a
  pre-approved **template** message. Free-form text only works within
  the open window.
- The API creates contacts and conversations on the fly if they do not
  already exist for the given phone number.
- API usage updates the `last_used_at` timestamp on the key (visible in
  the key list) to help with audit and lifecycle management.
