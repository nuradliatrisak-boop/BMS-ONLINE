import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { petakanOtomatis } from "../services/poSuratJalan.js";
import { syncUpahKuliTx, hapusUpahKuliTx, syncSemuaUpahKuliPo } from "../services/poUpahKuli.js";

// ------------------------------------------------------------
// PURCHASE ORDER (PO)
//
// PO = pesanan barang dari customer. Saat PO dibuat BELUM ada barang yang
// jalan (belum ada Surat Jalan), jadi stok tidak disentuh. Barang dikirim
// nyicil sesuai permintaan lapangan; tiap pengiriman dicatat manual di
// PoPengiriman (boleh diisi no. Surat Jalan sebagai referensi). Dari situ
// dihitung otomatis: qty terkirim, sisa, status (BARU / SEBAGIAN / SELESAI),
// dan sudah berapa hari PO menunggu (dipakai pengingat di Dashboard).
//
// Selain input manual, Surat Jalan yang sudah dibuat ikut dihitung OTOMATIS
// kalau customer, alamat tujuan, dan barangnya cocok dengan PO (aturan lengkap
// di services/poSuratJalan.js). Yang penulisannya beda / tidak yakin masuk
// "perluKonfirmasi" supaya user yang memutuskan.
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

// Upah kuli: kosong/0 -> null.
function bacaUpah(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = toNum(v);
  return n > 0 ? n : null;
}

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

// ---- Nomor PO otomatis ----
// Pola: NNN/BMS-PO/<bulan romawi>/<tahun>, mis. 001/BMS-PO/X/2026. Urutan NNN naik
// terus per tahun (dihitung dari nomor otomatis yang sudah ada), jadi tidak ada
// yang loncat atau ganda walau PO lain diketik manual. Nomor yang diketik manual
// tidak ikut dihitung. Kalau 2 orang menyimpan bersamaan, nomor dicoba ulang.
const ROMAWI = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const PREFIX_OTOMATIS = "BMS-PO";

async function nomorBerikutnya(tanggalStr) {
  const tahun = tanggalStr.slice(0, 4);
  const bulan = Number(tanggalStr.slice(5, 7));
  const ada = await prisma.purchaseOrder.findMany({
    where: { no: { contains: `/${PREFIX_OTOMATIS}/` } },
    select: { no: true },
  });
  const pola = new RegExp(`^(\\d+)/${PREFIX_OTOMATIS}/[IVX]+/${tahun}$`);
  let maks = 0;
  for (const { no } of ada) {
    const m = pola.exec(no);
    if (m) maks = Math.max(maks, Number(m[1]));
  }
  return `${String(maks + 1).padStart(3, "0")}/${PREFIX_OTOMATIS}/${ROMAWI[bulan]}/${tahun}`;
}

const INCLUDE = {
  customer: { select: { id: true, nama: true } },
  items: { orderBy: [{ urut: "asc" }, { id: "asc" }] },
  pengiriman: { orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }] },
};

