import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { aiAktif, geminiBacaGambar } from "../services/gemini.js";
import { cocokkanBlok } from "../services/imporProgresPo.js";

// MENU IMPOR
//   GET  /api/impor/config               -> apakah pembaca AI (PDF/foto) aktif
//   POST /api/impor/baca-ai              -> baca 1 halaman (gambar) rekapan/invoice pakai AI
//   POST /api/impor/invoice              -> simpan draft invoice/rekapan (dari Excel / PDF) ke sistem
//   POST /api/impor/po-progres/cocokkan  -> cocokkan blok rekapan Excel (ala alexander) ke PO
// Pengiriman PO disimpan lewat POST /api/po/:id/pengiriman/bulk (aman diulang).
const router = Router();

const DIVISI_OK = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const bersih = (v) => { const s = String(v ?? "").trim().replace(/\s+/g, " "); return s || null; };
const tglDate = (v) => {
  const s = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const statusBayar = (total, dibayar) => (dibayar <= 0 ? "BELUM" : dibayar >= total - 0.5 ? "LUNAS" : "SEBAGIAN");
const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");

router.get("/config", (req, res) => res.json({ ai: aiAktif() }));

const PROMPT_DOKUMEN = `Ini foto/scan satu halaman dokumen penagihan PT Bintang Muara Sejati: bisa REKAP INVOICE (daftar beberapa invoice milik satu customer beserta pembayaran) atau INVOICE / REKAPITULASI PENGIRIMAN (daftar baris pengiriman/jasa dengan harga). Baca dan balas HANYA JSON:
{"jenis":"REKAP" atau "INVOICE",
 "customer":"nama customer (dari 'Rekapan Invoice : ...' atau 'Kepada : ...')",
 "noRekap":"nomor rekapan, mis. 002/INV-BMS/X/2026, kosong jika tidak ada",
 "noInvoice":"nomor invoice halaman ini, mis. BMS - SPN. 001 (kosong jika jenis REKAP)",
 "tanggal":"YYYY-MM-DD (tanggal rekap / tanggal invoice)",
 "proyek":"isi baris Proyek bila ada, kosong jika tidak",
 "baris":[ ...lihat bawah... ],
 "totalKertas":0,
 "ragu":[]}
Jika jenis REKAP, tiap baris tabel yang terisi: {"noInvoice":"","tanggal":"YYYY-MM-DD","deskripsi":"","jumlahTagihan":0,"tglPembayaran":"YYYY-MM-DD atau kosong","jumlahPembayaran":0}; totalKertas = angka di baris TOTAL TAGIHAN kolom Jumlah Tagihan.
Jika jenis INVOICE, tiap baris tabel yang terisi (abaikan baris kosong): {"tanggal":"YYYY-MM-DD","noSj":"","kapal":"nama kapal/kendaraan bila ada","keterangan":"isi kolom Jenis Barang & Jasa","qty":0,"satuan":"satuan kolom jumlah mis. BH","harga":0,"jumlah":0}; totalKertas = angka Total Jumlah Tagihan (kolom Jumlah rupiah).
Aturan: angka Indonesia memakai titik ribuan (162.450.000 = 162450000) -> tulis sebagai number tanpa titik. Tanggal "27-Aug-26" -> 2026-08-27; "09/10/2026" -> 2026-10-09 (hari/bulan/tahun). Abaikan tanda tangan, coretan, stempel. Jika tidak terbaca jelas isi ""/0 JANGAN menebak. "ragu": maksimal 5 item {"bidang":"","alasan":""} untuk hal yang kamu tidak yakin.`;

router.post("/baca-ai", async (req, res, next) => {
  try {
    res.json(await geminiBacaGambar(PROMPT_DOKUMEN, req.body?.image));
  } catch (e) {
    next(e);
  }
});

async function kodeBerikutnya() {
  const all = await prisma.customer.findMany({ select: { kode: true } });
  let maks = 0;
  for (const c of all) {
    const m = /(\d+)\s*$/.exec(c.kode || "");
    if (m) maks = Math.max(maks, Number(m[1]));
  }
  return `TS${maks + 1}`;
}

// drafts: [{ no, noRekap?, tanggal, divisi, customerId? | namaCustomer?, proyekNama?, totalKertas?,
//            items:[{ keterangan, tglPakai?, qty, satuan?, hargaSatuan }], pembayaran:[{ tanggal, nominal, metode? }] }]
router.post("/invoice", async (req, res, next) => {
  try {
    const drafts = Array.isArray(req.body?.drafts) ? req.body.drafts : [];
    if (!drafts.length) return res.status(400).json({ error: "Tidak ada invoice untuk disimpan" });
    if (drafts.length > 200) return res.status(400).json({ error: "Maksimal 200 invoice sekali impor" });
    const admin = req.user.role === "ADMIN";
    const hasil = [];

    for (const d of drafts) {
      const no = bersih(d.no);
      const r = { no: no || "(tanpa nomor)", status: "DILEWATI", alasan: "" };
      hasil.push(r);
      try {
        if (!no) { r.alasan = "Nomor invoice kosong"; continue; }
        const tanggal = tglDate(d.tanggal);
        if (!tanggal) { r.alasan = "Tanggal invoice tidak valid"; continue; }
        const divisi = admin ? bersih(d.divisi) : req.user.divisi;
        if (!DIVISI_OK.includes(divisi)) { r.alasan = "Divisi tidak valid"; continue; }
        const items = (Array.isArray(d.items) ? d.items : [])
          .map((i) => ({ keterangan: bersih(i.keterangan), tglPakai: tglDate(i.tglPakai), qty: num(i.qty), satuan: bersih(i.satuan), hargaSatuan: num(i.hargaSatuan) }))
          .filter((i) => i.keterangan && i.qty > 0);
        if (!items.length) { r.alasan = "Tidak ada baris barang/jasa"; continue; }
        const total = items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
        if (d.totalKertas != null && d.totalKertas !== "" && num(d.totalKertas) > 0 && Math.abs(total - num(d.totalKertas)) > 1) {
          r.alasan = `Total hitungan ${rp(total)} beda dengan total di kertas ${rp(num(d.totalKertas))} -- periksa baris/harga`;
          continue;
        }
        if (await prisma.invoice.findUnique({ where: { no } })) { r.status = "SUDAH_ADA"; r.alasan = "Nomor invoice sudah ada"; continue; }

        let customerId = d.customerId ? String(d.customerId) : null;
        if (customerId) {
          if (!(await prisma.customer.findUnique({ where: { id: customerId } }))) { r.alasan = "Customer tidak ditemukan"; continue; }
        } else {
          const nama = bersih(d.namaCustomer);
          if (!nama) { r.alasan = "Customer belum dipilih"; continue; }
          const semua = await prisma.customer.findMany({ select: { id: true, nama: true } });
          const ada = semua.find((c) => key(c.nama) === key(nama));
          if (ada) customerId = ada.id;
          else {
            customerId = (await prisma.customer.create({ data: { kode: await kodeBerikutnya(), nama, divisi } })).id;
            r.customerBaru = nama;
          }
        }

        let proyekId = null;
        const proyekNama = bersih(d.proyekNama);
        if (proyekNama && divisi === "Kontraktor") {
          let p = await prisma.proyekKontraktor.findFirst({ where: { nama: proyekNama, divisi, customerId } });
          if (!p) p = await prisma.proyekKontraktor.create({ data: { nama: proyekNama, divisi, customerId } });
          proyekId = p.id;
        }

        const bayar = (Array.isArray(d.pembayaran) ? d.pembayaran : [])
          .map((p) => ({ tanggal: tglDate(p.tanggal), nominal: num(p.nominal), metode: bersih(p.metode) }))
          .filter((p) => p.tanggal && p.nominal > 0);
        const dibayar = bayar.reduce((s, p) => s + p.nominal, 0);

        await prisma.invoice.create({
          data: { no, divisi, customerId, tanggal, noRekap: bersih(d.noRekap), proyekId, status: statusBayar(total, dibayar), catatan: bersih(d.catatan), items: { create: items }, pembayaran: { create: bayar } },
        });
        r.status = "DISIMPAN";
        r.total = total;
        r.dibayar = dibayar;
      } catch (e) {
        r.alasan = e.message || "Gagal menyimpan";
      }
    }
    res.json({ hasil });
  } catch (e) {
    next(e);
  }
});

router.post("/po-progres/cocokkan", async (req, res, next) => {
  try {
    const bloks = Array.isArray(req.body?.bloks) ? req.body.bloks : [];
    if (!bloks.length) return res.status(400).json({ error: "Tidak ada blok untuk dicocokkan" });
    if (bloks.length > 800) return res.status(400).json({ error: "Maksimal 800 blok sekali proses, persempit rentang tanggal" });
    const poList = await prisma.purchaseOrder.findMany({ where: { batal: false, ...scopeDivisi(req) }, include: { items: true, pengiriman: true } });
    res.json({ hasil: cocokkanBlok(bloks, poList) });
  } catch (e) {
    next(e);
  }
});

export default router;
