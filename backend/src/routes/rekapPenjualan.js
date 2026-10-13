import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { cariHargaCustomer } from "../services/hargaCustomer.js";

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

// ---------------------------------------------------------------------------
// REKAP RITASE (dari Surat Jalan)
// Format: per No. Polisi -> per tanggal -> Ritase (jumlah SJ), Kubikasi per
// ritase, Total Kubikasi. 1 Surat Jalan = 1 ritase.
//   GET /api/rekap-penjualan/ritase?customerId=&from=YYYY-MM-DD&to=YYYY-MM-DD
//       &q=<cari tujuan/penerima/jenis barang>&kubikasiDefault=5.5
// Sumber data = tabel Surat Jalan (bukan tabel Rekap Penjualan), jadi langsung
// ikut berubah kalau SJ ditambah / diedit / dihapus. SJ draft tidak dihitung.
// Kubikasi diambil dari m3 SJ (atau P x L x T); kalau kosong dipakai
// kubikasiDefault. Kalau dalam 1 hari + 1 nopol kubikasinya beda-beda, baris
// dipecah per kubikasi supaya Ritase x Kubikasi = Total selalu cocok.
// ---------------------------------------------------------------------------
const r3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;

// "b9305uyx" / "B 9305  UYX" -> "B 9305 UYX"
function normNopol(v) {
  const raw = String(v || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!raw) return "";
  const m = raw.replace(/\s+/g, "").match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : raw;
}

const WIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
const tglKey = (d) => WIB.format(new Date(d)); // YYYY-MM-DD (hari kalender WIB)

