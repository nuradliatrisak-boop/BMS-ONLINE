# Laporan Import Data Excel -> BMS Online

Sumber: `Rekap_Invoice.xlsx` (79 sheet).

## Ringkasan angka final

| Data | Jumlah |
|---|---|
| Customer | 40 (39 dari batch pertama + 1 baru: TB. Alam Jaya) |
| Rekap Penjualan (baris) | 8.312 |
| Laporan Divisi / DivisiTx (baris) | 5.316 (5.229 dari batch pertama + **87 baru**) |
| Harga Customer / CustomerPrice (baris) | **36 baru** |

## Status: 19 dari 20 sheet yang tadinya belum otomatis, sekarang SEMUA sudah masuk

Cuma **1 sheet** ("Sheet7") yang tetap tidak dimasukkan, karena isinya data
pemilu/partai politik -- bukan data bisnis sama sekali, sepertinya ter-paste
tidak sengaja ke file Excelnya. Yang lain semua sudah kerekap, dengan 3 cara
berbeda tergantung sifat datanya (supaya nggak merusak angka laporan
keuangan kalian):

### A. Transaksi/harga beneran -> masuk normal (15 sheet)

Sheet dengan tanggal & nominal yang jelas masuk sebagai transaksi biasa di
**Laporan Divisi**, atau sebagai **Harga Customer** kalau isinya daftar
harga (bukan transaksi).

| Sheet | Masuk ke | Baris |
|---|---|---|
| pajak djp | Laporan Divisi > Pajak (DJP) | 6 |
| ibat | Laporan Divisi > Pengambilan Pasir Empat Pilar Utama | 6 |
| ponton | Laporan Divisi > Perbaikan Ponton & Peralatan | 9 |
| rekap 3 | Laporan Divisi > Kasbon | 11 |
| jemb.cint | Laporan Divisi > Rekap Invoice Tambahan | 1 |
| fachry | Laporan Divisi > Rekap Invoice Tambahan | 1 |
| SIMPHINK | Laporan Divisi > Rekap Invoice Tambahan | 1 |
| BOQ KM | Laporan Divisi > Rekap Invoice Tambahan | 2 |
| KUBUS | Laporan Divisi > Rekap Invoice Tambahan | 4 |
| pitaco | Laporan Divisi > Rekap Invoice Tambahan | 4 |
| harga sihol | Customer > Harga (Sihool & Moreno) | 20 |
| HARGA BRAM | Customer > Harga (Bram) | 7 |
| harga alam jaya | Customer > Harga (customer baru TB. Alam Jaya) | 7 |

### B. Penawaran/estimasi (belum tentu deal) -> masuk, tapi ditandai jelas (3 sheet)

Angka rupiahnya asli & dimasukkan apa adanya, tapi kelompoknya dikasih
prefix **"[PENAWARAN]"** di Laporan Divisi supaya kelihatan jelas ini masih
penawaran/estimasi (belum ada No Invoice/kontrak final). Silakan
konfirmasi manual & ganti ke kelompok normal kalau sudah deal, atau hapus
kalau batal.

| Sheet | Masuk ke | Baris |
|---|---|---|
| PT. Vanesa | Laporan Divisi > [PENAWARAN] Estimasi Proyek | 3 |
| Sheet2 | Laporan Divisi > [PENAWARAN] Estimasi Proyek | 1 |
| proyek xbekasi | Laporan Divisi > [PENAWARAN] Estimasi Proyek | 2 |

### C. Tracking/ringkasan yang kemungkinan sudah kehitung di tempat lain -> masuk, tapi nominal Rp 0 (5 sheet)

Sheet-sheet ini isinya **bukan transaksi baru** -- mereka nge-track PO/piutang
yang sebagian besar sudah tercatat sebagai transaksi asli di sheet customer
lain (nomor invoice BMS-OA xxx dst yang sama persis muncul di sheet
ALEXANDER/dll). Kalau nominalnya dimasukkan lagi, jadi dobel hitung dan
angka laba-rugi kalian jadi salah.

Supaya **tetap kerekap dan bisa dicari** (sesuai permintaan), baris-baris ini
tetap saya masukkan ke Laporan Divisi dengan kelompok **"[REFERENSI]"**,
nama customer/proyeknya tetap ada di kolom kategori, dan angka aslinya tetap
saya tulis di kolom **keterangan** -- tapi kolom **nominal-nya saya set 0**
supaya tidak ikut kejumlah ke laporan keuangan. Kalau nanti kalian sudah
verifikasi manual bahwa suatu baris memang belum pernah tercatat, tinggal
diedit nominalnya dari menu Laporan Divisi.

| Sheet | Masuk ke | Baris (semua nominal Rp 0) |
|---|---|---|
| Sheet5 | Laporan Divisi > [REFERENSI] Tracking PO | 12 (9 proyek + 3 piutang) |
| PO.LTM | Laporan Divisi > [REFERENSI] Tracking PO | 11 (per customer) |
| Sheet6 | Laporan Divisi > [REFERENSI] Ringkasan Laba/Piutang/Hutang | 17 |

### D. Bukan data bisnis -> tidak dimasukkan (1 sheet)

| Sheet | Alasan |
|---|---|
| Sheet7 | Data pemilu/partai politik, tidak ada hubungannya dengan bisnis BMS sama sekali. |

## Cara pakai

```
cd backend
node scripts/importExcelData.js
```

Aman dijalankan berkali-kali (idempotent, cek duplikat sebelum insert). Yang
sudah pernah masuk sebelumnya tidak akan dobel -- cuma baris yang belum ada
yang ditambahkan.

## Yang perlu dicek manual setelah import

1. Baris **[PENAWARAN]** (4 baris) -- konfirmasi apakah sudah deal atau belum.
2. Baris **[REFERENSI]** (40 baris, nominal Rp 0) -- ini murni supaya data
   Excel kalian tidak hilang & tetap bisa dicari per customer/proyek. Kalau
   suatu saat perlu dijadikan transaksi beneran, edit manual dari menu
   Laporan Divisi (isi nominal & pastikan belum pernah tercatat di tempat
   lain).

---

## TAMBAHAN TERBARU: sheet SEWA ALAT dipindah ke Invoice

Sheet **SEWA ALAT** (2.176 baris) sekarang tidak lagi masuk Laporan Divisi,
tapi jadi **Invoice** beneran (Customer -> Invoice -> Item -> Pembayaran),
supaya angkanya kebaca Dashboard & piutang.

- 1.502 baris SEWA ALAT yang dulu ada di Laporan Divisi **sudah dihapus** dari
  `import_data.json` -> tidak ada dobel hitung.
- Uang makan operator TIDAK ditagih ke customer; dicatat sebagai PENGELUARAN
  di Laporan Divisi, kelompok **"Uang Makan Operator"** (1.119 transaksi).
- Dijalankan lewat script terpisah: `node scripts/importSewaAlat.js`.

Detail lengkap per blok, aturan pemilahan angka, dan daftar blok yang tarifnya
diasumsikan ada di **`SEWA_ALAT_REPORT.md`**.
