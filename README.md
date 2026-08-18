# Sistem BMS Online — PT Bintang Muara Sejati

Versi online dari sistem BMS, dipecah jadi 2 bagian:

- **`backend/`** — REST API (Node.js + Express + Prisma + PostgreSQL). Menyimpan semua data & mengurus login.
- **`frontend/`** — Tampilan yang dipakai staf (Vue 3 + Vite), memanggil API di atas.

Data **tidak lagi** disimpan di browser (`window.storage`) seperti file HTML lama — sekarang tersimpan permanen di database, jadi bisa diakses dari device manapun & oleh banyak staf sekaligus.

---

## 1. Coba jalan di laptop dulu (sebelum online)

### Siapkan database PostgreSQL gratis untuk testing
Paling gampang: buat akun di [neon.tech](https://neon.tech) atau [supabase.com](https://supabase.com) (keduanya ada tier gratis), lalu salin "connection string" yang diberikan (bentuknya `postgresql://...`).

### Backend
```bash
cd backend
cp .env.example .env
# buka .env, isi DATABASE_URL dengan connection string dari Neon/Supabase
# isi JWT_SECRET dengan string acak (boleh ketik asal-asalan yang panjang)

npm install
npx prisma migrate dev --name init   # bikin tabel-tabel di database
npm run seed                          # bikin akun admin pertama (admin / admin123)
npm run dev                           # server jalan di http://localhost:4000
```

### Frontend (buka terminal baru)
```bash
cd frontend
cp .env.example .env    # biarkan default (http://localhost:4000/api)
npm install
npm run dev              # buka http://localhost:5173
```

Login pakai **admin / admin123**, lalu segera bikin akun staf sungguhan lewat menu "Kelola Staf" dan ganti password admin.

> Cara ganti password admin sementara ini manual lewat `npx prisma studio` (buka tabel User, update kolom password). Kalau mau, saya bisa tambahkan halaman "ganti password" di langkah berikutnya.

---

## 2. Deploy supaya online (bisa diakses staf dari mana saja)

Rekomendasi kombinasi yang murah, stabil, dan tidak perlu urus server sendiri:

| Bagian | Rekomendasi | Kenapa |
|---|---|---|
| Database | Neon atau Supabase (Postgres) | Ada tier gratis, auto-backup, tinggal pakai |
| Backend | Railway atau Render | Auto HTTPS, tinggal hubungkan ke GitHub |
| Frontend | Vercel atau Netlify | Gratis untuk skala kantor kecil, auto HTTPS |
| Domain | Niagahoster / Domainesia | Beli `.com` atau `.id`, arahkan DNS ke Vercel |

### Langkah deploy backend (contoh pakai Railway)
1. Push folder `backend/` ke repository GitHub.
2. Di Railway: **New Project → Deploy from GitHub repo**, pilih repo ini, set **Root Directory** ke `backend`.
3. Tambahkan PostgreSQL dari Railway (atau tetap pakai Neon/Supabase) — Railway akan otomatis mengisi `DATABASE_URL`.
4. Set environment variable: `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_ORIGIN` (isi dengan alamat frontend kamu setelah dideploy, misal `https://bms.namadomainkamu.com`).
5. Set **Start Command**: `npx prisma migrate deploy && npm start`.
6. Setelah jalan, catat URL backend-nya, misal `https://bms-backend-production.up.railway.app`.

### Langkah deploy frontend (contoh pakai Vercel)
1. Push folder `frontend/` ke repository GitHub (boleh repo yang sama, beda folder).
2. Di Vercel: **Add New Project**, pilih repo ini, set **Root Directory** ke `frontend`.
3. Framework preset: Vite. Set environment variable `VITE_API_URL` = `https://bms-backend-production.up.railway.app/api` (URL backend dari langkah sebelumnya, tambahkan `/api`).
4. Deploy. Vercel kasih URL gratis (`xxx.vercel.app`) — bisa dipakai dulu, atau sambungkan domain sendiri di menu **Domains**.
5. Kembali ke Railway, update `FRONTEND_ORIGIN` dengan URL Vercel/domain final ini, supaya backend mengizinkan akses dari sana (CORS).

### Setelah online
- Login pertama pakai `admin` / `admin123`, langsung ganti password.
- Buat akun untuk tiap staf lewat menu **Kelola Staf**, tentukan role (Admin / Staf Divisi) dan divisinya.
- Staf tinggal buka URL frontend dari HP/laptop kantor manapun dan login pakai akunnya.

---

## 3. Estimasi biaya tahunan (kasar)

- Domain: ± Rp150.000–250.000/tahun
- Database (Neon/Supabase free tier cukup untuk kantor kecil): Rp0, upgrade ke paket berbayar (± Rp300.000–400.000/bulan) kalau data sudah besar
- Backend Railway/Render: ± Rp75.000–300.000/bulan tergantung pemakaian
- Frontend Vercel/Netlify: Rp0 untuk skala ini

Total realistis untuk mulai: **sekitar Rp1–4 juta/tahun**, dan bisa dimulai dari yang paling murah dulu lalu naik kelas kalau sistemnya makin dipakai.

---

## 4. Yang belum ada di versi skeleton ini (bisa ditambah bertahap)

- Cetak Surat Jalan / Invoice dengan kalibrasi posisi presisi mm (fitur ini ada di file HTML lama, cukup kompleks — enaknya ditambahkan setelah fondasi online-nya stabil)
- Halaman ganti password sendiri (sementara masih manual lewat database)
- Upload/lampiran file (foto bukti kirim, dsb.)
- Notifikasi otomatis (misal WhatsApp/email saat invoice jatuh tempo)

Kalau kamu mau, kita bisa lanjut satu-satu dari sini.
