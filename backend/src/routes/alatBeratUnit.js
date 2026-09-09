import { Router } from "express";
import prisma from "../prismaClient.js";
import { buildDefaultDokumenData } from "../config/dokumenConfig.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const where = req.query.all ? {} : { aktif: true };
    const list = await prisma.alatBeratUnit.findMany({ where, orderBy: { nama: "asc" } });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { nama, jenis, divisi } = req.body;
    if (!nama) return res.status(400).json({ error: "Nama unit wajib diisi" });

    const unit = await prisma.alatBeratUnit.create({
      data: {
        nama: String(nama).trim(),
        jenis: jenis || null,
        divisi: divisi || "Alat Berat",
      },
    });

    // Bikinin baris dokumen kelengkapan wajib (kosong dulu): Invoice, SIA, SIO, Foto Excavator.
    await prisma.dokumen.createMany({
      data: buildDefaultDokumenData("ALAT_BERAT", unit.id),
    });

    res.status(201).json(unit);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nama, jenis, divisi, aktif } = req.body;
    const unit = await prisma.alatBeratUnit.update({
      where: { id: req.params.id },
      data: {
        nama: nama !== undefined ? String(nama).trim() : undefined,
        jenis: jenis !== undefined ? jenis || null : undefined,
        divisi: divisi || undefined,
        ...(typeof aktif === "boolean" ? { aktif } : {}),
      },
    });
    res.json(unit);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.dokumen.deleteMany({ where: { asetTipe: "ALAT_BERAT", asetId: req.params.id } });
    await prisma.alatBeratUnit.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
