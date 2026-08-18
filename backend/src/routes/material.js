import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const material = await prisma.material.findMany({
      where: scopeDivisi(req),
      orderBy: { nama: "asc" },
    });
    res.json(material);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { nama, satuan, hargaSatuan, divisi } = req.body;
    if (!nama || !satuan || !divisi) {
      return res.status(400).json({ error: "Nama, satuan, dan divisi wajib diisi" });
    }
    const material = await prisma.material.create({
      data: { nama, satuan, hargaSatuan: Number(hargaSatuan) || 0, divisi },
    });
    res.status(201).json(material);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nama, satuan, hargaSatuan, divisi } = req.body;
    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: { nama, satuan, hargaSatuan: Number(hargaSatuan) || 0, divisi },
    });
    res.json(material);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.material.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
