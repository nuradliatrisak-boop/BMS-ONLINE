import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { aiAktif, geminiGenerate } from "../services/gemini.js";
import { petakanOtomatis } from "../services/poSuratJalan.js";
import { ringkasPo } from "./po.js";
import { buatLaporanCustomer } from "./laporanCustomer.js";

// AI ASSIST -- tanya jawab soal fitur & data (pemasukan / pengeluaran / piutang / PO).
// AI TIDAK diberi akses database langsung. Ia hanya boleh memanggil "alat" baca-saja di bawah;
// hasil tiap alat dibatasi sesuai hak akses user (staf = divisinya sendiri; laporan per
// customer hanya ADMIN). Tidak ada alat yang menulis / mengubah data.
const router = Router();

const PANDUAN = `Kamu adalah "BMS Assist", asisten di aplikasi BMS milik PT Bintang Muara Sejati (usaha material/tambang: divisi Supplier, Armada, Alat Berat, Kontraktor, Kapal). Jawab dalam Bahasa Indonesia yang singkat, jelas, santai-sopan. Untuk angka/data WAJIB pakai alat yang tersedia, jangan menebak; kalau alat tidak mengembalikan data, katakan apa adanya. Tulis rupiah seperti "Rp 106.450.000". Kamu hanya bisa MELIHAT data, tidak bisa mengubah; kalau user minta mengubah data, jelaskan langkah lewat menu yang tepat.

PANDUAN MENU:
- Customer: master customer, harga per customer, daftar penerima.
- Surat Jalan: catat pengiriman material; filter tanggal & scan kamera. Invoice: tagih Surat Jalan ke customer, ada pembayaran, impor Excel, scan kamera.
- Purchase Order (PO): pesanan customer; terkirim/sisa dihitung dari Surat Jalan atau catatan pengiriman manual. Tiap pengiriman punya kolom "Upah Kuli" (otomatis masuk Laporan Divisi > Pengeluaran, kategori "Upah Kuli"). Tombol Excel/PDF membuat kartu stok keluar PO (No, Tanggal, No Surat, Qty, Total sisa, Upah Kuli).
- Proyek Kontraktor: rekap per proyek (tagihan, pembayaran, HPP/pengeluaran, diskon, margin).
- Laporan Divisi: laba rugi per divisi per bulan; baris "Invoice (Sistem)" otomatis dari invoice divisi itu. Cetak Excel/PDF.
- Laporan per Customer (khusus admin): per customer tagihan, dibayar, sisa, potongan, pengeluaran, hasil bersih, rekapan -> invoice -> detail; cetak Excel/PDF (versi untuk customer tanpa angka internal, atau versi internal).
- Laporan Net (admin): penjualan dikurangi potongan per invoice.
- Menu Impor: (1) rekapan/invoice dari Excel; (2) rekapan/invoice dari PDF atau foto (dibaca AI); (3) progres PO dari Excel rekapan ala alexander.xls; (4) stok keluar PO dari Excel (No, Tanggal, No Surat, Qty, Total, Upah Kuli).
- Rumus: Hasil bersih customer = Tagihan - Potongan invoice - HPP proyek - Upah kuli - Diskon. Sisa tagihan = Tagihan - Dibayar.`;

const num = (v) => Number(v || 0);
const rp = (n) => Math.round(n);
const tgl = (d) => new Date(d).toISOString().slice(0, 10);
const DIVISI_SEMUA = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const TOOLS = [
  { name: "ringkasan_divisi", description: "Ringkasan pemasukan, pengeluaran, dan laba satu bulan untuk 1 divisi atau semua divisi (sama dengan Laporan Divisi).",
    parameters: { type: "OBJECT", properties: { bulan: { type: "STRING", description: "YYYY-MM, mis. 2026-10" }, divisi: { type: "STRING", description: "Supplier / Armada / Alat Berat / Kontraktor / Kapal. Kosong = semua" } }, required: ["bulan"] } },
  { name: "piutang_customer", description: "Sisa tagihan (belum dibayar) per customer. Kosongkan nama untuk daftar sisa terbesar.",
    parameters: { type: "OBJECT", properties: { nama: { type: "STRING", description: "Sebagian nama customer (opsional)" } } } },
  { name: "cari_invoice", description: "Cari invoice lewat nomor invoice, nomor rekapan, atau nama customer (maks 10 terbaru).",
    parameters: { type: "OBJECT", properties: { q: { type: "STRING" } }, required: ["q"] } },
  { name: "status_po", description: "Status Purchase Order: dipesan, terkirim, sisa per barang, total upah kuli. Cari lewat nomor PO, customer, atau proyek. Kosong = PO yang masih terbuka.",
    parameters: { type: "OBJECT", properties: { q: { type: "STRING" } } } },
  { name: "laporan_customer", description: "Laporan per customer (khusus admin): tagihan, dibayar, sisa, potongan, HPP proyek, upah kuli, diskon, hasil bersih.",
    parameters: { type: "OBJECT", properties: { nama: { type: "STRING" }, dari: { type: "STRING", description: "YYYY-MM-DD" }, sampai: { type: "STRING", description: "YYYY-MM-DD" }, divisi: { type: "STRING" } } } },
];

