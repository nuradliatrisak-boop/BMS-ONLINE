import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

function generateNomorSuratJalan() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  return {
    prefix: `BMS-SJ-${year}${month}`,
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

  return `${prefix}-${String(nomorUrut).padStart(4, "0")}`;
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

router.get("/", async (req, res, next) => {
  try {
    const list = await prisma.suratJalan.findMany({
      where: scopeDivisi(req),
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

    // Tetap mempertahankan respons lama untuk pembuatan 1 Surat Jalan agar
    // integrasi yang sudah ada tidak berubah. Jika jumlah > 1, kirim semua SJ.
    res.status(201).json(jumlahSuratJalan === 1 ? hasil[0] : hasil);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const sj = await prisma.suratJalan.update({
      where: {
        id: req.params.id,
      },
      data: buildDataFields(req.body, { forCreate: false }),
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
