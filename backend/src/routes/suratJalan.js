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

router.get("/", async (req, res, next) => {
  try {
    const list = await prisma.suratJalan.findMany({
      where: scopeDivisi(req),
      include: {
        armada: true,
      },
      orderBy: {
        tanggal: "desc",
      },
    });

    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      divisi,
      armadaId,
      tujuan,
      tanggal,
      isDraft,
      detail,
    } = req.body;

    if (!divisi || !tujuan || !tanggal) {
      return res.status(400).json({
        error: "Divisi, tujuan, dan tanggal wajib diisi",
      });
    }

    let sj;

    /*
     * Generate nomor otomatis.
     *
     * Contoh:
     * BMS-SJ-202608-0001
     * BMS-SJ-202608-0002
     */
    for (let attempt = 0; attempt < 5; attempt++) {
      const no = await createNomorSuratJalan();

      try {
        sj = await prisma.suratJalan.create({
          data: {
            no,
            divisi,
            armadaId: armadaId || null,
            tujuan,
            tanggal: new Date(tanggal),
            isDraft: !!isDraft,
            detail: detail || null,
          },
          include: {
            armada: true,
          },
        });

        break;
      } catch (e) {
        /*
         * Kalau dua user membuat surat jalan
         * hampir bersamaan dan nomor yang sama
         * terbentuk, coba generate nomor berikutnya.
         */
        if (e.code === "P2002" && attempt < 4) {
          continue;
        }

        throw e;
      }
    }

    if (!sj) {
      return res.status(500).json({
        error: "Gagal membuat nomor surat jalan",
      });
    }

    res.status(201).json(sj);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const {
      armadaId,
      tujuan,
      tanggal,
      isDraft,
      detail,
    } = req.body;

    const sj = await prisma.suratJalan.update({
      where: {
        id: req.params.id,
      },
      data: {
        armadaId: armadaId || null,
        tujuan,
        tanggal: tanggal
          ? new Date(tanggal)
          : undefined,
        isDraft,
        detail,
      },
      include: {
        armada: true,
      },
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
      include: {
        armada: true,
      },
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
    next(e);
  }
});

export default router;