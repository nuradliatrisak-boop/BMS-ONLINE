import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

// ------------------------------------------------------------
// PURCHASE ORDER (PO)
//
// PO = pesanan barang dari customer. Saat PO dibuat BELUM ada barang yang
// jalan (belum ada Surat Jalan), jadi stok tidak disentuh. Barang dikirim
// nyicil sesuai permintaan lapangan; tiap pengiriman dicatat manual di
// PoPengiriman (boleh diisi no. Surat Jalan sebagai referensi). Dari situ
// dihitung otomatis: qty terkirim, sisa, status (BARU / SEBAGIAN / SELESAI),
// dan sudah berapa hari PO menunggu (dipakai pengingat di Dashboard).
// ------------------------------------------------------------
const router = Router();

const TZ = "Asia/Jakarta";
const hariIniStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
const tglStr = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const bersih = (v) => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s || null;
};

// "YYYY-MM-DD" -> Date (UTC tengah malam), sama seperti tanggal di tabel lain.
function tglDate(v) {
  const s = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function selisihHari(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

const INCLUDE = {
  customer: { select: { id: true, nama: true } },
  items: { orderBy: [{ urut: "asc" }, { id: "asc" }] },
  pengiriman: { orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }] },
};

// Tambahkan angka turunan ke 1 PO (terkirim/sisa per barang, status, umur).
export function ringkasPo(po) {
  const today = hariIniStr();
  const terkirimMap = new Map();
  for (const p of po.pengiriman) terkirimMap.set(p.itemId, (terkirimMap.get(p.itemId) || 0) + p.qty);

  const items = po.items.map((it) => {
    const terkirim = r2(terkirimMap.get(it.id) || 0);
    return {
      ...it,
      terkirim,
      sisa: r2(Math.max(it.qty - terkirim, 0)),
      lebih: r2(Math.max(terkirim - it.qty, 0)),
      nilai: it.qty * it.hargaSatuan,
    };
  });

  const totalQty = r2(items.reduce((s, it) => s + it.qty, 0));
  const totalTerkirim = r2(items.reduce((s, it) => s + Math.min(it.terkirim, it.qty), 0));
  const persen = totalQty > 0 ? Math.min(100, Math.round((totalTerkirim / totalQty) * 100)) : 0;
  const subtotal = items.reduce((s, it) => s + it.nilai, 0);
  const ppn = (subtotal * (po.ppnPersen || 0)) / 100;

  let status = "BARU";
  if (po.batal) status = "DIBATALKAN";
  else if (items.length && items.every((it) => it.sisa === 0)) status = "SELESAI";
  else if (po.pengiriman.length) status = "SEBAGIAN";

  const terakhirKirim = po.pengiriman.length ? tglStr(po.pengiriman[0].tanggal) : null; // sudah urut terbaru dulu
  const acuan = terakhirKirim || tglStr(po.tanggal);
  const hariTunggu = Math.max(selisihHari(today, acuan), 0);

  return {
    ...po,
    items,
    namaCustomerTampil: po.customer?.nama || po.namaCustomer || "",
    subtotal,
    ppn,
    total: subtotal + ppn,
    totalQty,
    totalTerkirim,
    persen,
    status,
    terakhirKirim,
    hariTunggu,
  };
}

// Validasi isi form PO (dipakai POST & PUT). Balikan { error } atau { data, items }.
function bacaBody(req) {
  const b = req.body || {};
  const no = bersih(b.no);
  if (!no) return { error: "Nomor PO wajib diisi" };
  const tanggal = tglDate(b.tanggal);
  if (!tanggal) return { error: "Tanggal PO wajib diisi" };

  const customerId = b.customerId ? String(b.customerId) : null;
  const namaCustomer = bersih(b.namaCustomer);
  if (!customerId && !namaCustomer) return { error: "Pilih customer atau ketik nama pemesan" };

  const rows = Array.isArray(b.items) ? b.items : [];
  const items = [];
  for (const [i, r] of rows.entries()) {
    const uraian = bersih(r.uraian);
    const qty = toNum(r.qty);
    if (!uraian && !qty && !toNum(r.hargaSatuan)) continue; // baris kosong dilewati
    if (!uraian) return { error: `Baris barang ke-${i + 1}: uraian wajib diisi` };
    if (qty <= 0) return { error: `Baris barang ke-${i + 1}: jumlah harus lebih dari 0` };
    items.push({
      id: r.id ? String(r.id) : null,
      uraian,
      satuan: bersih(r.satuan),
      qty,
      hargaSatuan: Math.max(toNum(r.hargaSatuan), 0),
    });
  }
  if (!items.length) return { error: "Isi minimal 1 barang di PO" };

  const ppnPersen = Math.min(Math.max(toNum(b.ppnPersen), 0), 100);
  const divisi =
    req.user.role === "ADMIN" ? bersih(b.divisi) || "Supplier" : req.user.divisi || "Supplier";

  return {
    items,
    data: {
      no,
      divisi,
      tanggal,
      customerId,
      namaCustomer,
      proyek: bersih(b.proyek),
      lokasiProyek: bersih(b.lokasiProyek),
      kepalaProyek: bersih(b.kepalaProyek),
      penerimaBarang: bersih(b.penerimaBarang),
      catatan: bersih(b.catatan),
      ppnPersen,
    },
  };
}

