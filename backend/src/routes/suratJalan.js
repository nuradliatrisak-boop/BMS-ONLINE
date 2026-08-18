import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const list = await prisma.suratJalan.findMany({
      where: scopeDivisi(req),
      include: { armada: true },
      orderBy: { tanggal: "desc" },
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { no, divisi, armadaId, tujuan, tanggal, isDraft, detail } = req.body;
    if (!no || !divisi || !tujuan || !tanggal) {
      return res.status(400).json({ error: "No, divisi, tujuan, dan tanggal wajib diisi" });
    }
    const sj = await prisma.suratJalan.create({
      data: {
        no,
        divisi,
        armadaId: armadaId || null,
        tujuan,
        tanggal: new Date(tanggal),
        isDraft: !!isDraft,
        detail: detail || null,
      },
    });
    res.status(201).json(sj);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Nomor surat jalan sudah dipakai" });
    }
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { armadaId, tujuan, tanggal, isDraft, detail } = req.body;
    const sj = await prisma.suratJalan.update({
      where: { id: req.params.id },
      data: {
        armadaId: armadaId || null,
        tujuan,
        tanggal: tanggal ? new Date(tanggal) : undefined,
        isDraft,
        detail,
      },
    });
    res.json(sj);
  } catch (e) {
    next(e);
  }
});

// Tandai surat jalan sudah ditandatangani
router.patch("/:id/ttd", async (req, res, next) => {
  try {
    const sj = await prisma.suratJalan.update({
      where: { id: req.params.id },
      data: { statusTTD: "LENGKAP" },
    });
    res.json(sj);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.suratJalan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
