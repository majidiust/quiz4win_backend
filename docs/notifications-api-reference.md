# Quiz4Win API — Notifications & Push Reference

Base URL: `https://api.quiz4win.com`  
All requests require: `Authorization: Bearer <access-token>`  
All responses are JSON: `{ ... }` on success, `{ "error": "<message>" }` on failure.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notifications` | List inbox |
| `PATCH` | `/notifications/read` | Mark notification(s) as read |
| `GET` | `/notifications/preferences` | Get notification preferences |
| `PUT` | `/notifications/preferences` | Update notification preferences |
| `POST` | `/notifications/push-token` | Register / refresh FCM push token |
| `DELETE` | `/notifications/push-token` | Unregister push token (logout / rotation) |

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `unauthorized` | 401 | Missing or invalid JWT |
| `device_id or token is required` | 400 | DELETE called with empty body |
| `token, platform and device_id are required` | 400 | POST missing a required field |
| `Invalid platform. Supported: ios, android` | 400 | Unsupported platform value |
| `No valid preference fields provided` | 400 | PUT body contained no known boolean fields |

---

## `GET /notifications` — List Inbox

Returns paginated in-app notifications for the authenticated user, newest first.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page (max `100`) |
| `unread_only` | boolean | `false` | Return only unread items when `true` |

**Response `200`:**
```json
{
  "notifications": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "type": "system",
      "title": "Your KYC was approved",
      "body": "You can now make withdrawals.",
      "data": {},
      "is_read": false,
      "sent_via_push": true,
      "created_at": "2026-05-30T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "total_pages": 3
  }
}
```

**Notification types:** `system` · `promotion` · `game_reminder` · `kyc_update`

---

## `PATCH /notifications/read` — Mark as Read

**Body (JSON):**
```json
{ "notification_id": "uuid" }
```
Omit `notification_id` to mark **all** notifications as read.

**Response `200`:**
```json
{ "message": "Notification marked as read" }
```

---

## `GET /notifications/preferences` — Get Preferences

Returns the user's current push/in-app notification preferences.  
If the user has never saved preferences, returns safe defaults.

**Response `200`:**
```json
{
  "preferences": {
    "game_reminders": true,
    "promotions": false,
    "kyc_updates": true,
    "system": true
  }
}
```

---

## `PUT /notifications/preferences` — Update Preferences

Send any subset of the boolean fields — only fields present in the body are updated.

**Body (JSON):**
```json
{
  "game_reminders": true,
  "promotions": false,
  "kyc_updates": true,
  "system": true
}
```

**Response `200`:**
```json
{ "message": "Preferences updated", "preferences": { "promotions": false } }
```

---

## `POST /notifications/push-token` — Register / Refresh FCM Token

Call this after login, on every app start, and whenever FCM rotates the token.
The upsert key is `device_id` — re-registering the same device replaces the old token automatically.

**Body (JSON):**
```json
{
  "token": "fcm_device_token_string",
  "platform": "ios",
  "device_id": "stable-unique-device-uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | ✅ | FCM registration token from the Firebase SDK |
| `platform` | string | ✅ | `"ios"` or `"android"` |
| `device_id` | string | ✅ | Stable unique identifier for the install (see below) |

**`device_id` sources:**

| Platform | Recommended source |
|----------|--------------------|
| **iOS** | `UIDevice.current.identifierForVendor?.uuidString` |
| **Android** | `Settings.Secure.ANDROID_ID`, or a UUID written to `SharedPreferences` on first launch |

**Response `201`:**
```json
{ "message": "Push token registered" }
```

---

## `DELETE /notifications/push-token` — Unregister Token

Call this in your **logout handler** before clearing the user session.
The server scopes the delete to `user_id = auth.uid()` — a user can never remove another user's token.

**Body (JSON) — provide one of:**
```json
{ "device_id": "stable-unique-device-uuid" }
```
```json
{ "token": "fcm_device_token_string" }
```

**Response `200`:**
```json
{ "message": "Push token unregistered" }
```

---

## FCM Payload Shape

When the backend delivers a push notification, your app receives:

```json
{
  "notification": {
    "title": "Your game is starting!",
    "body": "Join now before it's too late."
  },
  "data": {
    "type": "game_reminder",
    "broadcast_id": "uuid-or-empty-string"
  },
  "android": {
    "priority": "HIGH",
    "notification": { "sound": "default" }
  },
  "apns": {
    "headers": { "apns-priority": "10" },
    "payload": { "aps": { "sound": "default" } }
  }
}
```

- `data.type` — one of `system`, `promotion`, `game_reminder`, `kyc_update`
- `data.broadcast_id` — populated for broadcast messages; use it to deep-link to the relevant screen

---

## Recommended Client Flow

```
App launch (user is logged in)
  1. Ensure FCM/APNs permission is granted
  2. Get FCM token from Firebase SDK
  3. POST /notifications/push-token  { token, platform, device_id }
  4. Subscribe to onTokenRefresh (Android) / didReceiveRegistrationToken (iOS)
     → POST /notifications/push-token again with the new token

Logout
  1. DELETE /notifications/push-token  { device_id }
  2. Clear the local FCM token

App receives a push notification (foreground)
  → Show local in-app alert
  → Optionally GET /notifications to refresh the inbox badge

App receives a push notification (background / tapped)
  → OS handles display
  → On tap: read data.broadcast_id or data.type to deep-link
```

