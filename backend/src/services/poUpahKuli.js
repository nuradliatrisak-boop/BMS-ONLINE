import prisma from "../prismaClient.js";

// UPAH KULI per pengiriman PO -> Laporan Divisi > Pengeluaran
// Tiap PoPengiriman boleh punya `upahKuli` (Rp). Kalau > 0, otomatis dibuatkan
// 1 baris cerminan di DivisiTx (PENGELUARAN) pada divisi milik PO, `sumber` =
// "AUTO_PO_KULI:<id pengiriman>". Diubah/dihapus -> cerminannya ikut.
export const PO_KULI_PREFIX = "AUTO_PO_KULI:";

function kelompokPengeluaran(divisi) {
  return divisi === "Kontraktor" || divisi === "Kapal" ? "pengeluaran" : "lainnya-pengeluaran";
}

function dataTx(po, item, p) {
  return {
    divisi: po.divisi || "Supplier",
    tipe: "PENGELUARAN",
    kelompok: kelompokPengeluaran(po.divisi),
    kategori: "Upah Kuli",
    subKategori: [po.proyek || po.namaCustomer || null, po.no].filter(Boolean).join(" \u2014 "),
    keterangan:
      `Otomatis dari PO ${po.no}` +
      (item?.uraian ? ` \u2014 ${item.uraian}` : "") +
      (p.noSuratJalan ? ` (SJ ${p.noSuratJalan})` : ""),
    qty: null,
    hargaSatuan: null,
    nominal: Number(p.upahKuli) || 0,
    tanggal: p.tanggal,
    sumber: `${PO_KULI_PREFIX}${p.id}`,
  };
}

export async function syncUpahKuliTx(po, item, p) {
  const sumber = `${PO_KULI_PREFIX}${p.id}`;
  const ada = await prisma.divisiTx.findFirst({ where: { sumber } });
  if (!(Number(p.upahKuli) > 0)) {
    if (ada) await prisma.divisiTx.delete({ where: { id: ada.id } });
    return;
  }
  const data = dataTx(po, item, p);
  if (ada) await prisma.divisiTx.update({ where: { id: ada.id }, data });
  else await prisma.divisiTx.create({ data });
}

export async function hapusUpahKuliTx(pengirimanIds) {
  const ids = Array.isArray(pengirimanIds) ? pengirimanIds : [pengirimanIds];
  if (!ids.length) return;
  await prisma.divisiTx.deleteMany({ where: { sumber: { in: ids.map((id) => `${PO_KULI_PREFIX}${id}`) } } });
}

// Dipakai kalau divisi / nomor / proyek PO diubah: sinkronkan ulang semua barisnya.
export async function syncSemuaUpahKuliPo(poId) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true, pengiriman: true } });
  if (!po) return;
  for (const p of po.pengiriman) await syncUpahKuliTx(po, po.items.find((i) => i.id === p.itemId), p);
}
