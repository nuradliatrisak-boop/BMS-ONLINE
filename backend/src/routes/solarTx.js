import { Router } from "express";
import fs from "fs";
import path from "path";
import prisma from "../prismaClient.js";
import { uploadBukti, UPLOAD_DIR } from "../middleware/upload.js";

const router = Router();

// ------------------------------------------------------------
// Nomor otomatis PENDEK: "SM-YYMMDD-XX" (Masuk) / "SK-YYMMDD-XX" (Keluar).
// XX = urutan ke berapa di tanggal itu (reset tiap hari, cukup 2 digit
// karena dalam praktiknya tidak akan sampai 99 transaksi/hari/tipe).
// Sengaja jauh lebih pendek dari nomor Surat Jalan (BMS-SJ-YYYYMM-XXXX)
// karena ini cuma catatan internal stok, bukan dokumen yang diberikan ke
// pihak luar.
// ------------------------------------------------------------
function two(n) {
  return String(n).padStart(2, "0");
}

async function generateNoSolar(tipe, tanggal) {
  const d = new Date(tanggal);
  const yy = two(d.getFullYear() % 100);
  const mm = two(d.getMonth() + 1);
  const dd = two(d.getDate());
  const prefix = `${tipe === "MASUK" ? "SM" : "SK"}-${yy}${mm}${dd}`;

  const last = await prisma.solarTx.findFirst({
    where: { no: { startsWith: `${prefix}-` } },
    orderBy: { no: "desc" },
    select: { no: true },
  });
  let urut = 1;
  if (last?.no) {
    const m = last.no.match(/-(\d+)$/);
    if (m) urut = Number(m[1]) + 1;
  }
  return `${prefix}-${two(urut)}`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function serialize(tx) {
  return {
    ...tx,
    buktiUrl: tx.buktiFile ? `/uploads/solar/${tx.buktiFile}` : null,
  };
}

// GET /api/solar-tx?bulan=YYYY-MM              -> filter satu bulan
// GET /api/solar-tx?dari=YYYY-MM-DD&sampai=YYYY-MM-DD -> filter rentang tanggal (inklusif)
// GET /api/solar-tx                             -> semua waktu (tanpa filter)
router.get("/", async (req, res, next) => {
  try {
    const { bulan, dari, sampai } = req.query;
    const list = await prisma.solarTx.findMany({ orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }] });

    let filtered = list;
    if (bulan) {
      filtered = list.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan);
    } else if (dari || sampai) {
      const dariMs = dari ? new Date(dari + "T00:00:00").getTime() : -Infinity;
      const sampaiMs = sampai ? new Date(sampai + "T23:59:59.999").getTime() : Infinity;
      filtered = list.filter((t) => {
        const ms = new Date(t.tanggal).getTime();
        return ms >= dariMs && ms <= sampaiMs;
      });
    }

    const totalMasuk = filtered.filter((t) => t.tipe === "MASUK").reduce((s, t) => s + t.liter, 0);
    const totalKeluar = filtered.filter((t) => t.tipe === "KELUAR").reduce((s, t) => s + t.liter, 0);

    // Saldo berjalan dihitung dari SELURUH data (tidak dibatasi filter bulan),
    // supaya "sisa stok saat ini" selalu akurat walau sedang lihat bulan lama.
    const totalMasukSemua = list.filter((t) => t.tipe === "MASUK").reduce((s, t) => s + t.liter, 0);
    const totalKeluarSemua = list.filter((t) => t.tipe === "KELUAR").reduce((s, t) => s + t.liter, 0);

    res.json({
      items: filtered.map(serialize),
      totalMasuk,
      totalKeluar,
      saldoBulan: totalMasuk - totalKeluar,
      saldoSaatIni: totalMasukSemua - totalKeluarSemua,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-tx  (multipart/form-data, field "bukti" opsional untuk file)
router.post("/", uploadBukti.single("bukti"), async (req, res, next) => {
  try {
    const { tipe, tanggal, nama, liter, lokasi, keterangan } = req.body;

    if (!tipe || !["MASUK", "KELUAR"].includes(String(tipe).toUpperCase())) {
      return res.status(400).json({ error: "Tipe wajib diisi (MASUK/KELUAR)" });
    }
    if (!tanggal || !nama || liter === undefined || liter === "") {
      return res.status(400).json({ error: "Tanggal, nama, dan jumlah liter wajib diisi" });
    }
    const literNum = toNum(liter);
    if (literNum <= 0) {
      return res.status(400).json({ error: "Jumlah liter harus lebih dari 0" });
    }

    const tipeUp = String(tipe).toUpperCase();
    const no = await generateNoSolar(tipeUp, tanggal);

    const tx = await prisma.solarTx.create({
      data: {
        no,
        tipe: tipeUp,
        tanggal: new Date(tanggal),
        nama: String(nama).trim(),
        liter: literNum,
        lokasi: tipeUp === "KELUAR" ? lokasi || null : null,
        keterangan: keterangan || null,
        buktiFile: req.file ? req.file.filename : null,
        buktiNama: req.file ? req.file.originalname : null,
      },
    });
    res.status(201).json(serialize(tx));
  } catch (e) {
    next(e);
  }
});

// PUT /api/solar-tx/:id (multipart juga, supaya bisa ganti/tambah bukti saat edit)
router.put("/:id", uploadBukti.single("bukti"), async (req, res, next) => {
  try {
    const current = await prisma.solarTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });

    const { tanggal, nama, liter, lokasi, keterangan, hapusBukti } = req.body;
    if (!tanggal || !nama || liter === undefined || liter === "") {
      return res.status(400).json({ error: "Tanggal, nama, dan jumlah liter wajib diisi" });
    }
    const literNum = toNum(liter);
    if (literNum <= 0) {
      return res.status(400).json({ error: "Jumlah liter harus lebih dari 0" });
    }

    let buktiFile = current.buktiFile;
    let buktiNama = current.buktiNama;

    // Ganti/upload bukti baru -> hapus file lama dari disk
    if (req.file) {
      if (current.buktiFile) {
        const old = path.join(UPLOAD_DIR, "solar", current.buktiFile);
        fs.unlink(old, () => {});
      }
      buktiFile = req.file.filename;
      buktiNama = req.file.originalname;
    } else if (String(hapusBukti) === "true") {
      if (current.buktiFile) {
        const old = path.join(UPLOAD_DIR, "solar", current.buktiFile);
        fs.unlink(old, () => {});
      }
      buktiFile = null;
      buktiNama = null;
    }

    const tx = await prisma.solarTx.update({
      where: { id: req.params.id },
      data: {
        tanggal: new Date(tanggal),
        nama: String(nama).trim(),
        liter: literNum,
        lokasi: current.tipe === "KELUAR" ? lokasi || null : null,
        keterangan: keterangan || null,
        buktiFile,
        buktiNama,
      },
    });
    res.json(serialize(tx));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await prisma.solarTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });
    await prisma.solarTx.delete({ where: { id: req.params.id } });
    if (current.buktiFile) {
      const old = path.join(UPLOAD_DIR, "solar", current.buktiFile);
      fs.unlink(old, () => {});
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
