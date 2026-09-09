import { Router } from "express";
import fs from "fs";
import path from "path";
import prisma from "../prismaClient.js";
import { uploadDokumen, UPLOAD_DIR } from "../middleware/upload.js";

const router = Router();

const ASET_TIPE_VALID = ["MOBIL", "KAPAL", "ALAT_BERAT"];

function serialize(d) {
  return {
    ...d,
    fileUrl: d.file ? `/uploads/dokumen/${d.file}` : null,
  };
}

function hapusFileDisk(filename) {
  if (!filename) return;
  const p = path.join(UPLOAD_DIR, "dokumen", filename);
  fs.unlink(p, () => {});
}

// GET /api/dokumen?asetTipe=MOBIL&asetId=xxx
// Daftar dokumen kelengkapan milik satu aset (dipakai di panel dokumen
// Armada/Kapal/AlatBeratUnit). Baris "wajib" ditampilkan lebih dulu.
router.get("/", async (req, res, next) => {
  try {
    const { asetTipe, asetId } = req.query;
    if (!asetTipe || !asetId) {
      return res.status(400).json({ error: "asetTipe dan asetId wajib diisi" });
    }
    if (!ASET_TIPE_VALID.includes(asetTipe)) {
      return res.status(400).json({ error: "asetTipe tidak valid" });
    }
    const list = await prisma.dokumen.findMany({
      where: { asetTipe, asetId },
      orderBy: [{ wajib: "desc" }, { createdAt: "asc" }],
    });
    res.json(list.map(serialize));
  } catch (e) {
    next(e);
  }
});

// POST /api/dokumen  (multipart/form-data, field "file" opsional)
// Dipakai untuk "+ Tambah Dokumen" (kolom opsional/custom milik user).
router.post("/", uploadDokumen.single("file"), async (req, res, next) => {
  try {
    const { asetTipe, asetId, label, nilai, berlakuSampai, catatan } = req.body;
    if (!asetTipe || !asetId || !label) {
      return res.status(400).json({ error: "asetTipe, asetId, dan label wajib diisi" });
    }
    if (!ASET_TIPE_VALID.includes(asetTipe)) {
      return res.status(400).json({ error: "asetTipe tidak valid" });
    }
    const dok = await prisma.dokumen.create({
      data: {
        asetTipe,
        asetId,
        label: String(label).trim(),
        nilai: nilai || null,
        berlakuSampai: berlakuSampai ? new Date(berlakuSampai) : null,
        catatan: catatan || null,
        wajib: false,
        file: req.file ? req.file.filename : null,
        fileNama: req.file ? req.file.originalname : null,
      },
    });
    res.status(201).json(serialize(dok));
  } catch (e) {
    next(e);
  }
});

// PUT /api/dokumen/:id  (multipart juga -- dipakai buat isi/ganti file dan/atau
// isian teks/tanggal berlaku/catatan pada baris dokumen yang sudah ada,
// termasuk baris "wajib" bawaan seperti STNK/KIR/dst)
router.put("/:id", uploadDokumen.single("file"), async (req, res, next) => {
  try {
    const current = await prisma.dokumen.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Dokumen tidak ditemukan" });

    const { label, nilai, berlakuSampai, catatan, hapusFile } = req.body;

    let file = current.file;
    let fileNama = current.fileNama;

    if (req.file) {
      hapusFileDisk(current.file);
      file = req.file.filename;
      fileNama = req.file.originalname;
    } else if (String(hapusFile) === "true") {
      hapusFileDisk(current.file);
      file = null;
      fileNama = null;
    }

    const dok = await prisma.dokumen.update({
      where: { id: req.params.id },
      data: {
        label: label !== undefined && label !== "" ? String(label).trim() : current.label,
        nilai: nilai !== undefined ? nilai || null : current.nilai,
        berlakuSampai: berlakuSampai !== undefined ? (berlakuSampai ? new Date(berlakuSampai) : null) : current.berlakuSampai,
        catatan: catatan !== undefined ? catatan || null : current.catatan,
        file,
        fileNama,
      },
    });
    res.json(serialize(dok));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await prisma.dokumen.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Dokumen tidak ditemukan" });
    await prisma.dokumen.delete({ where: { id: req.params.id } });
    hapusFileDisk(current.file);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
