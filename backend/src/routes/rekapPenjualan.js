import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

function scopeCustomerIds(req) {
  return prisma.customer.findMany({
    where: scopeDivisi(req),
    select: { id: true },
  });
}


// ---------------------------------------------------------------------------
// Nomor Rekapan Invoice: BM-<P|O><Inisial> <urut>, mis. "BM-PM 385".
//   P = Perusahaan (PT/CV/UD/dst), O = Orang/perorangan (Bp. Alexander -> OA)
//   Inisial = huruf pertama nama (setelah PT./CV./Bp. dibuang)
//   Urut    = nomor berjalan PER PREFIX (PM sendiri, OA sendiri), disimpan di
//             tabel Setting dengan key "rekapNo:<prefix>" (= nomor terakhir terpakai).
// ---------------------------------------------------------------------------
const BADAN_USAHA = /^(PT|CV|UD|PD|FA|KOPERASI|YAYASAN|KOP)\b\.?\s*/i;
const GELAR_ORANG = /^(BAPAK|BPK|BP|PAK|IBU|IBK|HJ|H|DR|IR|MR|MRS|SDR|SDRI)\b\.?\s*/i;

export function rekapPrefix(nama) {
  let n = String(nama || "").trim();
  let jenis = "O";
  if (BADAN_USAHA.test(n)) {
    jenis = "P";
    n = n.replace(BADAN_USAHA, "");
  } else {
    while (GELAR_ORANG.test(n)) n = n.replace(GELAR_ORANG, "");
  }
  const inisial = (n.match(/[A-Za-z]/) || ["X"])[0].toUpperCase();
  return `${jenis}${inisial}`;
}

async function lastSeq(prefix) {
  const s = await prisma.setting.findUnique({ where: { key: `rekapNo:${prefix}` } });
  return Number(s?.value || 0);
}

// Saran nomor berikutnya (tidak "memakai" nomor; baru terpakai saat dicetak)
router.get("/next-no", async (req, res, next) => {
  try {
    const { customerId } = req.query;
    if (!customerId) return res.status(400).json({ error: "customerId wajib" });
    const customer = await prisma.customer.findUnique({ where: { id: String(customerId) } });
    if (!customer) return res.status(404).json({ error: "Customer tidak ditemukan" });
    const prefix = rekapPrefix(customer.nama);
    const seq = (await lastSeq(prefix)) + 1;
    res.json({ prefix, seq, no: `BM-${prefix} ${seq}` });
  } catch (e) {
    next(e);
  }
});

// Tandai nomor sudah terpakai (dipanggil saat cetak/export). Counter hanya naik.
router.post("/next-no", async (req, res, next) => {
  try {
    const m = String(req.body?.no || "").trim().match(/^BM-([A-Z]{2})\s+(\d+)$/i);
    if (!m) return res.json({ ok: false }); // format bebas/manual -> abaikan
    const prefix = m[1].toUpperCase();
    const seq = Number(m[2]);
    if (seq > (await lastSeq(prefix))) {
      await prisma.setting.upsert({
        where: { key: `rekapNo:${prefix}` },
        update: { value: String(seq) },
        create: { key: `rekapNo:${prefix}`, value: String(seq) },
      });
    }
    res.json({ ok: true, prefix, seq });
  } catch (e) {
    next(e);
  }
});

// Filter tanggal (bulan=YYYY-MM atau from/to) -> objek where Prisma
function tanggalWhere(q) {
  const { bulan, from, to } = q;
  if (bulan) {
    const [year, month] = String(bulan).split("-").map(Number);
    if (year && month) return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
    return undefined;
  }
  if (from || to) {
    const t = {};
    if (from) t.gte = new Date(`${from}T00:00:00`);
    if (to) {
      const d = new Date(`${to}T00:00:00`);
      d.setDate(d.getDate() + 1);
      t.lt = d;
    }
    return t;
  }
  return undefined;
}