// ---------------------------------------------------------------------------
// Input manual ritase (untuk ritase yang tidak ada / belum ada Surat Jalannya).
// Disimpan di tabel Setting (key "ritaseManual", JSON array) -> tanpa migrasi.
// Entri: { id, customerId ("" = umum), tanggal YYYY-MM-DD, noPolisi, ritase,
//          kubikasi, catatan }
// ---------------------------------------------------------------------------
const MANUAL_KEY = "ritaseManual";
async function bacaManual() {
  const s = await prisma.setting.findUnique({ where: { key: MANUAL_KEY } });
  try {
    const arr = JSON.parse(s?.value || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
async function simpanManual(list) {
  const value = JSON.stringify(list);
  await prisma.setting.upsert({ where: { key: MANUAL_KEY }, update: { value }, create: { key: MANUAL_KEY, value } });
}
function bersihManual(b = {}, id) {
  const tanggal = String(b.tanggal || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw Object.assign(new Error("Tanggal wajib diisi"), { status: 400 });
  const noPolisi = normNopol(b.noPolisi);
  if (!noPolisi) throw Object.assign(new Error("No. Polisi wajib diisi"), { status: 400 });
  const ritase = Math.round(Number(String(b.ritase ?? "").replace(",", ".")));
  if (!(ritase > 0)) throw Object.assign(new Error("Ritase harus lebih dari 0"), { status: 400 });
  const kubikasi = Number(String(b.kubikasi ?? "").replace(",", ".")) || 0;
  if (kubikasi < 0) throw Object.assign(new Error("Kubikasi tidak boleh negatif"), { status: 400 });
  return {
    id,
    customerId: String(b.customerId || ""),
    tanggal,
    noPolisi,
    ritase,
    kubikasi: r3(kubikasi),
    catatan: String(b.catatan || "").slice(0, 200),
  };
}
async function manualBolehAkses(req, entry) {
  return !entry.customerId || (await allowedSet(req)).has(entry.customerId);
}
function manualFilter(list, { customerId, from, to }) {
  return list.filter(
    (e) =>
      (!customerId || e.customerId === customerId) &&
      (!from || e.tanggal >= from) &&
      (!to || e.tanggal <= to)
  );
}

router.get("/ritase-manual", async (req, res, next) => {
  try {
    const { customerId, from, to } = req.query;
    const allowed = await allowedSet(req);
    let list = (await bacaManual()).filter((e) => !e.customerId || allowed.has(e.customerId));
    list = manualFilter(list, { customerId: customerId ? String(customerId) : "", from, to });
    list.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.noPolisi.localeCompare(b.noPolisi));
    res.json({ rows: list });
  } catch (e) {
    next(e);
  }
});

router.post("/ritase-manual", async (req, res, next) => {
  try {
    const entry = bersihManual(req.body, `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
    if (!(await manualBolehAkses(req, entry))) return res.status(403).json({ error: "Customer tidak dapat diakses" });
    const list = await bacaManual();
    list.push(entry);
    await simpanManual(list);
    res.status(201).json(entry);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.put("/ritase-manual/:id", async (req, res, next) => {
  try {
    const list = await bacaManual();
    const i = list.findIndex((e) => e.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "Data tidak ditemukan" });
    if (!(await manualBolehAkses(req, list[i]))) return res.status(403).json({ error: "Data tidak dapat diakses" });
    const entry = bersihManual(req.body, list[i].id);
    if (!(await manualBolehAkses(req, entry))) return res.status(403).json({ error: "Customer tidak dapat diakses" });
    list[i] = entry;
    await simpanManual(list);
    res.json(entry);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.delete("/ritase-manual/:id", async (req, res, next) => {
  try {
    const list = await bacaManual();
    const cur = list.find((e) => e.id === req.params.id);
    if (!cur) return res.status(404).json({ error: "Data tidak ditemukan" });
    if (!(await manualBolehAkses(req, cur))) return res.status(403).json({ error: "Data tidak dapat diakses" });
    await simpanManual(list.filter((e) => e.id !== req.params.id));
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.get("/ritase", async (req, res, next) => {
  try {
    const { customerId, from, to, q } = req.query;
    const kubDefault = Number(String(req.query.kubikasiDefault ?? "").replace(",", ".")) || 0;
    // sumber: "sj" (Surat Jalan saja, default) | "gabung" (SJ + input manual) | "manual" (input manual saja)
    const sumber = ["sj", "gabung", "manual"].includes(String(req.query.sumber)) ? String(req.query.sumber) : "sj";
    const allowed = await allowedSet(req);
    if (customerId && !allowed.has(String(customerId))) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }

    const where = { ...scopeDivisi(req), isDraft: false };
    if (customerId) where.customerId = String(customerId);
    if (from || to) {
      where.tanggal = {};
      if (from) where.tanggal.gte = new Date(`${from}T00:00:00+07:00`);
      if (to) {
        const d = new Date(`${to}T00:00:00+07:00`);
        d.setUTCDate(d.getUTCDate() + 1);
        where.tanggal.lt = d;
      }
    }
    const kata = String(q || "").trim();
    if (kata) {
      where.OR = [
        { tujuan: { contains: kata, mode: "insensitive" } },
        { penerima: { contains: kata, mode: "insensitive" } },
        { jenisBarang: { contains: kata, mode: "insensitive" } },
        { customer: { nama: { contains: kata, mode: "insensitive" } } },
      ];
    }

    const sjs =
      sumber === "manual"
        ? []
        : await prisma.suratJalan.findMany({
            where,
            select: { id: true, no: true, tanggal: true, noPolisi: true, m3: true, panjang: true, lebar: true, tinggi: true },
            orderBy: [{ tanggal: "asc" }, { no: "asc" }],
          });

    const byNopol = new Map(); // nopol -> Map("tgl|kub" -> baris)
    let tanpaKubikasi = 0;
    for (const sj of sjs) {
      const nopol = normNopol(sj.noPolisi) || "(Tanpa No. Polisi)";
      let kub = Number(sj.m3) || 0;
      if (!(kub > 0)) kub = r3((Number(sj.panjang) || 0) * (Number(sj.lebar) || 0) * (Number(sj.tinggi) || 0));
      let pakaiDefault = false;
      if (!(kub > 0)) {
        kub = kubDefault;
        pakaiDefault = true;
        tanpaKubikasi++;
      }
      kub = r3(kub);
      const tgl = tglKey(sj.tanggal);
      const rows = byNopol.get(nopol) || new Map();
      const key = `${tgl}|${kub}`;
      const row = rows.get(key) || { tanggal: tgl, ritase: 0, kubikasi: kub, total: 0, noSJ: [], pakaiDefault: false };
      row.ritase += 1;
      row.total = r3(row.total + kub);
      row.noSJ.push(sj.no);
      if (pakaiDefault) row.pakaiDefault = true;
      rows.set(key, row);
      byNopol.set(nopol, rows);
    }

    // Ritase input manual (digabung ke baris yang tanggal + kubikasinya sama)
    let jumlahManual = 0;
    if (sumber !== "sj") {
      const manual = manualFilter((await bacaManual()).filter((e) => !e.customerId || allowed.has(e.customerId)), {
        customerId: customerId ? String(customerId) : "",
        from,
        to,
      });
      for (const e of manual) {
        let kub = Number(e.kubikasi) || 0;
        let pakaiDefault = false;
        if (!(kub > 0)) {
          kub = kubDefault;
          pakaiDefault = true;
          tanpaKubikasi += e.ritase;
        }
        kub = r3(kub);
        const rows = byNopol.get(e.noPolisi) || new Map();
        const key = `${e.tanggal}|${kub}`;
        const row = rows.get(key) || { tanggal: e.tanggal, ritase: 0, kubikasi: kub, total: 0, noSJ: [], pakaiDefault: false };
        row.ritase += e.ritase;
        row.total = r3(row.total + kub * e.ritase);
        row.manualRitase = (row.manualRitase || 0) + e.ritase;
        if (pakaiDefault) row.pakaiDefault = true;
        rows.set(key, row);
        byNopol.set(e.noPolisi, rows);
        jumlahManual += e.ritase;
      }
    }

    const groups = [...byNopol.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([noPolisi, rows]) => {
        const list = [...rows.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.kubikasi - b.kubikasi);
        return {
          noPolisi,
          rows: list,
          totalRitase: list.reduce((s, r) => s + r.ritase, 0),
          totalKubikasi: r3(list.reduce((s, r) => s + r.total, 0)),
        };
      });

    res.json({
      groups,
      summary: {
        jumlahNopol: groups.length,
        totalRitase: groups.reduce((s, g) => s + g.totalRitase, 0),
        totalKubikasi: r3(groups.reduce((s, g) => s + g.totalKubikasi, 0)),
        tanpaKubikasi,
        ritaseManual: jumlahManual,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Sinkron Rekap Penjualan dari Surat Jalan.
// Rekap Penjualan sebelumnya hanya terisi saat invoice dibuat/diimpor, jadi SJ
// yang belum masuk invoice (atau SJ yang dibuat manual) tidak pernah muncul.
// Endpoint ini membuat baris rekap untuk SJ (non-draft, punya customer) yang
// belum punya baris rekap (cek: customer + nomor SJ). Tidak menimpa / menghapus
// baris yang sudah ada. Harga diambil dari master harga customer kalau ketemu.
//   POST /api/rekap-penjualan/sinkron  { customerId?, bulan? | from?, to? }
// ---------------------------------------------------------------------------
router.post("/sinkron", async (req, res, next) => {
  try {
    const { customerId } = req.body || {};
    const allowed = await allowedSet(req);
    if (customerId && !allowed.has(String(customerId))) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }
    const tgl = tanggalWhere(req.body || {});
    const sjs = await prisma.suratJalan.findMany({
      where: {
        ...scopeDivisi(req),
        isDraft: false,
        customerId: customerId ? String(customerId) : { in: [...allowed] },
        ...(tgl ? { tanggal: tgl } : {}),
      },
      include: { armada: true, sopirRef: true },
      orderBy: [{ tanggal: "asc" }, { no: "asc" }],
    });
    if (!sjs.length) return res.json({ ok: true, dibuat: 0, dilewati: 0, tanpaHarga: 0 });

    const existing = await prisma.rekapPenjualan.findMany({
      where: { customerId: { in: [...new Set(sjs.map((s) => s.customerId))] }, noSuratJalan: { in: sjs.map((s) => s.no) } },
      select: { customerId: true, noSuratJalan: true },
    });
    const sudah = new Set(existing.map((r) => `${r.customerId}|${r.noSuratJalan}`));
    const pricesCache = new Map();

    let dibuat = 0, dilewati = 0, tanpaHarga = 0;
    for (const sj of sjs) {
      if (sudah.has(`${sj.customerId}|${sj.no}`)) { dilewati++; continue; }
      if (!pricesCache.has(sj.customerId)) {
        pricesCache.set(sj.customerId, await prisma.customerPrice.findMany({ where: { customerId: sj.customerId } }));
      }
      const hit = cariHargaCustomer(pricesCache.get(sj.customerId), sj);
      const harga = hit ? Number(hit.harga) || 0 : 0;
      if (!hit) tanpaHarga++;
      const p = Number(sj.panjang) || 0, l = Number(sj.lebar) || 0, t = Number(sj.tinggi) || 0;
      const m3 = Number(sj.m3) || r3(p * l * t);
      await prisma.rekapPenjualan.create({
        data: {
          customerId: sj.customerId,
          tanggal: sj.tanggal,
          noSuratJalan: sj.no,
          noPolisi: sj.noPolisi || "-",
          jenisBarang: sj.jenisBarang || "-",
          panjang: p,
          lebar: l,
          tinggi: t,
          jumlah: m3,
          harga,
          total: r3(m3 * harga),
        },
      });
      sudah.add(`${sj.customerId}|${sj.no}`);
      dibuat++;
    }
    res.json({ ok: true, dibuat, dilewati, tanpaHarga });
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