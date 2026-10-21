import prisma from "../prismaClient.js";

// BUKU TRONTON -> Laporan Divisi > Armada > "Pengeluaran Operasional Sopir"
// Tiap TrontonTrip (masukLaporan = true) membuat sampai 2 baris cerminan di DivisiTx
// (PENGELUARAN, divisi Armada, kelompok "operasional"):
//   - "Uang Jalan Sopir"   = uangJalan          (sumber "AUTO_TRONTON_UJ:<id trip>")
//   - "Pembelian Material" = uangBeliMaterial   (sumber "AUTO_TRONTON_BM:<id trip>")
// subKategori = nopol kendaraan (supaya nyambung ke Rekap Armada), kalau nopol
// tidak diketahui dipakai nama sopir. Diubah/dihapus -> cerminannya ikut.
// (Pola sama dengan services/stokUpahKuli.js.)
export const TRONTON_UJ_PREFIX = "AUTO_TRONTON_UJ:";
export const TRONTON_BM_PREFIX = "AUTO_TRONTON_BM:";

async function nopolSopir(trip) {
  if (trip.noPolisi) return trip.noPolisi;
  if (!trip.sopirId) return null;
  const list = await prisma.armada.findMany({ where: { sopirId: trip.sopirId }, select: { nopol: true, jenis: true } });
  const tronton = list.find((a) => String(a.jenis || "").toLowerCase().includes("tronton"));
  return (tronton || list[0])?.nopol || null;
}

async function upsertBaris(sumber, data, nominal) {
  const ada = await prisma.divisiTx.findFirst({ where: { sumber } });
  if (!(nominal > 0)) {
    if (ada) await prisma.divisiTx.delete({ where: { id: ada.id } });
    return;
  }
  if (ada) await prisma.divisiTx.update({ where: { id: ada.id }, data: { ...data, nominal, sumber } });
  else await prisma.divisiTx.create({ data: { ...data, nominal, sumber } });
}

export async function syncTrontonTx(trip) {
  const ujSumber = `${TRONTON_UJ_PREFIX}${trip.id}`;
  const bmSumber = `${TRONTON_BM_PREFIX}${trip.id}`;
  if (!trip.masukLaporan) {
    await prisma.divisiTx.deleteMany({ where: { sumber: { in: [ujSumber, bmSumber] } } });
    return;
  }
  const sub = (await nopolSopir(trip)) || trip.sopirNama;
  const rute = [trip.tujuan ? `\u2192 ${trip.tujuan}` : null].filter(Boolean).join(" ");
  const dasar = {
    divisi: "Armada",
    tipe: "PENGELUARAN",
    kelompok: "operasional",
    subKategori: sub,
    qty: null,
    hargaSatuan: null,
    tanggal: trip.tanggal,
  };
  await upsertBaris(
    ujSumber,
    { ...dasar, kategori: "Uang Jalan Sopir", keterangan: `Otomatis dari Buku Tronton \u2014 ${trip.sopirNama} ${rute}`.trim() },
    Number(trip.uangJalan) || 0
  );
  await upsertBaris(
    bmSumber,
    {
      ...dasar,
      kategori: "Pembelian Material",
      keterangan: `Otomatis dari Buku Tronton \u2014 ${trip.sopirNama}${trip.material ? ` beli ${trip.material}` : ""} ${rute}`.trim(),
    },
    Number(trip.uangBeliMaterial) || 0
  );
}

export async function hapusTrontonTx(tripIds) {
  const ids = Array.isArray(tripIds) ? tripIds : [tripIds];
  if (!ids.length) return;
  const sumber = ids.flatMap((id) => [`${TRONTON_UJ_PREFIX}${id}`, `${TRONTON_BM_PREFIX}${id}`]);
  await prisma.divisiTx.deleteMany({ where: { sumber: { in: sumber } } });
}