// Rekapan Invoice (format lembar BMS): 1 baris = 1 invoice, lengkap dengan
// pembayarannya. Kolom "Customer" = penerima pada surat jalan invoice itu
// (mis. PT Aiko); kalau tidak ada, pakai nama customer invoice.
router.get("/invoice-rekap", async (req, res, next) => {
  try {
    const { customerId, belumLunas } = req.query;
    const allowed = new Set((await scopeCustomerIds(req)).map((c) => c.id));
    if (customerId && !allowed.has(customerId)) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }
    const where = { customerId: customerId ? customerId : { in: [...allowed] } };
    const tgl = tanggalWhere(req.query);
    if (tgl) where.tanggal = tgl;

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: true,
        pembayaran: { orderBy: { tanggal: "asc" } },
        items: { include: { suratJalan: { select: { penerima: true } } } },
      },
      orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    });

    // 1 baris = 1 (invoice x penerima). Invoice yang isinya ke beberapa penerima
    // (mis. Pak Alexander -> PT Aiko + PT lain) dipecah per penerima; pembayaran
    // invoice dibagi proporsional terhadap nilai tiap penerima. Untuk invoice
    // 1 penerima (kasus umum) angkanya persis sama dengan invoice aslinya.
    // Halaman yang menggabung per penerima ("Semua Penerima - total per PT").
    let rows = [];
    const semuaPenerima = new Set();
    for (const inv of invoices) {
      const total = inv.items.reduce((s, it) => s + Number(it.qty) * Number(it.hargaSatuan), 0);
      const dibayarInv = inv.pembayaran.reduce((s, p) => s + Number(p.nominal || 0), 0);
      const per = new Map();
      for (const it of inv.items) {
        const nama = (it.suratJalan?.penerima || "").trim() || inv.customer?.nama || "";
        per.set(nama, (per.get(nama) || 0) + Number(it.qty) * Number(it.hargaSatuan));
      }
      if (!per.size) per.set(inv.customer?.nama || "", 0);
      for (const [nama, share] of per) {
        const ratio = total > 0 ? share / total : per.size === 1 ? 1 : 0;
        const dibayar = dibayarInv * ratio;
        semuaPenerima.add(nama);
        rows.push({
          key: `${inv.id}|${nama}`,
          id: inv.id,
          no: inv.no,
          tanggal: inv.tanggal,
          penerima: nama,
          customer: nama,
          total: share,
          dibayar,
          sisa: share - dibayar,
          pembayaran: inv.pembayaran.map((p) => ({
            tanggal: p.tanggal,
            metode: p.metode || "",
            nominal: Number(p.nominal || 0) * ratio,
          })),
        });
      }
    }
    if (belumLunas === "1") rows = rows.filter((r) => r.sisa > 0.5);
    const penerimaList = [...semuaPenerima].sort((x, y) => x.localeCompare(y));

    const totalTagihan = rows.reduce((s, r) => s + r.total, 0);
    const totalDibayar = rows.reduce((s, r) => s + r.dibayar, 0);
    res.json({
      rows,
      penerimaList,
      summary: { count: rows.length, totalTagihan, totalDibayar, sisa: totalTagihan - totalDibayar },
    });
  } catch (e) {
    next(e);
  }
});

async function allowedSet(req) {
  return new Set((await scopeCustomerIds(req)).map((c) => c.id));
}

// ---------------------------------------------------------------------------
// Draft header rekap (PIC, tujuan, tanggal, no. rekap, sisa deposit) disimpan
// per customer supaya tidak hilang saat halaman di-refresh / pindah perangkat.
// Disimpan di tabel Setting (key "rekapHeader:<customerId>") -> tanpa migrasi.
// ---------------------------------------------------------------------------
const str = (v, max = 500) => String(v ?? "").slice(0, max);
function cleanHeader(h = {}) {
  const d = h.deposit || {};
  return {
    pic: str(h.pic),
    tujuan: str(h.tujuan, 1000),
    recipientId: str(h.recipientId, 100),
    tanggal: str(h.tanggal, 10),
    noInvoice: str(h.noInvoice, 50),
    savedAt: Number(h.savedAt) || Date.now(),
    deposit: {
      aktif: !!d.aktif,
      tanggal: str(d.tanggal, 10),
      noRef: str(d.noRef, 50),
      nominal: Number(d.nominal) || 0,
    },
  };
}

router.get("/header", async (req, res, next) => {
  try {
    const { customerId } = req.query;
    if (!customerId) return res.status(400).json({ error: "customerId wajib" });
    if (!(await allowedSet(req)).has(String(customerId))) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }
    const s = await prisma.setting.findUnique({ where: { key: `rekapHeader:${customerId}` } });
    let header = null;
    if (s?.value) {
      try {
        header = cleanHeader(JSON.parse(s.value));
      } catch {
        header = null;
      }
    }
    res.json({ header });
  } catch (e) {
    next(e);
  }
});

