import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

// Laporan INTERNAL: penjualan, potongan (belanja pasir, uang mobil, uang jalan,
// komisi, uang makan), dan hasil bersih (Net) per divisi & per invoice.
// Sengaja halaman/endpoint terpisah dari Rekap Penjualan supaya angka Net tidak
// pernah ikut tercetak di rekapan yang dikirim ke customer.
const router = Router();

const POS = ["belanjaPasir", "uangMobil", "uangJalan", "uangKomisi", "uangMakan"];
const n = (v) => Number(v || 0);

router.get("/", async (req, res, next) => {
  try {
    const { bulan, divisi } = req.query;
    const where = { ...scopeDivisi(req), ...(divisi ? { divisi } : {}) };
    if (bulan) {
      const [y, m] = String(bulan).split("-").map(Number);
      if (y && m) where.tanggal = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: { customer: { select: { nama: true } }, items: true },
      orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    });

    const kosong = () => ({
      jumlahInvoice: 0,
      penjualan: 0,
      belanjaPasir: 0,
      uangMobil: 0,
      uangJalan: 0,
      uangKomisi: 0,
      uangMakan: 0,
      potongan: 0,
      net: 0,
    });
    const perDivisi = new Map();
    const total = kosong();
    const rows = [];

    for (const inv of invoices) {
      const r = kosong();
      r.jumlahInvoice = 1;
      for (const it of inv.items) {
        r.penjualan += n(it.qty) * n(it.hargaSatuan);
        for (const k of POS) r[k] += n(it[k]);
      }
      r.potongan = POS.reduce((s, k) => s + r[k], 0);
      r.net = r.penjualan - r.potongan;

      const d = inv.divisi || "-";
      if (!perDivisi.has(d)) perDivisi.set(d, kosong());
      const acc = perDivisi.get(d);
      for (const k of Object.keys(r)) {
        acc[k] += r[k];
        total[k] += r[k];
      }
      rows.push({
        id: inv.id,
        no: inv.no,
        tanggal: inv.tanggal,
        divisi: d,
        customer: inv.customer?.nama || "",
        ...r,
      });
    }

    res.json({
      perDivisi: [...perDivisi.entries()].map(([d, v]) => ({ divisi: d, ...v })),
      total,
      rows: rows.reverse(),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
