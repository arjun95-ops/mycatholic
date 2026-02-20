# Radar Parity UAT Checklist (Web vs Mobile)

Tanggal: 2026-02-20
Scope: `Radar`, `Ajak Misa`, `Check-in Misa`, `Komentar Radar`

## Persiapan
- Siapkan 2 akun: `Host` dan `Invitee`.
- Pastikan keduanya login di web.
- Pastikan data gereja/keuskupan/negara tersedia.

## 1) Buat Radar (Host)
1. Buka `Radar` lalu klik `Buat Radar`.
2. Isi `Judul`, pilih `Negara -> Keuskupan -> Gereja`.
3. Pilih `Tanggal` lalu pilih `Jadwal misa` (atau isi `Jam manual`).
4. Atur `Kuota Peserta`, `Izinkan Peserta Mengundang Teman`, `Butuh Persetujuan Host`.
5. Simpan.

Ekspektasi:
- Radar berhasil dibuat.
- Host otomatis tercatat sebagai peserta (`JOINED/HOST`).
- Event muncul di daftar radar dan halaman detail.

## 2) Ajak Misa dari Profil User Lain
1. Dari akun `Host`, buka profil akun `Invitee`.
2. Klik tombol `Ajak Misa`.
3. Verifikasi diarahkan ke `/radar?tab=ajak&targetId=...`.
4. Pilih radar publik lalu kirim undangan.

Ekspektasi:
- Tab `Ajak` aktif.
- Target user otomatis terisi pada card target.
- Undangan terkirim tanpa error.

## 3) Inbox Ajak Misa (Invitee)
1. Login sebagai `Invitee`.
2. Buka `Radar` tab `Ajak`.
3. Verifikasi section `Masuk` dan `Dikirim` tampil.
4. Terima undangan dari section `Masuk`.

Ekspektasi:
- Status undangan berubah sesuai aksi.
- Jika undangan terkait chat room, user bisa lanjut ke chat.
- Jika butuh approval host, status menjadi `PENDING`.

## 4) Join Radar Private
1. Pastikan ada radar private dengan undangan personal aktif untuk `Invitee`.
2. Dari daftar radar/private detail, tekan aksi join.

Ekspektasi:
- Tanpa undangan aktif: tampil pesan tidak memiliki undangan aktif.
- Dengan undangan aktif: accept + join berjalan, atau `PENDING` bila host approval aktif.

## 5) Check-in Misa
1. Klik `Check-in` di Radar.
2. Pilih lokasi (negara/keuskupan/gereja).
3. Pilih tanggal + jadwal misa atau jam manual.
4. Pilih visibilitas (`followers/public/private`) dan opsi notifikasi.
5. Simpan check-in, lalu lakukan check-out.

Ekspektasi:
- Check-in aktif tampil pada panel status.
- Presence list mengikuti scope visibilitas.
- Check-out mengakhiri status aktif.

## 6) Komentar Radar + Likes
1. Buka detail radar.
2. Tambah komentar utama.
3. Balas komentar (reply thread).
4. Like/unlike komentar.

Ekspektasi:
- Komentar tampil berurutan dengan thread reply.
- Like count dan status liked berubah real-time sesuai refresh query.
- Tidak ada error RLS pada akun authenticated.

## 7) Aturan Acara pada Detail Radar
1. Buka detail radar yang baru dibuat.
2. Cek kartu `Aturan Acara`.

Ekspektasi:
- Menampilkan `Kuota Peserta`.
- Menampilkan `Invite Teman` (Diizinkan/Tidak diizinkan).
- Menampilkan `Persetujuan Host` (Aktif/Tidak).

## 8) Deep Link Route
1. Buka `/radar/create`.
2. Buka `/radar/checkin`.
3. Buka `/radar/invites`.

Ekspektasi:
- Redirect masing-masing ke tab radar yang benar.
- Dialog intent (`openCreate`, `openCheckin`) hanya terbuka sekali, tidak loop reopen.

## Catatan Pass/Fail
- PASS jika semua langkah di atas sesuai ekspektasi tanpa error fatal (UI freeze, uncaught error, write gagal).
- FAIL jika ada mismatch konsep/flow dibanding mobile atau data tidak tersimpan sinkron di Supabase.
