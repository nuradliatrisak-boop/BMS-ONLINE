import { Router } from "express";
import { randomUUID } from "crypto";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { buildSJWorkbook } from "../services/suratJalanXlsx.js";
import { DEFAULTS as PRINT_CALIB_DEFAULTS } from "./printCalib.js";

const router = Router();

// Nomor Surat Jalan dibuat PENDEK: "SJ-YYMM-XXX" (mis. "SJ-2609-001"),
// diganti dari format lama "BMS-SJ-YYYYMM-XXXX" yang lebih panjang.
// Urutan (XXX) reset tiap bulan, 3 digit cukup untuk >900 SJ/bulan.
function generateNomorSuratJalan() {
  const now = new Date();

  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");

  return {
    prefix: `SJ-${year}${month}`,
  };
}

async function createNomorSuratJalan() {
  const { prefix } = generateNomorSuratJalan();

  const last = await prisma.suratJalan.findFirst({
    where: {
      no: {
        startsWith: `${prefix}-`,
      },
    },
    orderBy: {
      no: "desc",
    },
    select: {
      no: true,
    },
  });

  let nomorUrut = 1;

  if (last?.no) {
    const match = last.no.match(/-(\d+)$/);

    if (match) {
      nomorUrut = Number(match[1]) + 1;
    }
  }

  return `${prefix}-${String(nomorUrut).padStart(3, "0")}`;
}

// Hitung M3 dari Panjang x Lebar x Tinggi (dibulatkan 3 desimal, ikut cara
// hitung di kertas fisik: mis. 3.58 x 1.75 x 0.82 = 5.137)
function hitungM3(p, l, t) {
  const nilai = Number(p || 0) * Number(l || 0) * Number(t || 0);
  return Math.round(nilai * 1000) / 1000;
}

// Field yang dipakai bersama saat create/update
function buildDataFields(body, { forCreate }) {
  const {
    armadaId,
    customerId,
    tujuan,
    penerima,
    jenisBarang,
    noPolisi,
    sopir,
    panjang,
    lebar,
    tinggi,
    tanggal,
    jam,
    isDraft,
    detail,
  } = body;

  const p = panjang ?? 0;
  const l = lebar ?? 0;
  const t = tinggi ?? 0;

  const data = {
    armadaId: armadaId || null,
    customerId: customerId || null,
    tujuan,
    penerima: penerima || null,
    jenisBarang: jenisBarang || null,
    noPolisi: noPolisi || null,
    sopir: sopir || null,
    panjang: Number(p) || 0,
    lebar: Number(l) || 0,
    tinggi: Number(t) || 0,
    m3: hitungM3(p, l, t),
    jam: jam || null,
    detail: detail ?? null,
  };

  if (tanggal) {
    data.tanggal = new Date(tanggal);
  } else if (forCreate) {
    data.tanggal = new Date();
  }

  if (typeof isDraft !== "undefined") {
    data.isDraft = !!isDraft;
  }

  return data;
}

const includeRelasi = {
  armada: true,
  customer: true,
};

// Kalau Penerima/Tujuan diketik manual, otomatis simpan ke master
// CustomerRecipient agar pada input berikutnya langsung muncul di dropdown.
async function simpanPenerimaManual(customerId, penerima, tujuan) {
  if (!customerId || !penerima?.trim() || !tujuan?.trim()) return;

  const nama = penerima.trim();
  const alamat = tujuan.trim();

  const existing = await prisma.customerRecipient.findFirst({
    where: { customerId, nama, alamat },
    select: { id: true },
  });

  if (!existing) {
    await prisma.customerRecipient.create({
      data: { customerId, nama, alamat },
    });
  }
}

