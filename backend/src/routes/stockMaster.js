import { Router } from "express";
import prisma from "../prismaClient.js";

const router = Router();

// GET /api/stock-master            -> hanya yang aktif (dipakai buat dropdown)
// GET /api/stock-master?all=1      -> termasuk yang nonaktif (dipakai buat halaman kelola)
router.get("/", async (req, res, next) => {
  try {
    const where = req.query.all ? {} : { aktif: true };
    const list = await prisma.stockMaster.findMany({
      where,
      orderBy: { kode: "asc" },
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { kode, nama } = req.body;
    if (!kode || !nama) {
      return res.status(400).json({ error: "Kode dan nama stock wajib diisi" });
    }
    const item = await prisma.stockMaster.create({
      data: { kode: kode.trim().toUpperCase(), nama: nama.trim().toUpperCase() },
    });
    res.status(201).json(item);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Kode stock ini sudah ada di daftar" });
    }
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { kode, nama, aktif } = req.body;
    const item = await prisma.stockMaster.update({
      where: { id: req.params.id },
      data: {
        kode: kode?.trim().toUpperCase(),
        nama: nama?.trim().toUpperCase(),
        ...(typeof aktif === "boolean" ? { aktif } : {}),
      },
    });
    res.json(item);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Kode stock ini sudah ada di daftar" });
    }
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.stockMaster.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;