router.put("/header", async (req, res, next) => {
  try {
    const { customerId, header } = req.body || {};
    if (!customerId) return res.status(400).json({ error: "customerId wajib" });
    if (!(await allowedSet(req)).has(String(customerId))) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }
    const clean = cleanHeader(header);
    const key = `rekapHeader:${customerId}`;
    await prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(clean) },
      create: { key, value: JSON.stringify(clean) },
    });
    res.json({ ok: true, header: clean });
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { customerId, bulan, from, to } = req.query;
    const customerIds = await scopeCustomerIds(req);
    const allowedIds = new Set(customerIds.map((c) => c.id));

    if (customerId && !allowedIds.has(customerId)) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }

    const where = {
      customerId: customerId ? customerId : { in: [...allowedIds] },
    };

    if (bulan) {
      const [year, month] = String(bulan).split("-").map(Number);
      if (year && month) {
        where.tanggal = {
          gte: new Date(year, month - 1, 1),
          lt: new Date(year, month, 1),
        };
      }
    } else if (from || to) {
      where.tanggal = {};
      if (from) where.tanggal.gte = new Date(`${from}T00:00:00`);
      if (to) {
        const d = new Date(`${to}T00:00:00`);
        d.setDate(d.getDate() + 1);
        where.tanggal.lt = d;
      }
    }

    const rows = await prisma.rekapPenjualan.findMany({
      where,
      include: { customer: true },
      orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    });

    const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const jumlah = rows.reduce((sum, row) => sum + Number(row.jumlah || 0), 0);

    // Tampilan "Rekap Keseluruhan": gabung per PENERIMA (tujuan), total saja.
    // Penerima diambil dari Surat Jalan dengan nomor yang sama.
    let groups;
    if (req.query.view === "keseluruhan") {
      const nos = [...new Set(rows.map((r) => r.noSuratJalan))];
      const sjs = nos.length
        ? await prisma.suratJalan.findMany({
            where: { no: { in: nos } },
            select: { no: true, penerima: true },
          })
        : [];
      const penerimaByNo = new Map(sjs.map((s) => [s.no, (s.penerima || "").trim()]));
      const map = new Map();
      for (const r of rows) {
        const nama = penerimaByNo.get(r.noSuratJalan) || "(Penerima belum tercatat)";
        const g = map.get(nama) || { penerima: nama, count: 0, jumlah: 0, total: 0, tanggalTerakhir: null };
        g.count += 1;
        g.jumlah += Number(r.jumlah || 0);
        g.total += Number(r.total || 0);
        if (!g.tanggalTerakhir || r.tanggal > g.tanggalTerakhir) g.tanggalTerakhir = r.tanggal;
        map.set(nama, g);
      }
      groups = [...map.values()].sort((a, b) => a.penerima.localeCompare(b.penerima));
    }

    res.json({ rows, groups, summary: { total, jumlah, count: rows.length } });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      customerId,
      tanggal,
      noSuratJalan,
      noPolisi,
      jenisBarang,
      panjang,
      lebar,
      tinggi,
      jumlah,
      harga,
      catatan,
    } = req.body;

    if (!customerId || !tanggal || !noSuratJalan || !noPolisi || !jenisBarang) {
      return res.status(400).json({
        error: "Customer, tanggal, nomor surat jalan, nomor polisi, dan jenis barang wajib diisi",
      });
    }
    if (!(await allowedSet(req)).has(customerId)) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }

    const volume = Number(panjang || 0) * Number(lebar || 0) * Number(tinggi || 0);
    const qty = Number(jumlah || volume || 0);
    const price = Number(harga || 0);
    const total = qty * price;

    const row = await prisma.rekapPenjualan.create({
      data: {
        customerId,
        tanggal: new Date(tanggal),
        noSuratJalan: String(noSuratJalan).trim(),
        noPolisi: String(noPolisi).trim(),
        jenisBarang: String(jenisBarang).trim(),
        panjang: Number(panjang || 0),
        lebar: Number(lebar || 0),
        tinggi: Number(tinggi || 0),
        jumlah: qty,
        harga: price,
        total,
        catatan: catatan || null,
      },
      include: { customer: true },
    });

    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await prisma.rekapPenjualan.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data rekap tidak ditemukan" });
    const allowed = await allowedSet(req);
    if (!allowed.has(current.customerId) || (req.body.customerId && !allowed.has(req.body.customerId))) {
      return res.status(403).json({ error: "Data rekap tidak dapat diakses" });
    }

    const {
      customerId,
      tanggal,
      noSuratJalan,
      noPolisi,
      jenisBarang,
      panjang,
      lebar,
      tinggi,
      jumlah,
      harga,
      catatan,
    } = req.body;

    const volume = Number(panjang || 0) * Number(lebar || 0) * Number(tinggi || 0);
    const qty = Number(jumlah || volume || 0);
    const price = Number(harga || 0);

    const row = await prisma.rekapPenjualan.update({
      where: { id: req.params.id },
      data: {
        customerId,
        tanggal: tanggal ? new Date(tanggal) : undefined,
        noSuratJalan: noSuratJalan?.trim(),
        noPolisi: noPolisi?.trim(),
        jenisBarang: jenisBarang?.trim(),
        panjang: Number(panjang || 0),
        lebar: Number(lebar || 0),
        tinggi: Number(tinggi || 0),
        jumlah: qty,
        harga: price,
        total: qty * price,
        catatan: catatan || null,
      },
      include: { customer: true },
    });

    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await prisma.rekapPenjualan.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data rekap tidak ditemukan" });
    if (!(await allowedSet(req)).has(current.customerId)) {
      return res.status(403).json({ error: "Data rekap tidak dapat diakses" });
    }
    await prisma.rekapPenjualan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
