# Sync Audit Runbook (Web + Mobile + Admin)

Gunakan runbook ini untuk audit penuh sinkronisasi Supabase.

## 1) Siapkan environment

Isi `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # secret key (sb_secret...) atau legacy service_role JWT
E2E_TEST_EMAIL=...
E2E_TEST_PASSWORD=...
```

## 2) Verifikasi baseline schema + RPC

```bash
npm run verify:sync
```

Expected:
- Tidak ada `TypeError: fetch failed`.
- Jika service key valid, akan muncul `admin key probe (auth.admin.listUsers)`.

## 3) Smoke audit lintas modul (readonly)

```bash
npm run audit:smoke
```

Expected:
- `auth smoke: login test user` muncul sukses.
- `auth get_chat_inbox` sukses.
- Jika ada warning RLS, pastikan sesuai desain (mis. anon memang dibatasi).

## 4) Audit RLS di SQL Editor Supabase

Jalankan file:

`db/rls_sync_audit.sql`

Cek hasil:
- tabel target sudah `rls_enabled=true` untuk tabel sensitif.
- policy `select/insert/update/delete` sesuai role (`anon` vs `authenticated`).
- RPC penting tersedia: `update_chat_metadata`, `get_chat_inbox`, `join_chat`.

## 5) Regression check build web

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## 6) UAT lintas aplikasi

Checklist minimal:
- Auth: login/register/reset
- Feed: create post + image upload + comment
- Profile: follow/unfollow + start chat
- Chat: send/read message realtime
- Schedule/Radar/Checkin
- Notifications
- Story upload + viewer

Jika ada mismatch, capture:
- nama fitur
- route/halaman
- table/RPC terkait
- error exact dari browser console/Supabase logs

## 7) Radar parity smoke (wajib sebelum rilis)

```bash
npm run audit:smoke:radar
npm run audit:smoke:radar:invite
```

Expected:
- `smoke radar flow lulus`.
- `smoke 2-user Ajak Misa lulus`.

Catatan:
- `audit:smoke:radar` memverifikasi create/join/comment/like/checkin/check-out flow.
- `audit:smoke:radar:invite` memverifikasi skenario ajak misa personal antar 2 akun.