async function jalankanAlat(nama, a, req) {
  const admin = req.user.role === "ADMIN";
  const scope = scopeDivisi(req);

  if (nama === "ringkasan_divisi") {
    const bulan = String(a.bulan || "");
    if (!/^\d{4}-\d{2}$/.test(bulan)) return { error: "bulan harus YYYY-MM" };
    const awal = new Date(`${bulan}-01T00:00:00.000Z`);
    const akhir = new Date(awal);
    akhir.setUTCMonth(akhir.getUTCMonth() + 1);
    const divisiList = admin ? (a.divisi ? [String(a.divisi)] : DIVISI_SEMUA) : [req.user.divisi];
    const out = [];
    for (const divisi of divisiList) {
      const inv = await prisma.invoice.findMany({ where: { divisi, tanggal: { gte: awal, lt: akhir } }, include: { items: true } });
      const invoiceSistem = inv.reduce((s, i) => s + i.items.reduce((x, it) => x + num(it.qty) * num(it.hargaSatuan), 0), 0);
      const tx = await prisma.divisiTx.findMany({ where: { divisi, tanggal: { gte: awal, lt: akhir } } });
      const jual = tx.filter((t) => t.tipe === "PENJUALAN").reduce((s, t) => s + t.nominal, 0);
      const keluar = tx.filter((t) => t.tipe === "PENGELUARAN").reduce((s, t) => s + t.nominal, 0);
      out.push({ divisi, invoiceSistem: rp(invoiceSistem), penjualanDicatat: rp(jual), totalPemasukan: rp(invoiceSistem + jual), totalPengeluaran: rp(keluar), laba: rp(invoiceSistem + jual - keluar) });
    }
    return { bulan, divisi: out };
  }

  if (nama === "piutang_customer") {
    const lap = await buatLaporanCustomer({ scope, detail: false });
    let rows = lap.rows.filter((r) => r.sisa > 0.5);
    if (a.nama) rows = rows.filter((r) => r.customer.toLowerCase().includes(String(a.nama).toLowerCase()));
    rows.sort((x, y) => y.sisa - x.sisa);
    return { totalSisa: rp(rows.reduce((s, r) => s + r.sisa, 0)), customer: rows.slice(0, 15).map((r) => ({ customer: r.customer, tagihan: rp(r.tagihan), dibayar: rp(r.dibayar), sisa: rp(r.sisa), invoice: r.jumlahInvoice })) };
  }

  if (nama === "cari_invoice") {
    const q = String(a.q || "").trim();
    if (!q) return { error: "q kosong" };
    const list = await prisma.invoice.findMany({
      where: { ...scope, OR: [{ no: { contains: q, mode: "insensitive" } }, { noRekap: { contains: q, mode: "insensitive" } }, { customer: { nama: { contains: q, mode: "insensitive" } } }] },
      include: { customer: { select: { nama: true } }, items: true, pembayaran: true }, orderBy: { tanggal: "desc" }, take: 10,
    });
    return { invoice: list.map((i) => {
      const total = i.items.reduce((s, it) => s + num(it.qty) * num(it.hargaSatuan), 0);
      const dibayar = i.pembayaran.reduce((s, p) => s + num(p.nominal), 0);
      return { no: i.no, noRekap: i.noRekap, customer: i.customer?.nama, divisi: i.divisi, tanggal: tgl(i.tanggal), status: i.status, total: rp(total), dibayar: rp(dibayar), sisa: rp(total - dibayar), jumlahBaris: i.items.length };
    }) };
  }

  if (nama === "status_po") {
    const q = String(a.q || "").trim();
    const list = await prisma.purchaseOrder.findMany({
      where: { ...scope, batal: false, ...(q ? { OR: [{ no: { contains: q, mode: "insensitive" } }, { proyek: { contains: q, mode: "insensitive" } }, { namaCustomer: { contains: q, mode: "insensitive" } }, { customer: { nama: { contains: q, mode: "insensitive" } } }] } : {}) },
      include: { customer: { select: { id: true, nama: true } }, items: true, pengiriman: true }, orderBy: { tanggal: "desc" }, take: q ? 8 : 40,
    });
    const peta = await petakanOtomatis(list);
    let hasil = list.map((po) => ringkasPo(po, peta.get(po.id)));
    if (!q) hasil = hasil.filter((p) => p.status !== "SELESAI").slice(0, 10);
    return { po: hasil.map((p) => ({ no: p.no, customer: p.namaCustomerTampil, proyek: p.proyek, status: p.status, persenTerkirim: p.persen, hariMenunggu: p.hariTunggu, totalUpahKuli: rp(p.totalUpahKuli || 0), barang: p.items.map((i) => ({ uraian: i.uraian, satuan: i.satuan, dipesan: i.qty, terkirim: i.terkirim, sisa: i.sisa })) })) };
  }

  if (nama === "laporan_customer") {
    if (!admin) return { error: "Laporan per customer hanya untuk admin" };
    const lap = await buatLaporanCustomer({ divisi: a.divisi, dari: a.dari, sampai: a.sampai, scope: {} });
    let rows = lap.rows;
    if (a.nama) rows = rows.filter((r) => r.customer.toLowerCase().includes(String(a.nama).toLowerCase()));
    const pilih = (r) => ({ customer: r.customer, invoice: r.jumlahInvoice, tagihan: r.tagihan, dibayar: r.dibayar, sisa: r.sisa, potonganInvoice: r.potonganInvoice, hppProyek: r.hppProyek, upahKuli: r.upahKuli, diskon: r.diskon, bersih: r.bersih });
    return { rentang: { dari: a.dari || null, sampai: a.sampai || null }, customer: rows.slice(0, 15).map(pilih), total: a.nama ? undefined : lap.total };
  }
  return { error: `alat ${nama} tidak dikenal` };
}