async function ambilPo(req, id) {
  return prisma.purchaseOrder.findFirst({ where: { id, ...scopeDivisi(req) }, include: INCLUDE });
}

// GET /api/po?status=terbuka|BARU|SEBAGIAN|SELESAI|DIBATALKAN  (kosong = semua)
router.get("/", async (req, res, next) => {
  try {
    const list = await prisma.purchaseOrder.findMany({
      where: scopeDivisi(req),
      include: INCLUDE,
      orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
    });
    let hasil = list.map(ringkasPo);
    const st = String(req.query.status || "");
    if (st === "terbuka") hasil = hasil.filter((p) => p.status === "BARU" || p.status === "SEBAGIAN");
    else if (st) hasil = hasil.filter((p) => p.status === st.toUpperCase());
    res.json(hasil);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(ringkasPo(po));
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { error, data, items } = bacaBody(req);
    if (error) return res.status(400).json({ error });
    const po = await prisma.purchaseOrder.create({
      data: {
        ...data,
        items: {
          create: items.map((it, i) => ({
            urut: i,
            uraian: it.uraian,
            satuan: it.satuan,
            qty: it.qty,
            hargaSatuan: it.hargaSatuan,
          })),
        },
      },
      include: INCLUDE,
    });
    res.status(201).json(ringkasPo(po));
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Nomor PO ini sudah pernah dicatat" });
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const lama = await ambilPo(req, req.params.id);
    if (!lama) return res.status(404).json({ error: "PO tidak ditemukan" });

    const { error, data, items } = bacaBody(req);
    if (error) return res.status(400).json({ error });

    // Barang yang sudah punya pengiriman tidak boleh hilang dari PO.
    const idDipertahankan = new Set(items.filter((it) => it.id).map((it) => it.id));
    const dihapus = lama.items.filter((it) => !idDipertahankan.has(it.id));
    const adaKiriman = dihapus.filter((it) => lama.pengiriman.some((p) => p.itemId === it.id));
    if (adaKiriman.length) {
      return res.status(400).json({
        error: `Barang "${adaKiriman[0].uraian}" sudah ada pengirimannya, tidak bisa dihapus dari PO. Hapus dulu data pengirimannya.`,
      });
    }
    const idLama = new Set(lama.items.map((it) => it.id));
    if (items.some((it) => it.id && !idLama.has(it.id))) {
      return res.status(400).json({ error: "Ada barang yang bukan milik PO ini" });
    }

    await prisma.$transaction([
      prisma.purchaseOrder.update({ where: { id: lama.id }, data }),
      prisma.purchaseOrderItem.deleteMany({ where: { id: { in: dihapus.map((it) => it.id) } } }),
      ...items.map((it, i) =>
        it.id
          ? prisma.purchaseOrderItem.update({
              where: { id: it.id },
              data: { urut: i, uraian: it.uraian, satuan: it.satuan, qty: it.qty, hargaSatuan: it.hargaSatuan },
            })
          : prisma.purchaseOrderItem.create({
              data: {
                poId: lama.id,
                urut: i,
                uraian: it.uraian,
                satuan: it.satuan,
                qty: it.qty,
                hargaSatuan: it.hargaSatuan,
              },
            })
      ),
    ]);
    res.json(ringkasPo(await ambilPo(req, lama.id)));
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Nomor PO ini sudah dipakai PO lain" });
    next(e);
  }
});

// PATCH /api/po/:id/batal  body: { batal: true|false }
router.patch("/:id/batal", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { batal: !!req.body?.batal } });
    res.json(ringkasPo(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    await prisma.purchaseOrder.delete({ where: { id: po.id } }); // barang & pengiriman ikut terhapus (cascade)
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// POST /api/po/:id/pengiriman  body: { itemId, tanggal, qty, noSuratJalan?, catatan? }
router.post("/:id/pengiriman", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    if (po.batal) return res.status(400).json({ error: "PO ini sudah dibatalkan" });

    const b = req.body || {};
    const item = po.items.find((it) => it.id === String(b.itemId));
    if (!item) return res.status(400).json({ error: "Pilih barang yang dikirim" });
    const tanggal = tglDate(b.tanggal);
    if (!tanggal) return res.status(400).json({ error: "Tanggal pengiriman wajib diisi" });
    const qty = toNum(b.qty);
    if (qty <= 0) return res.status(400).json({ error: "Jumlah dikirim harus lebih dari 0" });

    await prisma.poPengiriman.create({
      data: {
        poId: po.id,
        itemId: item.id,
        tanggal,
        qty,
        noSuratJalan: bersih(b.noSuratJalan),
        catatan: bersih(b.catatan),
      },
    });
    res.status(201).json(ringkasPo(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/pengiriman/:pid", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    const p = po.pengiriman.find((x) => x.id === req.params.pid);
    if (!p) return res.status(404).json({ error: "Data pengiriman tidak ditemukan" });
    await prisma.poPengiriman.delete({ where: { id: p.id } });
    res.json(ringkasPo(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

export default router;
