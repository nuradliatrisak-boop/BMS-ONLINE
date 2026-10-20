import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

// LAPORAN PER CUSTOMER (internal, hanya ADMIN -- dipasang di index.js)
//   Tagihan = jumlah (qty x harga) baris invoice; Dibayar = jumlah pembayaran; Sisa = Tagihan - Dibayar
//   Pengeluaran: Potongan invoice (belanja pasir+uang mobil+uang jalan+komisi+uang makan),
//                HPP proyek (HPP - Potongan HPP), Upah kuli (PoPengiriman.upahKuli), Diskon
//   Bersih = Tagihan - Potongan invoice - HPP proyek - Upah kuli - Diskon
// Proyek / PO tanpa customer master tidak ikut (tidak bisa dikaitkan ke 1 customer).
// Query: ?dari=&sampai=&divisi=&customerId=&detail=1 (detail = invoice + item + pembayaran).
const router = Router();

const POS = ["belanjaPasir", "uangMobil", "uangJalan", "uangKomisi", "uangMakan"];
const n = (v) => Number(v || 0);
const r2 = (x) => Math.round(x * 100) / 100;
const tglDate = (v, akhir = false) => {
  const s = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (akhir) d.setUTCDate(d.getUTCDate() + 1);
  return d;
};
const KUNCI = ["tagihan", "dibayar", "sisa", "potonganInvoice", "hppProyek", "upahKuli", "diskon", "totalPengeluaran", "bersih"];

function kosong(c) {
  return { customerId: c.id, kode: c.kode, customer: c.nama, jumlahInvoice: 0, tagihan: 0, dibayar: 0, sisa: 0, potonganInvoice: 0, hppProyek: 0, upahKuli: 0, diskon: 0, totalPengeluaran: 0, bersih: 0, persenBersih: 0 };
}

// opsi: { divisi?, customerId?, dari?, sampai?, detail?, scope? }  (scope = filter divisi staf, {} untuk admin)
export async function buatLaporanCustomer(opsi) {
  const { divisi, customerId } = opsi;
  const dari = tglDate(opsi.dari);
  const sampai = tglDate(opsi.sampai, true);
  const rentang = dari || sampai ? { ...(dari ? { gte: dari } : {}), ...(sampai ? { lt: sampai } : {}) } : null;
  const scope = { ...(opsi.scope || {}), ...(divisi ? { divisi: String(divisi) } : {}) };
  const detail = !!opsi.detail;

  const invoices = await prisma.invoice.findMany({
    where: { ...scope, ...(customerId ? { customerId: String(customerId) } : {}), ...(rentang ? { tanggal: rentang } : {}) },
    include: { customer: { select: { id: true, kode: true, nama: true } }, items: true, pembayaran: true },
    orderBy: [{ tanggal: "asc" }, { no: "asc" }],
  });

  const peta = new Map();
  const ambil = (c) => {
    if (!peta.has(c.id)) peta.set(c.id, { ...kosong(c), invoices: [] });
    return peta.get(c.id);
  };

  for (const inv of invoices) {
    const row = ambil(inv.customer);
    let total = 0, potongan = 0;
    for (const it of inv.items) {
      total += n(it.qty) * n(it.hargaSatuan);
      for (const k of POS) potongan += n(it[k]);
    }
    const dibayar = inv.pembayaran.reduce((s, p) => s + n(p.nominal), 0);
    row.jumlahInvoice += 1;
    row.tagihan += total;
    row.dibayar += dibayar;
    row.potonganInvoice += potongan;
    row.invoices.push({
      id: inv.id, no: inv.no, noRekap: inv.noRekap, divisi: inv.divisi, tanggal: inv.tanggal, status: inv.status,
      total, dibayar, sisa: total - dibayar, potongan,
      ...(detail
        ? {
            items: inv.items.map((it) => ({ keterangan: it.keterangan, tglPakai: it.tglPakai, qty: it.qty, satuan: it.satuan, hargaSatuan: it.hargaSatuan, jumlah: n(it.qty) * n(it.hargaSatuan) })),
            pembayaran: inv.pembayaran.slice().sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal)).map((p) => ({ tanggal: p.tanggal, nominal: p.nominal, metode: p.metode })),
          }
        : {}),
    });
  }

  const biaya = await prisma.proyekBiaya.findMany({
    where: { proyek: { ...scope, customerId: customerId ? String(customerId) : { not: null } }, ...(rentang ? { tanggal: rentang } : {}) },
    include: { proyek: { select: { customer: { select: { id: true, kode: true, nama: true } } } } },
  });
  for (const b of biaya) {
    const row = ambil(b.proyek.customer);
    if (b.jenis === "HPP") row.hppProyek += b.nominal;
    else if (b.jenis === "POTONGAN_HPP") row.hppProyek -= b.nominal;
    else if (b.jenis === "DISKON") row.diskon += b.nominal;
  }

  const kuli = await prisma.poPengiriman.findMany({
    where: { upahKuli: { gt: 0 }, po: { ...scope, batal: false, customerId: customerId ? String(customerId) : { not: null } }, ...(rentang ? { tanggal: rentang } : {}) },
    include: { po: { select: { customer: { select: { id: true, kode: true, nama: true } } } } },
  });
  for (const k of kuli) ambil(k.po.customer).upahKuli += k.upahKuli;

  const rows = [...peta.values()].map((r) => {
    r.sisa = r.tagihan - r.dibayar;
    r.totalPengeluaran = r.potonganInvoice + r.hppProyek + r.upahKuli;
    r.bersih = r.tagihan - r.totalPengeluaran - r.diskon;
    r.persenBersih = r.tagihan > 0 ? r2((r.bersih / r.tagihan) * 100) : 0;
    for (const k of KUNCI) r[k] = r2(r[k]);
    const grup = new Map();
    for (const inv of r.invoices) {
      const k = inv.noRekap || "";
      if (!grup.has(k)) grup.set(k, { noRekap: k, tagihan: 0, dibayar: 0, sisa: 0, invoices: [] });
      const g = grup.get(k);
      g.tagihan += inv.total; g.dibayar += inv.dibayar; g.sisa += inv.sisa; g.invoices.push(inv);
    }
    r.rekap = [...grup.values()];
    return r;
  });
  rows.sort((a, b) => b.tagihan - a.tagihan || a.customer.localeCompare(b.customer));

  const total = kosong({ id: null, kode: "", nama: "TOTAL" });
  for (const r of rows) for (const k of ["jumlahInvoice", ...KUNCI]) total[k] += r[k];
  total.persenBersih = total.tagihan > 0 ? r2((total.bersih / total.tagihan) * 100) : 0;
  return { dari: opsi.dari || null, sampai: opsi.sampai || null, divisi: divisi || null, total, rows };
}

router.get("/", async (req, res, next) => {
  try {
    res.json(await buatLaporanCustomer({ divisi: req.query.divisi, customerId: req.query.customerId, dari: req.query.dari, sampai: req.query.sampai, detail: req.query.detail === "1", scope: scopeDivisi(req) }));
  } catch (e) {
    next(e);
  }
});

export default router;
