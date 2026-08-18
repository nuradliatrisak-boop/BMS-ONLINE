import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { bulan } = req.query; // format "YYYY-MM", opsional
    const where = scopeDivisi(req);
    const list = await prisma.divisiTx.findMany({
      where,
      orderBy: { tanggal: "desc" },
    });
    const filtered = bulan
      ? list.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan)
      : list;
    res.json(filtered);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { divisi, tipe, keterangan, nominal, tanggal } = req.body;
    if (!divisi || !tipe || !keterangan || !nominal || !tanggal) {
      return res.status(400).json({ error: "Semua field wajib diisi" });
    }
    const tx = await prisma.divisiTx.create({
      data: {
        divisi,
        tipe: tipe.toUpperCase(),
        keterangan,
        nominal: Number(nominal),
        tanggal: new Date(tanggal),
      },
    });
    res.status(201).json(tx);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.divisiTx.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Ringkasan laba rugi per divisi per bulan (menggabungkan invoice + transaksi manual)
router.get("/laporan/:divisi/:bulan", async (req, res, next) => {
  try {
    const { divisi, bulan } = req.params; // bulan = "YYYY-MM"

    const invoices = await prisma.invoice.findMany({
      where: { divisi },
      include: { items: true },
    });
    const penjualanInvoice = invoices
      .filter((i) => i.tanggal.toISOString().slice(0, 7) === bulan)
      .reduce((s, i) => s + i.items.reduce((a, it) => a + it.qty * it.hargaSatuan, 0), 0);

    const tx = await prisma.divisiTx.findMany({ where: { divisi } });
    const txBulanIni = tx.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan);
    const penjualanManual = txBulanIni
      .filter((t) => t.tipe === "PENJUALAN")
      .reduce((s, t) => s + t.nominal, 0);
    const pengeluaran = txBulanIni
      .filter((t) => t.tipe === "PENGELUARAN")
      .reduce((s, t) => s + t.nominal, 0);

    const totalPenjualan = penjualanInvoice + penjualanManual;

    res.json({
      divisi,
      bulan,
      penjualan: totalPenjualan,
      pengeluaran,
      laba: totalPenjualan - pengeluaran,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
