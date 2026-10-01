// Cari harga jual otomatis untuk 1 Surat Jalan dari daftar harga customer
// (menu Customer > Harga per kode stock/tujuan/jenis armada).
//
// Logika yang SAMA dipakai di frontend (frontend/src/utils/hargaCustomer.js).
// Kalau salah satu diubah, ubah yang lain juga.
//
// Urutan pencocokan:
//   1. Jenis barang SJ = nama ATAU kode stock di harga customer
//      (tidak peka huruf besar/kecil, spasi & tanda baca diabaikan).
//   2. Jenis armada: TRONTON / CD (dari armada, tipe sopir, atau no. polisi).
//      Kalau tarif untuk armada itu tidak ada, pakai tarif armada lain.
//   3. Kalau masih ada beberapa harga (beda tujuan), pilih yang tujuan /
//      kodenya cocok dengan Tujuan atau Penerima di SJ. Kalau tetap tidak
//      ketemu, ambil yang pertama dan tandai `ambigu` supaya staf cek.

const norm = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

export function jenisArmadaSJ(sj) {
  const teks = `${sj?.armada?.jenis || ""} ${sj?.noPolisi || ""}`.toUpperCase();
  if (teks.includes("TRONTON")) return "TRONTON";
  if (sj?.sopirRef?.tipe === "TRONTON") return "TRONTON";
  return "CD";
}

function cocokTujuan(price, sj) {
  const tujuan = norm(`${sj?.tujuan || ""} ${sj?.penerima || ""}`);
  if (!tujuan) return false;
  const dest = norm(price.destination);
  const kode = norm(price.destinationCode);
  return (dest && (tujuan.includes(dest) || dest.includes(tujuan))) || (kode && tujuan.split(" ").includes(kode));
}

// prices: array CustomerPrice. Hasil: { harga, price, ambigu, jumlahKandidat } atau null
export function cariHargaCustomer(prices, sj) {
  const stock = norm(sj?.jenisBarang);
  if (!stock || !prices?.length) return null;

  const kandidat = prices.filter((p) => norm(p.stockName) === stock || norm(p.stockCode) === stock);
  if (!kandidat.length) return null;

  const armada = jenisArmadaSJ(sj);
  const samaArmada = kandidat.filter((p) => (p.vehicleType || "CD") === armada);
  const pool = samaArmada.length ? samaArmada : kandidat;

  const tujuanCocok = pool.filter((p) => cocokTujuan(p, sj));
  const pilihan = tujuanCocok.length ? tujuanCocok : pool;
  const hargaBeda = new Set(pilihan.map((p) => Number(p.hargaM3 || 0)));

  return {
    harga: Number(pilihan[0].hargaM3 || 0),
    price: pilihan[0],
    ambigu: hargaBeda.size > 1,
    jumlahKandidat: pilihan.length,
  };
}

// Cadangan terakhir: harga di master Material (cocok kode / nama).
export function cariHargaMaterial(materials, sj) {
  const stock = norm(sj?.jenisBarang);
  if (!stock || !materials?.length) return null;
  const m = materials.find((x) => Number(x.hargaSatuan) > 0 && (norm(x.kode) === stock || norm(x.nama) === stock));
  return m ? { harga: Number(m.hargaSatuan), material: m } : null;
}
