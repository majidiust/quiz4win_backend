# Task — Add password-reset deep link (Universal Link) to the Expo app

We use the Quiz4Win backend API only — **do NOT add `@supabase/supabase-js` or call Supabase directly**. All auth goes through `https://api.quiz4win.com`.

## 1) Configure Universal Links / App Links

In `app.json` (or `app.config.ts`):

```json
{
  "expo": {
    "scheme": "quiz4win",
    "ios": {
      "bundleIdentifier": "com.quiz4win.app",
      "associatedDomains": ["applinks:app.quiz4win.com"]
    },
    "android": {
      "package": "com.quiz4win.app",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            { "scheme": "https", "host": "app.quiz4win.com", "pathPrefix": "/auth" }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

The mobile/devops team must host these two files at `https://app.quiz4win.com/.well-known/`:

- **`apple-app-site-association`** (no extension, `Content-Type: application/json`):
  ```json
  {
    "applinks": {
      "apps": [],
      "details": [
        { "appID": "<TEAM_ID>.com.quiz4win.app", "paths": ["/auth/*"] }
      ]
    }
  }
  ```
- **`assetlinks.json`**:
  ```json
  [{
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.quiz4win.app",
      "sha256_cert_fingerprints": ["<SHA-256 fingerprint from your signing key>"]
    }
  }]
  ```
  (Get the SHA-256 fingerprint via Expo: `eas credentials` → Android → production.)

These manifests are served by the `quiz4win-app` Docker container from `app/public/.well-known/` (see `app/Dockerfile`). Edit the placeholders (`TEAMID` and the SHA-256 fingerprint) in those files, then publish with:

```bash
docker compose build app && docker compose up -d app
```

Host nginx (`deploy/nginx/app.quiz4win.com.conf`) terminates TLS and proxies everything to that container on `127.0.0.1:5801`.

## 2) Handle the deep link route

In your app's router (Expo Router example — `app/auth/reset-password.tsx`):

```tsx
import { useEffect, useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import * as Linking from "expo-linking";
import { View, Text, TextInput, Pressable, Alert } from "react-native";

function parseHashParams(url: string): Record<string, string> {
  // Universal-Link emails put tokens in the URL fragment: …#access_token=…&refresh_token=…
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return {};
  const hash = url.slice(hashIndex + 1);
  const out: Record<string, string> = {};
  for (const part of hash.split("&")) {
    const [k, v] = part.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return out;
}

export default function ResetPasswordScreen() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      // Initial URL when the app was launched by the link.
      const initial = await Linking.getInitialURL();
      if (initial) {
        const p = parseHashParams(initial);
        setAccessToken(p.access_token ?? null);
        setType(p.type ?? null);
      }
    })();

    // Subsequent links while the app is foregrounded.
    const sub = Linking.addEventListener("url", ({ url }) => {
      const p = parseHashParams(url);
      if (p.access_token) setAccessToken(p.access_token);
      if (p.type) setType(p.type);
    });
    return () => sub.remove();
  }, []);

  async function onSubmit() {
    if (!accessToken || type !== "recovery") {
      Alert.alert("Link expired", "Please request a new password-reset email.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("https://api.quiz4win.com/auth/update-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ new_password: password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update password");
      Alert.alert("Success", "Your password has been updated. Please sign in.");
      router.replace("/login");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!accessToken || type !== "recovery") {
    return (
      <View>
        <Text>This link is invalid or has expired. Please request a new password-reset email.</Text>
      </View>
    );
  }

  return (
    <View>
      <Text>Set a new password</Text>
      <TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="New password" />
      <TextInput secureTextEntry value={confirm} onChangeText={setConfirm} placeholder="Confirm password" />
      <Pressable disabled={submitting} onPress={onSubmit}>
        <Text>{submitting ? "Updating…" : "Update password"}</Text>
      </Pressable>
    </View>
  );
}
```

## 3) The "request reset" screen (forgot-password)

```ts
await fetch("https://api.quiz4win.com/auth/forgot-password", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
});
// Always shows a generic "check your email" success message regardless of response (anti-enumeration).
```

## 4) Testing

- iOS: install via TestFlight / dev build, tap the link in a real email. Don't test from Safari address bar — Universal Links don't fire from the same domain.
- Android: `adb shell am start -a android.intent.action.VIEW -d "https://app.quiz4win.com/auth/reset-password#access_token=XYZ&type=recovery" com.quiz4win.app`
- Keep the existing `scheme: "quiz4win"` — useful later for OAuth callbacks.

## Don'ts

- ❌ Do not install `@supabase/supabase-js`.
- ❌ Do not call `supabase.auth.setSession` / `updateUser` — there is no Supabase client in the app.
- ❌ Do not send the `refresh_token` to the backend. Only the `access_token` is needed (as Bearer).