router.get("/", async (req, res, next) => {
  try {
    const { search } = req.query;
    const keyword = String(search || "").trim();

    const where = {
      ...scopeDivisi(req),
      ...(keyword
        ? {
            OR: [
              { no: { contains: keyword, mode: "insensitive" } },
              { penerima: { contains: keyword, mode: "insensitive" } },
              { tujuan: { contains: keyword, mode: "insensitive" } },
              { jenisBarang: { contains: keyword, mode: "insensitive" } },
              { noPolisi: { contains: keyword, mode: "insensitive" } },
              { sopir: { contains: keyword, mode: "insensitive" } },
              { customer: { nama: { contains: keyword, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const list = await prisma.suratJalan.findMany({
      where,
      include: includeRelasi,
      orderBy: {
        tanggal: "desc",
      },
    });

    res.json(list);
  } catch (e) {
    next(e);
  }
});

// Daftar Surat Jalan milik seorang customer yang BELUM dipakai di invoice
// manapun (belum ada InvoiceItem yang menunjuk ke SJ ini). Dipakai di form
// "Buat Invoice Baru" supaya user tinggal centang, bukan ketik manual.
router.get("/belum-ditagih", async (req, res, next) => {
  try {
    const { customerId, divisi } = req.query;

    if (!customerId) {
      return res.status(400).json({ error: "customerId wajib diisi" });
    }

    const list = await prisma.suratJalan.findMany({
      where: {
        ...scopeDivisi(req),
        customerId,
        isDraft: false,
        invoiceItems: { none: {} },
        ...(divisi ? { divisi } : {}),
      },
      include: includeRelasi,
      orderBy: { tanggal: "asc" },
    });

    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const sj = await prisma.suratJalan.findUnique({
      where: { id: req.params.id },
      include: includeRelasi,
    });

    if (!sj) {
      return res.status(404).json({ error: "Surat jalan tidak ditemukan" });
    }

    res.json(sj);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { divisi, tujuan, tanggal } = req.body;

    if (!divisi || !tujuan || !tanggal) {
      return res.status(400).json({
        error: "Divisi, tujuan, dan tanggal wajib diisi",
      });
    }

    // Satu tujuan/customer bisa membutuhkan beberapa kendaraan. Data pengiriman
    // tetap sama, tetapi setiap Surat Jalan harus mempunyai nomor unik sendiri.
    const jumlahSuratJalan = Number(req.body.jumlahSuratJalan ?? 1);
    if (!Number.isInteger(jumlahSuratJalan) || jumlahSuratJalan < 1 || jumlahSuratJalan > 100) {
      return res.status(400).json({
        error: "Jumlah surat jalan harus berupa angka antara 1 sampai 100",
      });
    }

    const hasil = [];
    // Semua SJ yang dibuat dari satu aksi "2 kertas", "3 kertas", dst.
    // diberi ID kelompok yang sama. Nomornya tetap berbeda.
    const batchId = jumlahSuratJalan > 1 ? randomUUID() : null;

    for (let index = 0; index < jumlahSuratJalan; index++) {
      let sj;

      /*
       * Generate nomor otomatis untuk SETIAP dokumen.
       * Contoh: BMS-SJ-202608-0001, BMS-SJ-202608-0002, dst.
       */
      for (let attempt = 0; attempt < 5; attempt++) {
        const no = await createNomorSuratJalan();

        try {
          sj = await prisma.suratJalan.create({
            data: {
              no,
              divisi,
              batchId,
              ...buildDataFields(req.body, { forCreate: true }),
            },
            include: includeRelasi,
          });

          break;
        } catch (e) {
          // Hindari bentrok nomor jika ada pembuatan bersamaan.
          if (e.code === "P2002" && attempt < 4) continue;
          throw e;
        }
      }

      if (!sj) {
        return res.status(500).json({ error: "Gagal membuat nomor surat jalan" });
      }

      hasil.push(sj);
    }

    // Penerima/Tujuan manual otomatis masuk master CustomerRecipient.
    await simpanPenerimaManual(req.body.customerId, req.body.penerima, req.body.tujuan);

    // Tetap mempertahankan respons lama untuk pembuatan 1 Surat Jalan agar
    // integrasi yang sudah ada tidak berubah. Jika jumlah > 1, kirim semua SJ.
    res.status(201).json(jumlahSuratJalan === 1 ? hasil[0] : hasil);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await prisma.suratJalan.findUnique({
      where: { id: req.params.id },
      select: { id: true, batchId: true, customerId: true },
    });

    if (!current) {
      return res.status(404).json({ error: "Surat jalan tidak ditemukan" });
    }

    const data = buildDataFields(req.body, { forCreate: false });

    // Jika SJ ini berasal dari pembuatan beberapa kertas sekaligus,
    // perubahan P/L/T, M3, penerima, tujuan, armada, dll. diterapkan
    // ke seluruh anggota batch. Nomor SJ masing-masing tetap berbeda.
    const whereBatch = current.batchId
      ? { batchId: current.batchId }
      : { id: current.id };

    await prisma.suratJalan.updateMany({
      where: whereBatch,
      data,
    });

    await simpanPenerimaManual(
      req.body.customerId || current.customerId,
      req.body.penerima,
      req.body.tujuan
    );

    const sj = await prisma.suratJalan.findUnique({
      where: { id: req.params.id },
      include: includeRelasi,
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
      where: {
        id: req.params.id,
      },
      data: {
        statusTTD: "LENGKAP",
      },
      include: includeRelasi,
    });

    res.json(sj);
  } catch (e) {
    next(e);
  }
});

// ============================================================
// EXPORT BANYAK SURAT JALAN SEKALIGUS KE SATU FILE EXCEL (.xlsx)
// Dipakai kalau mau cetak beberapa SJ berurutan tanpa jeda (nomor SJ
// beda-beda, tapi harus nyambung di kertas continuous form). Semua SJ
// yang dipilih digabung jadi satu file (satu sheet = satu SJ), dan nanti
// waktu diprint, HARUS diprint sebagai satu file/workbook sekaligus
// (bukan sheet per sheet satu-satu) supaya printer tidak eject/motong
// kertas di antara tiap SJ - lihat PrintSJExcel.vbs yang sudah disesuaikan
// untuk ini.
// ============================================================
router.post("/export-xlsx-batch", async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      return res.status(400).json({ error: "Tidak ada surat jalan yang dipilih" });
    }

    const list = await prisma.suratJalan.findMany({
      where: { id: { in: ids } },
      include: includeRelasi,
    });
    if (!list.length) {
      return res.status(404).json({ error: "Surat jalan tidak ditemukan" });
    }

    // urutkan sesuai urutan ids yang dikirim frontend (biasanya = urutan
    // dipilih/urutan tabel), bukan urutan hasil query database
    const byId = new Map(list.map((sj) => [sj.id, sj]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

    const [calibRow, settingRows] = await Promise.all([
      prisma.printCalib.findUnique({ where: { jenis: "sj" } }),
      prisma.setting.findMany(),
    ]);

    const calib = {
      ...PRINT_CALIB_DEFAULTS.sj,
      ...(calibRow?.data || {}),
      fields: { ...PRINT_CALIB_DEFAULTS.sj.fields, ...(calibRow?.data?.fields || {}) },
    };
    const signerName = settingRows.find((s) => s.key === "signerName")?.value || "";

    const wb = await buildSJWorkbook(ordered, calib, signerName);

    const today = new Date().toISOString().slice(0, 10);
    const filename = `SJ-Batch-${today}-${ordered.length}dok.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

// ============================================================
// EXPORT SURAT JALAN KE EXCEL (.xlsx)
// Dipakai buat cetak lewat Excel (Page Setup tersimpan di file, print
// lewat driver langsung) daripada lewat dialog print browser yang
// settingnya suka balik ke default tiap kali print dan bikin hasil
// geser-geser walau sudah dikalibrasi. Posisi field yang dipakai PERSIS
// sama dengan kalibrasi tersimpan di menu "Kalibrasi Cetak > Surat
// Jalan" - jadi kalau kalibrasi itu diubah, hasil Excel ini otomatis
// ikut menyesuaikan.
// ============================================================
router.get("/:id/export-xlsx", async (req, res, next) => {
  try {
    const sj = await prisma.suratJalan.findUnique({
      where: { id: req.params.id },
      include: includeRelasi,
    });

    if (!sj) {
      return res.status(404).json({ error: "Surat jalan tidak ditemukan" });
    }

    const [calibRow, settingRows] = await Promise.all([
      prisma.printCalib.findUnique({ where: { jenis: "sj" } }),
      prisma.setting.findMany(),
    ]);

    const calib = {
      ...PRINT_CALIB_DEFAULTS.sj,
      ...(calibRow?.data || {}),
      fields: { ...PRINT_CALIB_DEFAULTS.sj.fields, ...(calibRow?.data?.fields || {}) },
    };
    const signerName = settingRows.find((s) => s.key === "signerName")?.value || "";

    const wb = await buildSJWorkbook(sj, calib, signerName);

    const filename = `SJ-${(sj.no || "surat-jalan").replace(/[^a-zA-Z0-9-]/g, "_")}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.suratJalan.delete({
      where: {
        id: req.params.id,
      },
    });

    res.status(204).end();
  } catch (e) {
    if (e.code === "P2003" || e.code === "P2014") {
      return res.status(409).json({
        error:
          "Surat jalan ini sudah dipakai di sebuah Invoice, jadi tidak bisa dihapus. Hapus dulu baris item-nya di invoice terkait.",
      });
    }

    next(e);
  }
});

export default router;
