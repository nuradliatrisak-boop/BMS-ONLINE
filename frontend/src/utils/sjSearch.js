// Pencarian serbaguna untuk daftar Surat Jalan di browser (dipakai saat memilih
// SJ untuk invoice). Satu kotak cari untuk SEMUA kolom: no SJ, tanggal, penerima,
// tujuan, jenis barang, no. polisi, sopir, customer, armada, divisi, M3.
// Kalimat dipecah per kata dan SEMUA kata harus ketemu, di kolom manapun --
// mis. "rorotan pasir" = SJ tujuan Rorotan yang barangnya pasir.

const BULAN = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];

function teksTanggal(t) {
  if (!t) return "";
  const iso = new Date(t).toISOString().slice(0, 10); // yyyy-mm-dd
  const [y, m, d] = iso.split("-");
  const bulan = BULAN[Number(m) - 1] || "";
  return [iso, `${d}/${m}/${y}`, `${d}-${m}-${y}`, `${Number(d)} ${bulan} ${y}`, `${Number(d)} ${bulan.slice(0, 3)} ${y}`, bulan].join(" ");
}

export function teksSJ(sj) {
  const m3 = Number(sj.m3);
  return [
    sj.no,
    teksTanggal(sj.tanggal),
    sj.penerima,
    sj.tujuan,
    sj.jenisBarang,
    sj.noPolisi,
    sj.sopir,
    sj.divisi,
    sj.customer?.nama,
    sj.customer?.kode,
    sj.armada?.noPolisi,
    sj.armada?.jenis,
    Number.isFinite(m3) ? `${m3} ${String(m3).replace(".", ",")}` : "",
  ]
    .filter((v) => v !== undefined && v !== null && v !== "")
    .join(" ")
    .toLowerCase();
}

export function cocokSJ(sj, query) {
  const kata = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!kata.length) return true;
  const teks = teksSJ(sj);
  return kata.every((k) => teks.includes(k));
}
