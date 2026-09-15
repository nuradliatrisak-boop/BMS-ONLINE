// Daftar dokumen "wajib" (baris bawaan) yang otomatis dibuat kosong tiap
// kali ada aset baru (Mobil/Kapal/Alat Berat) ditambahkan. Staff tinggal
// isi/upload belakangan lewat menu masing-masing. Ini cuma daftar AWAL --
// user tetap bebas menambah baris dokumen custom lain sendiri lewat
// "+ Tambah Dokumen" (lihat routes/dokumen.js), jadi list di bawah TIDAK
// membatasi, cuma bikinin starting point.
//
// Tiap baris punya `butuhFile`:
//   true  = baris ini perlu upload file (STNK, Invoice, dst) -- panel &
//           form akan menampilkan kolom "Upload File".
//   false = baris ini cukup diisi teks lewat kolom `nilai` (mis. nomor
//           dokumen/tanggal berlaku) -- panel & form TIDAK menampilkan
//           kolom upload sama sekali untuk baris ini.
//
// Daftar ALAT_BERAT & MOBIL disesuaikan dari hasil cek dokumen fisik unit
// (arsip "ALAT_BMS_2026") -- tiap unit alat berat konsisten punya 3
// dokumen inti: Surat Pelepasan Hak (bukti kepemilikan, karena alat berat
// bekas umumnya tidak ada BPKB), Invoice/Kwitansi pembelian, dan SIA
// (Surat Keterangan Hasil Pemeriksaan & Pengujian/riksa uji K3 dari
// Disnakertrans). Kendaraan (Tronton/Colt Diesel dkk) juga konsisten
// menyertakan bukti pelunasan pajak tahunan (TBPKP/SKPD) berpasangan
// dengan STNK, jadi ditambahkan sebagai baris tersendiri.
export const DEFAULT_DOKUMEN = {
  MOBIL: [
    { label: "STNK", butuhFile: true },
    { label: "Bukti Pelunasan Pajak Tahunan (TBPKP/SKPD)", butuhFile: true },
    { label: "KIR", butuhFile: true },
    { label: "Foto Mobil", butuhFile: true },
  ],
  KAPAL: [
    { label: "Gross Akte", butuhFile: true },
    { label: "Sertifikat Keselamatan", butuhFile: true },
    { label: "Pas Besar", butuhFile: true },
    { label: "Buku Pulau", butuhFile: true },
    { label: "Foto Kapal", butuhFile: true },
  ],
  ALAT_BERAT: [
    { label: "Surat Pelepasan Hak", butuhFile: true },
    { label: "Invoice", butuhFile: true },
    { label: "SIA", butuhFile: true },
    { label: "SIO", butuhFile: true },
    { label: "Foto Excavator", butuhFile: true },
  ],
};

// Kompat lama: beberapa tempat mungkin masih mengacu ke daftar label saja
// (tanpa info butuhFile). Diturunkan otomatis dari DEFAULT_DOKUMEN supaya
// tidak ada dua sumber kebenaran yang bisa beda-beda.
export const DEFAULT_DOKUMEN_LABELS = Object.fromEntries(
  Object.entries(DEFAULT_DOKUMEN).map(([tipe, rows]) => [tipe, rows.map((r) => r.label)])
);

// Helper dipakai di routes/armada.js, routes/kapal.js, routes/alatBeratUnit.js
// waktu aset baru dibuat -- bikinin baris Dokumen kosong per baris wajib,
// termasuk info butuhFile-nya supaya panel tahu perlu nampilin kolom
// upload atau tidak untuk baris itu.
export function buildDefaultDokumenData(asetTipe, asetId) {
  const rows = DEFAULT_DOKUMEN[asetTipe] || [];
  return rows.map(({ label, butuhFile }) => ({
    asetTipe,
    asetId,
    label,
    wajib: true,
    butuhFile,
  }));
}
