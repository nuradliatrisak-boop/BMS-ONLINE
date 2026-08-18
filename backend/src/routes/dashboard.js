import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const where = scopeDivisi(req);

    const invoices = await prisma.invoice.findMany({
      where,
      include: { items: true, pembayaran: true },
    });

    const totalTagihan = invoices.reduce(
      (s, i) => s + i.items.reduce((a, it) => a + it.qty * it.hargaSatuan, 0),
      0
    );
    const totalDibayar = invoices.reduce(
      (s, i) => s + i.pembayaran.reduce((a, p) => a + p.nominal, 0),
      0
    );
    const belumLunas = invoices.filter((i) => i.status !== "LUNAS").length;

    const suratJalanDraft = await prisma.suratJalan.count({
      where: { ...where, isDraft: true },
    });
    const suratJalanBelumTTD = await prisma.suratJalan.count({
      where: { ...where, statusTTD: "BELUM_TTD" },
    });

    res.json({
      totalInvoice: invoices.length,
      totalTagihan,
      totalDibayar,
      sisaPiutang: totalTagihan - totalDibayar,
      invoiceBelumLunas: belumLunas,
      suratJalanDraft,
      suratJalanBelumTTD,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