// Tambahkan angka turunan ke 1 PO (terkirim/sisa per barang, status, umur).
export function ringkasPo(po, auto) {
  const today = hariIniStr();
  const otomatis = auto?.otomatis || [];

  // riwayat gabungan: input manual + Surat Jalan yang terhitung otomatis (terbaru dulu)
  const pengiriman = [
    ...po.pengiriman.map((p) => ({ ...p, otomatis: false })),
    ...otomatis.map((a) => ({
      id: `sj:${a.sjId}`,
      poId: po.id,
      itemId: a.itemId,
      tanggal: a.tanggal,
      qty: a.qty,
      noSuratJalan: a.no,
      catatan: a.tujuan || null,
      createdAt: a.tanggal,
      otomatis: true,
      sjId: a.sjId,
      dikonfirmasi: !!a.dikonfirmasi,
    })),
  ].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal) || new Date(b.createdAt) - new Date(a.createdAt));

  const terkirimMap = new Map();
  for (const p of pengiriman) terkirimMap.set(p.itemId, (terkirimMap.get(p.itemId) || 0) + p.qty);

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

  const totalUpahKuli = r2(po.pengiriman.reduce((s, p) => s + (Number(p.upahKuli) || 0), 0));
  const totalQty = r2(items.reduce((s, it) => s + it.qty, 0));
  const totalTerkirim = r2(items.reduce((s, it) => s + Math.min(it.terkirim, it.qty), 0));
  const persen = totalQty > 0 ? Math.min(100, Math.round((totalTerkirim / totalQty) * 100)) : 0;
  const subtotal = items.reduce((s, it) => s + it.nilai, 0);
  const ppn = (subtotal * (po.ppnPersen || 0)) / 100;

  let status = "BARU";
  if (po.batal) status = "DIBATALKAN";
  else if (items.length && items.every((it) => it.sisa === 0)) status = "SELESAI";
  else if (pengiriman.length) status = "SEBAGIAN";

  const terakhirKirim = pengiriman.length ? tglStr(pengiriman[0].tanggal) : null; // sudah urut terbaru dulu
  const acuan = terakhirKirim || tglStr(po.tanggal);
  const hariTunggu = Math.max(selisihHari(today, acuan), 0);

  return {
    ...po,
    items,
    pengiriman,
    perluKonfirmasi: auto?.perlu || [],
    dilepas: auto?.dilepas || [],
    namaCustomerTampil: po.customer?.nama || po.namaCustomer || "",
    subtotal,
    ppn,
    total: subtotal + ppn,
    totalQty,
    totalTerkirim,
    totalUpahKuli,
    persen,
    status,
    terakhirKirim,
    hariTunggu,
  };
}

// Validasi isi form PO (dipakai POST & PUT). Balikan { error } atau { data, items }.
function bacaBody(req) {
  const b = req.body || {};
  const otomatis = !!b.otomatis && req.method === "POST"; // nomor otomatis hanya saat PO baru dibuat
  const no = bersih(b.no);
  if (!no && !otomatis) return { error: "Nomor PO wajib diisi" };
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
    otomatis,
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

// ringkasPo + hitungan otomatis dari Surat Jalan (1 PO atau banyak PO sekaligus)
async function ringkasLengkap(po) {
  const peta = await petakanOtomatis([po]);
  return ringkasPo(po, peta.get(po.id));
}
async function ringkasBanyak(list) {
  const peta = await petakanOtomatis(list);
  return list.map((po) => ringkasPo(po, peta.get(po.id)));
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
    let hasil = await ringkasBanyak(list);
    const st = String(req.query.status || "");
    if (st === "terbuka") hasil = hasil.filter((p) => p.status === "BARU" || p.status === "SEBAGIAN");
    else if (st) hasil = hasil.filter((p) => p.status === st.toUpperCase());
    res.json(hasil);
  } catch (e) {
    next(e);
  }
});

