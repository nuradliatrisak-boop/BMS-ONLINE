// Helper kecil khusus tampilan Stok Solar (BBM).

export const fmtTgl = (t) =>
  new Date(t).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export const fmtTglPendek = (t) =>
  new Date(t).toLocaleDateString("id-ID", { day: "2-digit", month: "short", timeZone: "UTC" });

// 12345.5 -> "12.345,5"
export const fmtL = (n) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(Math.round((Number(n) || 0) * 10) / 10);

export function tglBesok(tanggal) {
  const d = new Date(tanggal);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toLocaleDateString("id-ID", { timeZone: "UTC" });
}

export const cekBadge = (st) =>
  ({ SESUAI: "badge b-lunas", KURANG: "badge b-belum", LEBIH: "badge b-sebagian" }[st] || "badge b-belumttd");

export const cekLabel = (st) =>
  ({ SESUAI: "Sesuai", KURANG: "Kurang", LEBIH: "Lebih", BELUM_DICEK: "Belum dicek", MENUNGGU: "Dicek besok" }[st] || st);

// tanggal lokal (bukan UTC) -> "YYYY-MM-DD"
export const isoLokal = (d) => d.toLocaleDateString("en-CA");
