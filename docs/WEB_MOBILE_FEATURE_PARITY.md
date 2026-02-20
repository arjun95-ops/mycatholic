# Web vs Mobile Feature Parity (MyChatolic)

Dokumen ini merangkum status parity antara `mychatolic_app` (mobile) dan versi web.

## Core Auth
- `Register` web: ✅ (`/register`)
- `Register multi-step parity (akun/data/lokasi/role)` web: ✅
- `Register profile sync parity (metadata + profile upsert check)` web: ✅
- `Register lokasi wajib dari master data (tanpa input manual)` web: ✅
- `Login` web: ✅ (`/login`)
- `Login guard parity (email verified + profile exists + banned/rejected)` web: ✅
- `Login self-heal profil kosong (best-effort upsert profil dari metadata)` web: ✅
- `Login redirect ke edit profile saat profile belum lengkap` web: ✅
- `Forgot password` web: ✅ (`/forgot-password`)
- `Reset password` web: ✅ (`/reset-password`)
- `Email verification flow` web: ✅ (`/verify-email`)

## Main Navigation
- `Home/Feed` web: ✅ (`/`)
- `Jadwal` web: ✅ (`/schedule`)
- `Alkitab` web: ✅ (`/bible`)
- `Radar` web: ✅ (`/radar`)
- `Chat` web: ✅ (`/chat`)
- `Profile` web: ✅ (`/profile`)

## Feed & Social
- `Feed list + infinite scroll` web: ✅
- `Create post` web: ✅ (composer modal)
- `Post detail` web: ✅ (`/post/[id]`)
- `Like / comment / save / share` web: ✅
- `Saved posts` web: ✅ (tab `Tersimpan` di profile sendiri)

## Profile
- `My profile` web: ✅ (`/profile`)
- `Other profile` web: ✅ (`/profile/[id]`)
- `Followers / following` web: ✅
- `Follow / unfollow` web: ✅
- `Start chat from profile` web: ✅
- `Profile posts list` web: ✅
- `Profile media grid` web: ✅

## Stories
- `Story rail` web: ✅
- `Story upload` web: ✅
- `Story viewer` web: ✅
- `Story fetch tanpa dependency FK relation (anti PGRST200)` web: ✅
- `Story view tracking` web: ✅ (best-effort, fallback by schema)
- `Story reaction` web: ✅ (best-effort, fallback by schema)
- `Story reply` web: ✅ (prioritas kirim ke chat; fallback table `story_replies`)
- `Video story renderer` web: ✅ (native `<video>` playback + auto-next)
- `Seen/unseen story ring accuracy` web: ✅ (sinkron ke `story_views` + optimistic update)

## Chat
- `Inbox list` web: ✅
- `Direct chat` web: ✅
- `Group chat data model` web: ✅
- `Create group` web: ✅ (dialog inbox + pilih member awal)
- `Join group (invite code)` web: ✅ (dialog inbox + hook/service)
- `Realtime message sync` web: ✅
- `Message reactions` web: ✅ (hook/service)
- `Archived chat flow` web: ✅ (tab inbox + archive/unarchive di inbox/detail)
- `Group info + moderation` web: ✅ (anggota, copy invite code, approve/reject request, leave group)
- `Pin / mute chat` web: ✅ (toggle di detail + indikator di inbox)
- `Attachment composer` web: ✅ (image/video/audio/file upload di chat)
- `Reply message UX` web: ✅ (`reply_to_id` + preview + jump ke pesan asal)
- `Chat search` web: ✅ (search keyword pesan/nama/file di detail chat)
- `Media gallery` web: ✅ (dialog galeri image/video/audio/file + jump ke pesan)
- `Unread marker + auto mark as read` web: ✅ (`last_read_at` marker + mutation sinkron)
- `Thread dialog` web: ✅ (lihat rantai balasan + balas/lompat ke pesan utama)

## Radar / Schedule / Bible
- `Radar events` web: ✅
- `Radar tabs (Cari/Riwayat/Ajak)` web: ✅ (kirim/inbox/accept/decline, duplicate-guard, RPC-first response + fallback)
- `Radar create/check-in action` web: ✅ (buat radar + check-in + join radar)
- `Radar create parity (lokasi hierarki + jadwal + kuota + invite policy + host approval)` web: ✅
- `Ajak Misa parity (Masuk/Dikirim + invite dari profile user lain)` web: ✅
- `Radar detail parity (Aturan Acara + komentar thread + like komentar)` web: ✅
- `Mass schedule` web: ✅
- `Bible books` web: ✅
- `Bible chapter/verse reader` web: ✅ (reader bab/ayat + fallback schema lama/baru)

## Notifications & Settings
- `Notification center` web: ✅
- `Mark read / mark all read` web: ✅
- `Settings home` web: ✅
- `Settings security` web: ✅ (`/settings/security`)
- `Change password` web: ✅ (`/settings/change-password`)
- `Notification preferences` web: ✅ (`/settings/notifications`)
- `Theme switch` web: ✅ (`/settings/theme`)
- `Language preference` web: ✅ (`/settings/language`)

## UI/UX Direction
- `Desktop` layout: ✅ (header + sidebar + feed rails)
- `Mobile` layout: ✅ (bottom nav + compact cards)
- `Tablet` responsiveness: ✅ (breakpoints diperbaiki di halaman utama/radar/profile/settings)
- Style reference `Facebook/Instagram`: ✅ (3-column feed desktop, story rail, profile media grid, social card interactions)

## Remaining High-Priority Enhancements
- Hardening edge-case skema campuran legacy/v2 untuk data lama (environment yang belum sepenuhnya migrasi).
- Lengkapi parity route turunan mobile yang sangat spesifik (contoh beberapa halaman utilitas lama Flutter) bila memang masih dipakai pada produk final.