// GET /api/po/nomor-berikutnya?tanggal=YYYY-MM-DD -> { no } (pratinjau nomor otomatis)
router.get("/nomor-berikutnya", async (req, res, next) => {
  try {
    const tgl = tglDate(req.query.tanggal) || tglDate(hariIniStr());
    res.json({ no: await nomorBerikutnya(tglStr(tgl)) });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(await ringkasLengkap(po));
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { error, data, items, otomatis } = bacaBody(req);
    if (error) return res.status(400).json({ error });

    const buat = (no) =>
      prisma.purchaseOrder.create({
        data: {
          ...data,
          no,
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

    let po;
    if (otomatis) {
      // bentrok nomor (2 orang simpan bersamaan) -> ambil nomor berikutnya & coba lagi
      for (let i = 0; i < 5; i++) {
        try {
          po = await buat(await nomorBerikutnya(tglStr(data.tanggal)));
          break;
        } catch (e) {
          if (e.code !== "P2002" || i === 4) throw e;
        }
      }
    } else {
      po = await buat(data.no);
    }
    res.status(201).json(await ringkasLengkap(po));
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
    await syncSemuaUpahKuliPo(lama.id);
    res.json(await ringkasLengkap(await ambilPo(req, lama.id)));
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
    res.json(await ringkasLengkap(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    await hapusUpahKuliTx(po.pengiriman.map((p) => p.id));
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

    const baru = await prisma.poPengiriman.create({
      data: {
        poId: po.id,
        itemId: item.id,
        tanggal,
        qty,
        noSuratJalan: bersih(b.noSuratJalan),
        catatan: bersih(b.catatan),
        upahKuli: bacaUpah(b.upahKuli),
      },
    });
    await syncUpahKuliTx(po, item, baru);
    res.status(201).json(await ringkasLengkap(await ambilPo(req, po.id)));
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
    await hapusUpahKuliTx(p.id);
    await prisma.poPengiriman.delete({ where: { id: p.id } });
    res.json(await ringkasLengkap(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

// PUT /api/po/:id/pengiriman/:pid  body: { tanggal?, qty?, noSuratJalan?, catatan?, upahKuli? }
router.put("/:id/pengiriman/:pid", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    const p = po.pengiriman.find((x) => x.id === req.params.pid);
    if (!p) return res.status(404).json({ error: "Data pengiriman tidak ditemukan" });
    const b = req.body || {};
    const data = {};
    if (b.tanggal !== undefined) {
      const t = tglDate(b.tanggal);
      if (!t) return res.status(400).json({ error: "Tanggal pengiriman tidak valid" });
      data.tanggal = t;
    }
    if (b.qty !== undefined) {
      const q = toNum(b.qty);
      if (q <= 0) return res.status(400).json({ error: "Jumlah dikirim harus lebih dari 0" });
      data.qty = q;
    }
    if (b.noSuratJalan !== undefined) data.noSuratJalan = bersih(b.noSuratJalan);
    if (b.catatan !== undefined) data.catatan = bersih(b.catatan);
    if (b.upahKuli !== undefined) data.upahKuli = bacaUpah(b.upahKuli);
    const baru = await prisma.poPengiriman.update({ where: { id: p.id }, data });
    await syncUpahKuliTx(po, po.items.find((i) => i.id === baru.itemId), baru);
    res.json(await ringkasLengkap(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

// POST /api/po/:id/pengiriman/bulk   (menu Impor: stok keluar dari Excel / progres PO)
// body: { rows: [{ itemId | uraian, tanggal, qty, noSuratJalan?, catatan?, upahKuli? }] }
// Baris yang SAMA PERSIS (barang+tanggal+qty+no.surat) dilewati -> aman diimpor ulang.
router.post("/:id/pengiriman/bulk", async (req, res, next) => {
  try {
    const po = await ambilPo(req, req.params.id);
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    if (po.batal) return res.status(400).json({ error: "PO ini sudah dibatalkan" });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "Tidak ada baris untuk diimpor" });
    if (rows.length > 3000) return res.status(400).json({ error: "Maksimal 3000 baris sekali impor" });

    const kunci = (itemId, tgl, qty, sj) => `${itemId}|${tglStr(tgl)}|${r2(qty)}|${String(sj || "").trim()}`;
    const sudah = new Set(po.pengiriman.map((x) => kunci(x.itemId, x.tanggal, x.qty, x.noSuratJalan)));
    const baru = [];
    let dilewati = 0;
    for (const [i, r] of rows.entries()) {
      const item = po.items.find((it) => it.id === String(r.itemId)) ||
        (r.uraian ? po.items.find((it) => it.uraian.toLowerCase() === String(r.uraian).trim().toLowerCase()) : null) ||
        (po.items.length === 1 ? po.items[0] : null);
      if (!item) return res.status(400).json({ error: `Baris ${i + 1}: barang PO tidak ditemukan` });
      const tanggal = tglDate(r.tanggal);
      if (!tanggal) return res.status(400).json({ error: `Baris ${i + 1}: tanggal tidak valid` });
      const qty = toNum(r.qty);
      if (qty <= 0) return res.status(400).json({ error: `Baris ${i + 1}: qty harus lebih dari 0` });
      const noSuratJalan = bersih(r.noSuratJalan);
      const k = kunci(item.id, tanggal, qty, noSuratJalan);
      if (sudah.has(k)) { dilewati++; continue; }
      sudah.add(k);
      baru.push({ poId: po.id, itemId: item.id, tanggal, qty, noSuratJalan, catatan: bersih(r.catatan), upahKuli: bacaUpah(r.upahKuli) });
    }
    const dibuat = [];
    for (const data of baru) dibuat.push(await prisma.poPengiriman.create({ data }));
    for (const p of dibuat) if (p.upahKuli) await syncUpahKuliTx(po, po.items.find((i) => i.id === p.itemId), p);
    res.status(201).json({ dibuat: dibuat.length, dilewati, po: await ringkasLengkap(await ambilPo(req, po.id)) });
  } catch (e) {
    next(e);
  }
});

// ---- Konfirmasi pencocokan Surat Jalan -> PO ----
// SJ yang alamat/barangnya tidak persis sama muncul di "perluKonfirmasi"; user
// memutuskan hubungkan (dan barang PO mana yang dikredit) atau bukan PO ini.
async function ambilPoDanSj(req, res) {
  const po = await ambilPo(req, req.params.id);
  if (!po) {
    res.status(404).json({ error: "PO tidak ditemukan" });
    return {};
  }
  const sj = await prisma.suratJalan.findFirst({ where: { id: req.params.sjId, ...scopeDivisi(req) } });
  if (!sj) {
    res.status(404).json({ error: "Surat Jalan tidak ditemukan" });
    return {};
  }
  return { po, sj };
}

// POST /api/po/:id/sj/:sjId/hubungkan  body: { itemId }
router.post("/:id/sj/:sjId/hubungkan", async (req, res, next) => {
  try {
    const { po, sj } = await ambilPoDanSj(req, res);
    if (!po) return;
    if (po.batal) return res.status(400).json({ error: "PO ini sudah dibatalkan" });
    const item = po.items.find((it) => it.id === String(req.body?.itemId || ""));
    if (!item) return res.status(400).json({ error: "Pilih barang PO yang dikirim lewat Surat Jalan ini" });
    await prisma.poSuratJalan.upsert({
      where: { poId_suratJalanId: { poId: po.id, suratJalanId: sj.id } },
      create: { poId: po.id, suratJalanId: sj.id, status: "TERHUBUNG", itemId: item.id },
      update: { status: "TERHUBUNG", itemId: item.id },
    });
    res.json(await ringkasLengkap(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

// POST /api/po/:id/sj/:sjId/tolak -> SJ ini bukan untuk PO ini (tidak dihitung & tidak ditanya lagi)
router.post("/:id/sj/:sjId/tolak", async (req, res, next) => {
  try {
    const { po, sj } = await ambilPoDanSj(req, res);
    if (!po) return;
    await prisma.poSuratJalan.upsert({
      where: { poId_suratJalanId: { poId: po.id, suratJalanId: sj.id } },
      create: { poId: po.id, suratJalanId: sj.id, status: "DITOLAK" },
      update: { status: "DITOLAK", itemId: null },
    });
    res.json(await ringkasLengkap(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

// DELETE /api/po/:id/sj/:sjId -> batalkan keputusan user, pencocokan kembali otomatis
router.delete("/:id/sj/:sjId", async (req, res, next) => {
  try {
    const { po, sj } = await ambilPoDanSj(req, res);
    if (!po) return;
    await prisma.poSuratJalan.deleteMany({ where: { poId: po.id, suratJalanId: sj.id } });
    res.json(await ringkasLengkap(await ambilPo(req, po.id)));
  } catch (e) {
    next(e);
  }
});

export default router;
