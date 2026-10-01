// Helper format angka bersama (dipakai banyak halaman).
//
// Kubikasi (M3): selalu tampil minimal 2 angka di belakang koma, jadi 3.6
// tampil "3,60" (bukan "3,6" / "3.600"). Kalau datanya memang 3 desimal
// (mis. 6.498) tetap tampil lengkap "6,498" -- tidak dibulatkan.
const nfM3 = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function fmtM3(n) {
  const v = Number(n);
  return nfM3.format(Number.isFinite(v) ? v : 0);
}

// Qty baris invoice: kalau satuannya kubik (m3 / m³ / kubik) pakai format M3,
// selain itu tampil apa adanya seperti sebelumnya.
export function fmtQty(qty, satuan) {
  if (/m3|m³|kubik/i.test(String(satuan || ""))) return fmtM3(qty);
  return String(qty ?? "");
}

// Versi teks (bukan angka) untuk dicetak/diexport: "3,60".
export const fmtM3Text = fmtM3;

// "1234567" -> "1.234.567" (tanpa awalan Rp)
export function ribuan(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString("id-ID");
}
