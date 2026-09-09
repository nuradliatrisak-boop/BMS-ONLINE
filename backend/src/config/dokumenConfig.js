// Daftar label dokumen "wajib" (baris bawaan) yang otomatis dibuat kosong
// tiap kali ada aset baru (Mobil/Kapal/Alat Berat) ditambahkan. Staff
// tinggal isi/upload belakangan lewat menu masing-masing. Ini cuma daftar
// AWAL -- user tetap bebas menambah baris dokumen custom lain sendiri
// lewat "+ Tambah Dokumen" (lihat routes/dokumen.js), jadi list di bawah
// TIDAK membatasi, cuma bikinin starting point.
export const DEFAULT_DOKUMEN_LABELS = {
  MOBIL: ["STNK", "KIR", "Foto Mobil"],
  KAPAL: [
    "Gross Akte",
    "Sertifikat Keselamatan",
    "Pas Besar",
    "Buku Pulau",
    "Foto Kapal",
  ],
  ALAT_BERAT: ["Invoice", "SIA", "SIO", "Foto Excavator"],
};

// Helper dipakai di routes/armada.js, routes/kapal.js, routes/alatBeratUnit.js
// waktu aset baru dibuat -- bikinin baris Dokumen kosong per label wajib.
export function buildDefaultDokumenData(asetTipe, asetId) {
  const labels = DEFAULT_DOKUMEN_LABELS[asetTipe] || [];
  return labels.map((label) => ({
    asetTipe,
    asetId,
    label,
    wajib: true,
  }));
}
