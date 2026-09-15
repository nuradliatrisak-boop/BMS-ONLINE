import { Router } from "express";
import fs from "fs";
import path from "path";
import prisma from "../prismaClient.js";
import { uploadDokumen, UPLOAD_DIR } from "../middleware/upload.js";
import { uploadBufferToDrive, deleteFromDrive } from "../services/googleDrive.js";

const router = Router();

const ASET_TIPE_VALID = ["MOBIL", "KAPAL", "ALAT_BERAT"];

function serialize(d) {
  return {
    ...d,
    // Upload BARU -> link Google Drive (driveViewUrl, URL absolut).
    // Dokumen LAMA (sebelum pindah ke Drive) -> masih fallback ke file lokal
    // legacy di /uploads/dokumen/... biar tetap bisa dibuka.
    fileUrl: d.driveViewUrl || (d.file ? `/uploads/dokumen/${d.file}` : null),
  };
}

// LEGACY: cuma dipakai buat bersih-bersih file lokal lama (upload sebelum
// pindah ke Drive). Upload baru sudah tidak pernah nulis ke sini lagi.
function hapusFileLokalLegacy(filename) {
  if (!filename) return;
  const p = path.join(UPLOAD_DIR, "dokumen", filename);
  fs.unlink(p, () => {});
}

// Upload buffer (dari multer memoryStorage) ke Google Drive, dan hapus file
// Drive yang lama (kalau ada) supaya tidak numpuk. Dipakai bareng di POST &
// PUT supaya tidak dobel logic.
async function gantiFileDrive(current, file) {
  const hasil = await uploadBufferToDrive(file.buffer, file.originalname, file.mimetype);
  if (current?.driveFileId) await deleteFromDrive(current.driveFileId);
  if (current?.file) hapusFileLokalLegacy(current.file); // bersihin sisa file lokal legacy juga kalau ada
  return {
    driveFileId: hasil.id,
    driveViewUrl: hasil.viewUrl,
    fileNama: file.originalname,
    file: null, // upload baru tidak lagi pakai kolom file lokal
  };
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
// Kalau ada file, langsung diupload ke Google Drive di sini (bukan disimpan
// ke disk server).
router.post("/", uploadDokumen.single("file"), async (req, res, next) => {
  try {
    const { asetTipe, asetId, label, nilai, berlakuSampai, catatan, butuhFile } = req.body;
    if (!asetTipe || !asetId || !label) {
      return res.status(400).json({ error: "asetTipe, asetId, dan label wajib diisi" });
    }
    if (!ASET_TIPE_VALID.includes(asetTipe)) {
      return res.status(400).json({ error: "asetTipe tidak valid" });
    }
    // butuhFile dikirim dari form "+ Tambah Dokumen" ("true"/"false" string
    // karena lewat multipart/form-data). Default true kalau tidak dikirim.
    const perluFile = butuhFile === undefined ? true : String(butuhFile) === "true";

    let fileData = { driveFileId: null, driveViewUrl: null, file: null, fileNama: null };
    if (perluFile && req.file) {
      fileData = await gantiFileDrive(null, req.file);
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
        butuhFile: perluFile,
        ...fileData,
      },
    });
    res.status(201).json(serialize(dok));
  } catch (e) {
    next(e);
  }
});

// PUT /api/dokumen/:id  (multipart juga -- dipakai buat isi/ganti file dan/atau
// isian teks/tanggal berlaku/catatan pada baris dokumen yang sudah ada,
// termasuk baris "wajib" bawaan seperti STNK/KIR/dst). File baru diupload ke
// Google Drive, file/link Drive yang lama otomatis dihapus supaya tidak dobel.
router.put("/:id", uploadDokumen.single("file"), async (req, res, next) => {
  try {
    const current = await prisma.dokumen.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Dokumen tidak ditemukan" });

    const { label, nilai, berlakuSampai, catatan, hapusFile, butuhFile } = req.body;

    // butuhFile boleh diubah belakangan (mis. baris custom yang tadinya
    // "cukup isian teks" diganti jadi "perlu upload file", atau sebaliknya).
    const perluFile = butuhFile !== undefined ? String(butuhFile) === "true" : current.butuhFile;

    let fileData = {
      file: current.file,
      fileNama: current.fileNama,
      driveFileId: current.driveFileId,
      driveViewUrl: current.driveViewUrl,
    };

    if (!perluFile) {
      // Baris diubah jadi "cukup isian teks" -- file lama (Drive maupun
      // legacy lokal, kalau ada) dihapus juga supaya konsisten, kolom
      // upload tidak akan ditampilkan lagi untuk baris ini.
      if (current.driveFileId) await deleteFromDrive(current.driveFileId);
      if (current.file) hapusFileLokalLegacy(current.file);
      fileData = { file: null, fileNama: null, driveFileId: null, driveViewUrl: null };
    } else if (req.file) {
      fileData = { ...fileData, ...(await gantiFileDrive(current, req.file)) };
    } else if (String(hapusFile) === "true") {
      if (current.driveFileId) await deleteFromDrive(current.driveFileId);
      if (current.file) hapusFileLokalLegacy(current.file);
      fileData = { file: null, fileNama: null, driveFileId: null, driveViewUrl: null };
    }

    const dok = await prisma.dokumen.update({
      where: { id: req.params.id },
      data: {
        label: label !== undefined && label !== "" ? String(label).trim() : current.label,
        nilai: nilai !== undefined ? nilai || null : current.nilai,
        berlakuSampai: berlakuSampai !== undefined ? (berlakuSampai ? new Date(berlakuSampai) : null) : current.berlakuSampai,
        catatan: catatan !== undefined ? catatan || null : current.catatan,
        butuhFile: perluFile,
        ...fileData,
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
    if (current.driveFileId) await deleteFromDrive(current.driveFileId);
    if (current.file) hapusFileLokalLegacy(current.file);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
