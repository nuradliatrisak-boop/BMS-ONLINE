import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

// Ringkasan angka untuk halaman Dashboard.
// Selain angka lama (total invoice/tagihan/piutang/surat jalan), sekarang
// ditambah statistik yang diminta: piutang per customer, pemakaian alat per
// kategori (Bucket/Breker/Mobilisasi), tren tagihan vs pembayaran per bulan,
// dan pengeluaran uang makan operator (yang sengaja TIDAK ditagih ke customer).
router.get("/", async (req, res, next) => {
  try {
    const where = scopeDivisi(req);

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        items: true,
        pembayaran: true,
        customer: { select: { id: true, nama: true } },
      },
    });

    const nilaiItem = (it) => Number(it.qty) * Number(it.hargaSatuan);

    let totalTagihan = 0;
    let totalDibayar = 0;
    const perCustomer = new Map();
    const perKategoriAlat = new Map();
    const perBulan = new Map();

    for (const inv of invoices) {
      const tagihan = inv.items.reduce((s, it) => s + nilaiItem(it), 0);
      const dibayar = inv.pembayaran.reduce((s, p) => s + Number(p.nominal), 0);
      totalTagihan += tagihan;
      totalDibayar += dibayar;

      const nama = inv.customer?.nama || "(tanpa customer)";
      const c = perCustomer.get(nama) || {
        customerId: inv.customer?.id || null,
        nama,
        tagihan: 0,
        dibayar: 0,
        jumlahInvoice: 0,
      };
      c.tagihan += tagihan;
      c.dibayar += dibayar;
      c.jumlahInvoice += 1;
      perCustomer.set(nama, c);

      for (const it of inv.items) {
        if (!it.kategoriAlat) continue;
        const k = perKategoriAlat.get(it.kategoriAlat) || {
          kategori: it.kategoriAlat,
          nilai: 0,
          jam: 0,
        };
        k.nilai += nilaiItem(it);
        if (it.satuan === "jam") k.jam += Number(it.qty);
        perKategoriAlat.set(it.kategoriAlat, k);
      }

      const bk = `${inv.tanggal.getFullYear()}-${String(inv.tanggal.getMonth() + 1).padStart(2, "0")}`;
      const b = perBulan.get(bk) || { bulan: bk, tagihan: 0, dibayar: 0 };
      b.tagihan += tagihan;
      perBulan.set(bk, b);

      for (const p of inv.pembayaran) {
        const pk = `${p.tanggal.getFullYear()}-${String(p.tanggal.getMonth() + 1).padStart(2, "0")}`;
        const pb = perBulan.get(pk) || { bulan: pk, tagihan: 0, dibayar: 0 };
        pb.dibayar += Number(p.nominal);
        perBulan.set(pk, pb);
      }
    }

    const belumLunas = invoices.filter((i) => i.status !== "LUNAS").length;

    const suratJalanDraft = await prisma.suratJalan.count({
      where: { ...where, isDraft: true },
    });
    const suratJalanBelumTTD = await prisma.suratJalan.count({
      where: { ...where, statusTTD: "BELUM_TTD" },
    });

    // Uang makan operator = pengeluaran internal, bukan tagihan ke customer.
    // Ditampilkan terpisah supaya jelas kenapa dia tidak menambah omzet.
    const uangMakan = await prisma.divisiTx.aggregate({
      where: { ...where, kelompok: "Uang Makan Operator" },
      _sum: { nominal: true },
      _count: true,
    });

    const topCustomer = [...perCustomer.values()]
      .map((c) => ({ ...c, sisa: c.tagihan - c.dibayar }))
      .sort((a, b) => b.sisa - a.sisa)
      .slice(0, 10);

    res.json({
      totalInvoice: invoices.length,
      totalTagihan,
      totalDibayar,
      sisaPiutang: totalTagihan - totalDibayar,
      invoiceBelumLunas: belumLunas,
      suratJalanDraft,
      suratJalanBelumTTD,
      // --- statistik tambahan ---
      topCustomer,
      perKategoriAlat: [...perKategoriAlat.values()].sort((a, b) => b.nilai - a.nilai),
      perBulan: [...perBulan.values()].sort((a, b) => a.bulan.localeCompare(b.bulan)).slice(-12),
      uangMakanOperator: {
        total: uangMakan._sum.nominal || 0,
        jumlahTransaksi: uangMakan._count || 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