router.get("/config", (req, res) => res.json({ aktif: aiAktif() }));

// body: { pertanyaan, riwayat?: [{ role: "user"|"model", text }] }
router.post("/tanya", async (req, res, next) => {
  try {
    const pertanyaan = String(req.body?.pertanyaan || "").trim().slice(0, 1000);
    if (!pertanyaan) return res.status(400).json({ error: "Pertanyaan kosong" });
    const riwayat = (Array.isArray(req.body?.riwayat) ? req.body.riwayat : [])
      .slice(-8).filter((m) => (m.role === "user" || m.role === "model") && m.text)
      .map((m) => ({ role: m.role, parts: [{ text: String(m.text).slice(0, 2000) }] }));
    const hariIni = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const contents = [...riwayat, { role: "user", parts: [{ text: pertanyaan }] }];
    const systemInstruction = { parts: [{ text: `${PANDUAN}\n\nHari ini ${hariIni}. User: ${req.user.username} (${req.user.role === "ADMIN" ? "admin, boleh lihat semua divisi" : "staf divisi " + req.user.divisi}).` }] };

    for (let putaran = 0; putaran < 5; putaran++) {
      const content = await geminiGenerate({ systemInstruction, contents, tools: [{ functionDeclarations: TOOLS }], generationConfig: { temperature: 0.2 } });
      const panggilan = content.parts.filter((p) => p.functionCall);
      if (!panggilan.length) {
        const jawaban = content.parts.map((p) => p.text || "").join("").trim();
        return res.json({ jawaban: jawaban || "Maaf, saya belum bisa menjawab itu." });
      }
      contents.push({ role: "model", parts: content.parts });
      const balasan = [];
      for (const p of panggilan) {
        let hasil;
        try {
          hasil = await jalankanAlat(p.functionCall.name, p.functionCall.args || {}, req);
        } catch (e) {
          console.error("[ai-assist] alat gagal:", p.functionCall.name, e.message);
          hasil = { error: "Data tidak bisa diambil saat ini" };
        }
        balasan.push({ functionResponse: { name: p.functionCall.name, response: { hasil } } });
      }
      contents.push({ role: "user", parts: balasan });
    }
    res.json({ jawaban: "Pertanyaannya terlalu rumit untuk sekali jawab. Coba dipecah jadi pertanyaan yang lebih spesifik." });
  } catch (e) {
    next(e);
  }
});

export default router;
