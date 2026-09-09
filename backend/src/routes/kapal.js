import { Router } from "express";
import prisma from "../prismaClient.js";
import { buildDefaultDokumenData } from "../config/dokumenConfig.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const where = req.query.all ? {} : { aktif: true };
    const list = await prisma.kapal.findMany({ where, orderBy: { nama: "asc" } });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { nama, noLambung, divisi } = req.body;
    if (!nama) return res.status(400).json({ error: "Nama kapal wajib diisi" });

    const kapal = await prisma.kapal.create({
      data: {
        nama: String(nama).trim(),
        noLambung: noLambung || null,
        divisi: divisi || "Kapal",
      },
    });

    // Bikinin baris dokumen kelengkapan wajib (kosong dulu): Gross Akte,
    // Sertifikat Keselamatan, Pas Besar, Buku Pulau, Foto Kapal.
    await prisma.dokumen.createMany({
      data: buildDefaultDokumenData("KAPAL", kapal.id),
    });

    res.status(201).json(kapal);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nama, noLambung, divisi, aktif } = req.body;
    const kapal = await prisma.kapal.update({
      where: { id: req.params.id },
      data: {
        nama: nama !== undefined ? String(nama).trim() : undefined,
        noLambung: noLambung !== undefined ? noLambung || null : undefined,
        divisi: divisi || undefined,
        ...(typeof aktif === "boolean" ? { aktif } : {}),
      },
    });
    res.json(kapal);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    // Dokumen kelengkapan kapal ini bukan foreign key (relasi polimorfik),
    // jadi harus dihapus manual bareng kapalnya supaya tidak jadi sampah.
    await prisma.dokumen.deleteMany({ where: { asetTipe: "KAPAL", asetId: req.params.id } });
    await prisma.kapal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
