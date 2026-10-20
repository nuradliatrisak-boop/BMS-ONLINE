import prisma from "../prismaClient.js";

// UPAH KULI per mutasi Stok -> Laporan Divisi > Pengeluaran
// Tiap StokMutasi boleh punya `upahKuli` (Rp). Kalau > 0, otomatis dibuatkan 1 baris
// cerminan di DivisiTx (PENGELUARAN) pada divisi barangnya, `sumber` = "AUTO_STOK_KULI:<id mutasi>".
// Diubah/dihapus -> cerminannya ikut. (Pola sama dengan services/poUpahKuli.js.)
export const STOK_KULI_PREFIX = "AUTO_STOK_KULI:";

function kelompokPengeluaran(divisi) {
  return divisi === "Kontraktor" || divisi === "Kapal" ? "pengeluaran" : "lainnya-pengeluaran";
}

function dataTx(stok, m) {
  return {
    divisi: stok.divisi || "Kontraktor",
    tipe: "PENGELUARAN",
    kelompok: kelompokPengeluaran(stok.divisi),
    kategori: "Upah Kuli",
    subKategori: [stok.proyek || stok.namaCustomer || null, stok.nama].filter(Boolean).join(" \u2014 "),
    keterangan: `Otomatis dari Stok \u2014 ${stok.nama}` + (m.noSurat ? ` (SJ ${m.noSurat})` : ""),
    qty: null,
    hargaSatuan: null,
    nominal: Number(m.upahKuli) || 0,
    tanggal: m.tanggal,
    sumber: `${STOK_KULI_PREFIX}${m.id}`,
  };
}

export async function syncStokUpahKuliTx(stok, m) {
  const sumber = `${STOK_KULI_PREFIX}${m.id}`;
  const ada = await prisma.divisiTx.findFirst({ where: { sumber } });
  if (!(Number(m.upahKuli) > 0)) {
    if (ada) await prisma.divisiTx.delete({ where: { id: ada.id } });
    return;
  }
  const data = dataTx(stok, m);
  if (ada) await prisma.divisiTx.update({ where: { id: ada.id }, data });
  else await prisma.divisiTx.create({ data });
}

export async function hapusStokUpahKuliTx(mutasiIds) {
  const ids = Array.isArray(mutasiIds) ? mutasiIds : [mutasiIds];
  if (!ids.length) return;
  await prisma.divisiTx.deleteMany({ where: { sumber: { in: ids.map((id) => `${STOK_KULI_PREFIX}${id}`) } } });
}

// Dipakai kalau divisi / nama / proyek barang diubah: sinkronkan ulang semua barisnya.
export async function syncSemuaStokUpahKuli(stokId) {
  const stok = await prisma.stokBarang.findUnique({ where: { id: stokId }, include: { mutasi: true } });
  if (!stok) return;
  for (const m of stok.mutasi) await syncStokUpahKuliTx(stok, m);
}
