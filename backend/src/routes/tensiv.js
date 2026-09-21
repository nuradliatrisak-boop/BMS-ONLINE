// TENSIV -- "DAFTAR KERJA HARIAN" ALAT BERAT
// ============================================
// Rekaman jam kerja 1 unit alat berat pada 1 hari (sumbernya kertas fisik
// "DAFTAR KERJA HARIAN" yang ditandatangani Pengawas & Operator/Supir).
// Dibuat terpisah dari Invoice -- sama pola dengan Surat Jalan: staf isi
// tiap hari, baru nanti ditarik jadi 1 baris InvoiceItem pas bikin tagihan
// sewa alat berat (lihat GET /belum-ditagih & InvoiceItem.tensivId).
//
// Endpoint:
//   GET    /api/tensiv                 -> daftar (filter ?search=)
//   GET    /api/tensiv/belum-ditagih   -> punya customer tsb yang belum jadi baris invoice
//   GET    /api/tensiv/:id
//   POST   /api/tensiv
//   PUT    /api/tensiv/:id
//   PATCH  /api/tensiv/:id/ttd         -> tandai lengkap ditandatangani
//   DELETE /api/tensiv/:id

import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

function generatePrefix() {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `TS-${year}${month}`;
}

async function createNomorTensiv() {
  const prefix = generatePrefix();
  const last = await prisma.tensiv.findFirst({
    where: { no: { startsWith: `${prefix}-` } },
    orderBy: { no: "desc" },
    select: { no: true },
  });

  let nomorUrut = 1;
  if (last?.no) {
    const match = last.no.match(/-(\d+)$/);
    if (match) nomorUrut = Number(match[1]) + 1;
  }
  return `${prefix}-${String(nomorUrut).padStart(3, "0")}`;
}

// Jumlahkan kolom "Total Jam" dari daftar baris {mulai, sampai, totalJam}.
// totalJam per baris dipercaya dari input staf (sama seperti di kertas
// fisik, kadang dibulatkan/disesuaikan manual), bukan dihitung ulang dari
// selisih jam mulai/sampai (supaya kasus lewat tengah malam dsb tidak perlu
// logika tambahan -- staf yang paling tahu angka riilnya).
function jumlahJam(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, r) => sum + (Number(r?.totalJam) || 0), 0);
}

function bersihkanRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    mulai: r?.mulai || "",
    sampai: r?.sampai || "",
    totalJam: Number(r?.totalJam) || 0,
    ...(r?.keterangan !== undefined ? { keterangan: r.keterangan || "" } : {}),
  }));
}

async function buildDataFields(body, { forCreate }) {
  const {
    divisi,
    customerId,
    unitAlatId,
    unitAlat,
    typeAlat,
    kategoriAlat,
    pengawas,
    lokasi,
    tanggal,
    waktuKerja,
    waktuTidakKerja,
    keteranganLokasi,
    namaPengawasTTD,
    namaOperatorTTD,
    isDraft,
  } = body;

  const wk = bersihkanRows(waktuKerja);
  const wtk = bersihkanRows(waktuTidakKerja);

  const data = {
    ...(divisi ? { divisi } : {}),
    customerId: customerId || null,
    unitAlatId: unitAlatId || null,
    unitAlat: unitAlat || null,
    typeAlat: typeAlat || null,
    kategoriAlat: kategoriAlat || null,
    pengawas: pengawas || null,
    lokasi: lokasi || null,
    waktuKerja: wk,
    waktuTidakKerja: wtk,
    totalJamKerja: jumlahJam(wk),
    totalJamTidakKerja: jumlahJam(wtk),
    keteranganLokasi: keteranganLokasi || null,
    namaPengawasTTD: namaPengawasTTD || null,
    namaOperatorTTD: namaOperatorTTD || null,
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
  customer: true,
};

router.get("/", async (req, res, next) => {
  try {
    const { search } = req.query;

    const list = await prisma.tensiv.findMany({
      where: {
        ...scopeDivisi(req),
        ...(search
          ? {
              OR: [
                { no: { contains: search, mode: "insensitive" } },
                { unitAlat: { contains: search, mode: "insensitive" } },
                { kategoriAlat: { contains: search, mode: "insensitive" } },
                { pengawas: { contains: search, mode: "insensitive" } },
                { lokasi: { contains: search, mode: "insensitive" } },
                { customer: { nama: { contains: search, mode: "insensitive" } } },
                { customer: { kode: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: includeRelasi,
      orderBy: { tanggal: "desc" },
    });

    res.json(list);
  } catch (e) {
    next(e);
  }
});

// Daftar Tensiv milik seorang customer yang BELUM ditarik jadi baris
// invoice manapun -- dipakai di form "Buat/Edit Invoice" sewa alat berat
// supaya staf tinggal centang, bukan ngetik ulang dari kertas.
router.get("/belum-ditagih", async (req, res, next) => {
  try {
    const { customerId, divisi } = req.query;

    if (!customerId) {
      return res.status(400).json({ error: "customerId wajib diisi" });
    }

    const list = await prisma.tensiv.findMany({
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
    const ts = await prisma.tensiv.findUnique({
      where: { id: req.params.id },
      include: includeRelasi,
    });

    if (!ts) {
      return res.status(404).json({ error: "Tensiv tidak ditemukan" });
    }

    res.json(ts);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { tanggal } = req.body;

    if (!tanggal) {
      return res.status(400).json({ error: "Tanggal wajib diisi" });
    }

    let ts;
    for (let attempt = 0; attempt < 5; attempt++) {
      const no = await createNomorTensiv();
      try {
        ts = await prisma.tensiv.create({
          data: {
            no,
            divisi: req.body.divisi || "Alat Berat",
            ...(await buildDataFields(req.body, { forCreate: true })),
          },
          include: includeRelasi,
        });
        break;
      } catch (e) {
        if (e.code === "P2002" && attempt < 4) continue;
        throw e;
      }
    }

    if (!ts) {
      return res.status(500).json({ error: "Gagal membuat nomor tensiv" });
    }

    res.status(201).json(ts);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const data = await buildDataFields(req.body, { forCreate: false });

    const ts = await prisma.tensiv.update({
      where: { id: req.params.id },
      data,
      include: includeRelasi,
    });

    res.json(ts);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/ttd", async (req, res, next) => {
  try {
    const ts = await prisma.tensiv.update({
      where: { id: req.params.id },
      data: { statusTTD: "LENGKAP" },
      include: includeRelasi,
    });

    res.json(ts);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.tensiv.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    if (e.code === "P2003" || e.code === "P2014") {
      return res.status(409).json({
        error:
          "Tensiv ini sudah dipakai di sebuah Invoice, jadi tidak bisa dihapus. Hapus dulu baris item-nya di invoice terkait.",
      });
    }
    next(e);
  }
});

export default router;
