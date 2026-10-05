import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

// =============================================================================
// SCAN KAMERA: Surat Jalan & Invoice kertas -> data di sistem
//
// Alur:
//   1. HP memotret kertas, OCR (pembacaan teks) jalan di browser HP -- gratis,
//      foto tidak lewat server. (Opsional: kalau GEMINI_API_KEY diisi, foto
//      dikirim ke /ai-extract supaya dibaca AI Gemini yang lebih akurat.)
//   2. Admin memeriksa/mengoreksi hasil bacaan di layar HP.
//   3. Endpoint di bawah menyimpan hasil yang sudah dicek:
//        POST /api/scan/surat-jalan       -> 1 Surat Jalan (nomor SESUAI KERTAS)
//        POST /api/scan/invoice/preview   -> cocokkan baris invoice ke SJ yang sudah ada
//        POST /api/scan/invoice           -> Invoice + SJ + (opsional) Rekap Penjualan
//
// Tidak ada tabel/migrasi baru: semuanya memakai tabel yang sudah ada.
// =============================================================================

const router = Router();

const r3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
const digitsOnly = (s) => String(s || "").replace(/\D/g, "");
const stripZero = (s) => digitsOnly(s).replace(/^0+/, "");
const normNopol = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function divisiFor(req, divisi) {
  // Staf hanya boleh menyimpan ke divisinya sendiri; admin bebas.
  if (req.user?.role === "ADMIN") return divisi;
  return req.user?.divisi || divisi;
}

// Dipakai UI untuk menampilkan pilihan "Pakai AI"
router.get("/config", (req, res) => {
  res.json({
    ai: !!process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_API_KEY ? process.env.GEMINI_MODEL || "gemini-flash-latest" : null,
  });
});

// ---------------------------------------------------------------------------
// OPSIONAL: baca foto pakai Gemini (ada paket gratis di Google AI Studio).
// Aktif hanya kalau env GEMINI_API_KEY diisi. Catatan privasi: di paket
// gratis, Google boleh memakai isi foto untuk memperbaiki produknya.
// ---------------------------------------------------------------------------
const PROMPT_SJ = `Ini foto kertas SURAT JALAN (cetak dot-matrix, PT Bintang Muara Sejati). Baca isinya dan balas HANYA JSON dengan kunci persis:
{"no":"nomor di kanan atas, mis. BM-002096","tanggal":"YYYY-MM-DD","jam":"HH:MM:SS atau kosong","dari":"isi A/P Dari","penerima":"isi Penerima","tujuan":"isi Tujuan (tanpa nomor telepon)","jenisBarang":"isi Jenis Brg","noPolisi":"isi kolom Nomor Polisi, kosong jika tidak ada","panjang":0,"lebar":0,"tinggi":0,"m3":0}
Aturan: panjang/lebar/tinggi diambil dari kolom Ukuran Bak (tiga angka dipisah tanda -), m3 dari kolom M3. Angka berupa number (titik desimal). Abaikan tulisan tangan, coretan, dan stempel. Jika tidak terbaca jelas, isi "" atau 0 -- JANGAN menebak.`;

const PROMPT_INV = `Ini foto kertas INVOICE (cetak dot-matrix, PT Bintang Muara Sejati). Baca isinya dan balas HANYA JSON dengan kunci persis:
{"no":"No. Invoice","tanggal":"YYYY-MM-DD","halaman":1,"kodeCustomer":"","namaCustomer":"","alamat":"alamat customer di header","rows":[{"tglKirim":"YYYY-MM-DD","noSJ":"No SJ tanpa awalan, mis. 002096","kode":"kode setelah no SJ mis. BB atau BS, kosong jika tidak ada","alamat":"Alamat Kirim","panjang":0,"lebar":0,"tinggi":0,"m3":0,"harga":0,"jumlah":0}],"totalM3":0,"totalTagihan":0}
Aturan: satu objek per baris tabel (No 1,2,3,...). Angka berupa number tanpa pemisah ribuan (harga 445000, jumlah 2285965; P/L/T/m3 pakai titik desimal). totalTagihan dari "Jumlah Total Tagihan". Abaikan tulisan tangan, coretan, lingkaran/kotak spidol, dan stempel. Jika tidak terbaca jelas, isi "" atau 0 -- JANGAN menebak.`;

let _kodeCache = { at: 0, txt: "" };
async function daftarKodeBarang() {
  // di-cache 60 detik supaya tiap foto tidak perlu query DB lagi
  if (Date.now() - _kodeCache.at < 60000) return _kodeCache.txt;
  try {
    const list = await prisma.stockMaster.findMany({ where: { aktif: true }, orderBy: { kode: "asc" } });
    const txt = !list.length
      ? ""
      : `\nDaftar kode barang resmi (KODE=NAMA): ${list.map((x) => `${x.kode}=${x.nama}`).join("; ")}. Untuk "jenisBarang"/"kode", salin nama dan kode persis seperti tercetak di kertas; daftar ini hanya untuk membantu membaca huruf yang kabur.`;
    _kodeCache = { at: Date.now(), txt };
    return txt;
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Urutan model yang dicoba. Kalau model pertama sibuk (503) / kuotanya habis (429),
// otomatis pindah ke model berikutnya -- ini penyebab utama popup "AI gagal" sebelumnya.
function daftarModel() {
  const utama = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const cadangan = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.5-flash-lite")
    .split(",").map((x) => x.trim()).filter(Boolean);
  return [...new Set([utama, ...cadangan])];
}

// Satu panggilan ke satu model. Mengembalikan { ok, status, json, detail }.
async function panggilGemini(model, key, parts, tanpaThinking) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const generationConfig = { temperature: 0, responseMimeType: "application/json" };
    // Matikan "thinking" supaya jauh lebih cepat (baca dokumen tidak perlu berpikir panjang)
    if (!tanpaThinking && /2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
      }
    );
    if (r.ok) return { ok: true, status: 200, json: await r.json() };
    let detail = "";
    try { detail = (await r.json())?.error?.message || ""; } catch { /* abaikan */ }
    return { ok: false, status: r.status, detail };
  } catch (e) {
    return { ok: false, status: e.name === "AbortError" ? 504 : 0, detail: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function geminiExtract(tipe, dataUrl) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw httpError(501, "AI belum diaktifkan di server (GEMINI_API_KEY belum diisi)");

  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) throw httpError(400, "Format gambar tidak valid");

  const parts = [
    { text: (tipe === "INVOICE" ? PROMPT_INV : PROMPT_SJ) + (await daftarKodeBarang()) },
    { inline_data: { mime_type: m[1], data: m[2] } },
  ];

  let terakhir = null;
  for (const model of daftarModel()) {
    // tiap model: maksimal 2 kali coba untuk error sementara (429/5xx/timeout)
    for (let coba = 0; coba < 2; coba++) {
      let r = await panggilGemini(model, key, parts, false);
      // beberapa model menolak thinkingConfig -> ulangi tanpa itu
      if (!r.ok && r.status === 400 && /thinking/i.test(r.detail || "")) r = await panggilGemini(model, key, parts, true);
      if (r.ok) {
        const text = (r.json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
        try {
          return JSON.parse(text.replace(/^```json\s*|```\s*$/g, "").trim());
        } catch {
          terakhir = { status: 502, detail: "jawaban AI tidak bisa dibaca" };
          break; // ganti model
        }
      }
      terakhir = r;
      console.error(`[scan/ai] model=${model} status=${r.status} ${r.detail || ""}`.slice(0, 300));
      const sementara = r.status === 429 || r.status === 0 || r.status === 504 || r.status >= 500;
      if (!sementara) break;          // 400/403/404: percuma diulang di model yang sama
      if (r.status === 429) break;    // kuota model ini habis -> langsung model berikutnya
      await sleep(700 * (coba + 1));
    }
  }

  const st = terakhir?.status;
  if (st === 429) throw httpError(429, "Kuota gratis AI sedang habis, coba lagi sebentar lagi.");
  if (st === 400 || st === 403 || st === 404) throw httpError(502, `AI menolak permintaan (${st}). Cek GEMINI_MODEL / GEMINI_API_KEY. ${terakhir.detail || ""}`.trim());
  if (st === 504) throw httpError(504, "AI terlalu lama merespons");
  throw httpError(502, `AI sedang sibuk (${st || "tidak terhubung"}). ${terakhir?.detail || ""}`.trim());
}

router.post("/ai-extract", async (req, res, next) => {
  try {
    const { tipe, image } = req.body || {};
    if (tipe !== "SJ" && tipe !== "INVOICE") throw httpError(400, "tipe harus SJ atau INVOICE");
    res.json(await geminiExtract(tipe, image));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Cari Surat Jalan di sistem yang cocok dengan sebuah baris invoice.
//  - "ADA"   : nomor SJ sama persis (angka, abaikan awalan BM- / nol di depan)
//  - "SARAN" : nomor beda (OCR salah digit?) tapi ukuran P-L-T sama & tanggal dekat
//  - "BARU"  : tidak ada -> akan dibuatkan SJ baru dari baris invoice
// ---------------------------------------------------------------------------
async function cariSuratJalan(db, req, customerId, row, dipakai) {
  const tgl = row.tglKirim ? new Date(row.tglKirim) : null;
  // SJ hasil scan boleh belum punya customer -> ikut dicari supaya tidak dobel saat invoice discan
  const where = { OR: [{ customerId }, { customerId: null }], isDraft: false, ...scopeDivisi(req) };
  if (tgl && !isNaN(tgl)) {
    const dari = new Date(tgl); dari.setDate(dari.getDate() - 20);
    const sampai = new Date(tgl); sampai.setDate(sampai.getDate() + 20);
    where.tanggal = { gte: dari, lte: sampai };
  }
  const list = await db.suratJalan.findMany({
    where,
    include: { invoiceItems: { include: { invoice: { select: { no: true } } } } },
    orderBy: { tanggal: "asc" },
  });

  const target = stripZero(row.noSJ);
  let hit = target ? list.find((s) => !dipakai.has(s.id) && stripZero(s.no) === target) : null;
  let status = hit ? "ADA" : null;

  if (!hit) {
    const p = Number(row.panjang), l = Number(row.lebar), t = Number(row.tinggi);
    if (p && l && t) {
      const calon = list
        .filter((s) => !dipakai.has(s.id))
        .filter((s) => Math.abs(s.panjang - p) < 0.006 && Math.abs(s.lebar - l) < 0.006 && Math.abs(s.tinggi - t) < 0.006)
        .map((s) => ({ s, d: tgl ? Math.abs(new Date(s.tanggal) - tgl) : 0 }))
        .filter((x) => x.d <= 5 * 86400000)
        .sort((a, b) => a.d - b.d);
      // hanya disarankan kalau calonnya jelas (satu, atau jauh lebih dekat dari yang kedua)
      if (calon.length === 1 || (calon.length > 1 && calon[0].d < calon[1].d)) {
        hit = calon[0].s;
        status = "SARAN";
      }
    }
  }
  return { hit, status: status || "BARU" };
}

function ringkasSj(s) {
  const tertagih = s.invoiceItems?.[0];
  return {
    id: s.id,
    no: s.no,
    tanggal: s.tanggal,
    jenisBarang: s.jenisBarang,
    noPolisi: s.noPolisi,
    tujuan: s.tujuan,
    panjang: s.panjang,
    lebar: s.lebar,
    tinggi: s.tinggi,
    tertagih: !!tertagih,
    invoiceNo: tertagih?.invoice?.no || null,
  };
}

router.post("/invoice/preview", async (req, res, next) => {
  try {
    const { customerId, rows } = req.body || {};
    if (!customerId || !Array.isArray(rows)) throw httpError(400, "customerId dan rows wajib diisi");
    const dipakai = new Set();
    const out = [];
    for (const row of rows) {
      const { hit, status } = await cariSuratJalan(prisma, req, customerId, row, dipakai);
      if (hit) dipakai.add(hit.id);
      out.push({ status, sj: hit ? ringkasSj(hit) : null });
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Simpan 1 Surat Jalan hasil scan. Nomor = nomor di kertas (mis. "BM-002096")
// supaya cocok dengan nomor yang dicetak di invoice.
// ---------------------------------------------------------------------------
router.post("/surat-jalan", async (req, res, next) => {
  try {
    const b = req.body || {};
    const no = String(b.no || "").trim();
    // Hanya nomor yang wajib (kunci unik). Sisanya boleh kosong: nopol, kubikasi, customer, tujuan, dst.
    if (!no) throw httpError(400, "Nomor surat jalan wajib diisi");

    let tanggal = b.tanggal ? new Date(b.tanggal) : new Date();
    if (isNaN(tanggal)) tanggal = new Date();

    let customer = null;
    if (b.customerId) customer = await prisma.customer.findUnique({ where: { id: b.customerId } });
    const tujuan = String(b.tujuan || b.penerima || customer?.nama || "").trim() || "-";

    const p = Number(b.panjang) || 0, l = Number(b.lebar) || 0, t = Number(b.tinggi) || 0;
    const m3 = r3(p * l * t);

    // Cocokkan no. polisi ke master Armada (kalau ada) supaya laporan armada ikut terisi
    let armadaId = null, sopirId = null, sopirNama = b.sopir || null;
    if (b.noPolisi) {
      const all = await prisma.armada.findMany({ select: { id: true, nopol: true, sopir: true, sopirId: true } });
      const a = all.find((x) => normNopol(x.nopol) === normNopol(b.noPolisi));
      if (a) {
        armadaId = a.id;
        sopirId = a.sopirId || null;
        sopirNama = sopirNama || a.sopir || null;
      }
    }

    const data = {
      divisi: divisiFor(req, b.divisi || "Supplier"),
      customerId: customer ? customer.id : null,
      armadaId,
      tujuan,
      penerima: b.penerima ? String(b.penerima).trim() : null,
      jenisBarang: b.jenisBarang ? String(b.jenisBarang).trim() : null,
      noPolisi: b.noPolisi ? String(b.noPolisi).trim() : null,
      sopir: sopirNama,
      sopirId,
      panjang: p,
      lebar: l,
      tinggi: t,
      m3,
      jam: b.jam || null,
      tanggal,
      isDraft: false,
    };

    const ada = await prisma.suratJalan.findUnique({ where: { no } });
    if (ada && !b.timpa) {
      return res.status(409).json({
        error: `Surat jalan ${no} sudah ada di sistem. Centang "Timpa data lama" lalu simpan lagi kalau mau diperbarui.`,
        exists: true,
        id: ada.id,
      });
    }
    if (ada) {
      if (req.user?.role !== "ADMIN" && ada.divisi !== req.user?.divisi) throw httpError(403, "Tidak punya akses ke surat jalan ini");
      // Timpa hanya mengisi yang terbaca: isian kosong dari scan tidak menghapus data lama
      const upd = {};
      for (const [k, v] of Object.entries(data)) {
        const kosong = v === null || v === "" || v === "-" || v === 0;
        if (!kosong) upd[k] = v;
      }
      if (!(p && l && t)) { delete upd.panjang; delete upd.lebar; delete upd.tinggi; delete upd.m3; }
      const hasil = await prisma.suratJalan.update({ where: { id: ada.id }, data: upd });
      return res.json({ ok: true, diperbarui: true, sj: hasil });
    }
    const sj = await prisma.suratJalan.create({ data: { no, ...data } });
    res.status(201).json({ ok: true, diperbarui: false, sj });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Simpan Invoice hasil scan (+ Surat Jalan yang belum ada + Rekap Penjualan)
// Semua dalam satu transaksi: kalau satu baris gagal, tidak ada yang tersimpan.
// ---------------------------------------------------------------------------
router.post("/invoice", async (req, res, next) => {
  try {
    const b = req.body || {};
    const no = String(b.no || "").trim();
    if (!no) throw httpError(400, "Nomor invoice wajib diisi");
    if (!b.customerId) throw httpError(400, "Customer wajib dipilih");
    if (!b.tanggal) throw httpError(400, "Tanggal invoice wajib diisi");
    if (!b.divisi) throw httpError(400, "Divisi wajib diisi");
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw httpError(400, "Minimal 1 baris invoice");

    const divisi = divisiFor(req, b.divisi);
    const customer = await prisma.customer.findUnique({ where: { id: b.customerId } });
    if (!customer) throw httpError(400, "Customer tidak ditemukan");

    if (await prisma.invoice.findUnique({ where: { no } })) {
      throw httpError(409, `Invoice nomor ${no} sudah ada di sistem.`);
    }

    // nomor SJ dobel dalam satu invoice -> hampir pasti salah baca
    const seen = new Set();
    for (const it of items) {
      const k = stripZero(it.noSJ);
      if (k && seen.has(k)) throw httpError(400, `No SJ ${it.noSJ} muncul dua kali di invoice ini. Periksa lagi.`);
      if (k) seen.add(k);
    }

    const masterList = await prisma.stockMaster.findMany({ select: { kode: true, nama: true } });
    const namaByKode = new Map(masterList.map((x) => [String(x.kode).toUpperCase(), x.nama]));

    const hasil = await prisma.$transaction(
      async (tx) => {
        const dipakai = new Set();
        const itemsData = [];
        const rekapRows = [];
        let sjBaru = 0, sjTertaut = 0;

        for (const it of items) {
          const p = Number(it.panjang) || 0, l = Number(it.lebar) || 0, t = Number(it.tinggi) || 0;
          const harga = Number(it.harga) || 0;
          const m3 = r3(p * l * t);
          if (!(m3 > 0) || !(harga > 0)) {
            throw httpError(400, `Baris SJ ${it.noSJ || "?"}: ukuran (P-L-T) dan harga wajib terisi`);
          }

          // 1) pakai SJ yang dipilih UI; 2) kalau tidak ada, cari sendiri (hanya yang nomornya sama)
          let sj = null;
          if (it.suratJalanId) {
            sj = await tx.suratJalan.findUnique({ where: { id: it.suratJalanId } });
          } else {
            sj = (await cariSuratJalan(tx, req, b.customerId, it, dipakai)).hit;
            if (sj && stripZero(sj.no) !== stripZero(it.noSJ)) sj = null;
          }

          if (sj) {
            if (dipakai.has(sj.id)) throw httpError(400, `Surat jalan ${sj.no} dipakai dua baris`);
            const sudah = await tx.invoiceItem.findFirst({
              where: { suratJalanId: sj.id },
              include: { invoice: { select: { no: true } } },
            });
            if (sudah) throw httpError(409, `Surat jalan ${sj.no} sudah tertagih di invoice ${sudah.invoice.no}`);
            // SJ hasil scan yang customernya/ukurannya masih kosong dilengkapi dari baris invoice
            const lengkapi = {};
            if (!sj.customerId) lengkapi.customerId = b.customerId;
            if (!(sj.panjang && sj.lebar && sj.tinggi) && p && l && t) Object.assign(lengkapi, { panjang: p, lebar: l, tinggi: t, m3 });
            if (!sj.jenisBarang && it.jenisBarang) lengkapi.jenisBarang = String(it.jenisBarang).trim();
            if (Object.keys(lengkapi).length) sj = await tx.suratJalan.update({ where: { id: sj.id }, data: lengkapi });
            sjTertaut++;
          } else {
            const dg = digitsOnly(it.noSJ);
            const noBaru = dg.length >= 3 ? `BM-${dg}` : String(it.noSJ || "").trim();
            if (!noBaru) throw httpError(400, "Ada baris tanpa nomor SJ");
            const kodeBaris = String(it.kode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            const jenis =
              (it.jenisBarang && String(it.jenisBarang).trim()) ||
              (b.jenisDefault ? `${b.jenisDefault}${kodeBaris ? " / " + kodeBaris : ""}` : null) ||
              (namaByKode.has(kodeBaris) ? `${namaByKode.get(kodeBaris)} / ${kodeBaris}` : kodeBaris || null);
            const bentrok = await tx.suratJalan.findUnique({ where: { no: noBaru } });
            if (bentrok) {
              const tertagihLain = await tx.invoiceItem.findFirst({ where: { suratJalanId: bentrok.id }, include: { invoice: { select: { no: true } } } });
              if (tertagihLain) throw httpError(409, `Surat jalan ${noBaru} sudah tertagih di invoice ${tertagihLain.invoice.no}.`);
              if (bentrok.customerId && bentrok.customerId !== b.customerId) {
                throw httpError(409, `Nomor ${noBaru} sudah ada tapi untuk customer lain. Pilih SJ-nya di chip "Mirip SJ" atau ubah nomornya.`);
              }
              sj = await tx.suratJalan.update({
                where: { id: bentrok.id },
                data: {
                  customerId: b.customerId,
                  ...(p && l && t && !(bentrok.panjang && bentrok.lebar && bentrok.tinggi) ? { panjang: p, lebar: l, tinggi: t, m3 } : {}),
                  ...(!bentrok.jenisBarang && jenis ? { jenisBarang: jenis } : {}),
                },
              });
              sjTertaut++;
            } else {
              sj = await tx.suratJalan.create({
                data: {
                  no: noBaru,
                  divisi,
                  customerId: b.customerId,
                  tujuan: String(it.alamat || customer.alamat || customer.nama).trim(),
                  penerima: customer.nama,
                  jenisBarang: jenis,
                  panjang: p,
                  lebar: l,
                  tinggi: t,
                  m3,
                  tanggal: new Date(it.tglKirim || b.tanggal),
                  isDraft: false,
                },
              });
              sjBaru++;
            }
          }
          dipakai.add(sj.id);

          itemsData.push({
            suratJalanId: sj.id,
            keterangan: sj.jenisBarang || sj.tujuan,
            qty: m3,
            satuan: "m3",
            hargaSatuan: harga,
            belanjaPasir: sj.belanjaPasir,
            uangMobil: sj.uangMobil,
            uangJalan: sj.uangJalan,
            uangKomisi: sj.uangKomisi,
          });

          rekapRows.push({
            customerId: b.customerId,
            tanggal: sj.tanggal,
            noSuratJalan: sj.no,
            noPolisi: sj.noPolisi || "-",
            jenisBarang: sj.jenisBarang || "-",
            panjang: p,
            lebar: l,
            tinggi: t,
            jumlah: m3,
            harga,
            total: m3 * harga,
          });
        }

        const invoice = await tx.invoice.create({
          data: {
            no,
            divisi,
            customerId: b.customerId,
            tanggal: new Date(b.tanggal),
            jatuhTempo: b.jatuhTempo ? new Date(b.jatuhTempo) : null,
            halaman: Number(b.halaman) || 1,
            catatan: b.catatan || null,
            items: { create: itemsData },
          },
          include: { items: true },
        });

        let rekapBaru = 0, rekapDilewati = 0;
        if (b.buatRekap !== false) {
          for (const r of rekapRows) {
            const dup = await tx.rekapPenjualan.findFirst({
              where: { customerId: r.customerId, noSuratJalan: r.noSuratJalan },
            });
            if (dup) { rekapDilewati++; continue; }
            await tx.rekapPenjualan.create({ data: r });
            rekapBaru++;
          }
        }

        const total = invoice.items.reduce((s, x) => s + x.qty * x.hargaSatuan, 0);
        return { id: invoice.id, no: invoice.no, total, baris: invoice.items.length, sjBaru, sjTertaut, rekapBaru, rekapDilewati };
      },
      { timeout: 60000, maxWait: 10000 }
    );

    res.status(201).json({ ok: true, ...hasil });
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Nomor invoice / surat jalan bentrok dengan data yang sudah ada. Periksa nomornya." });
    }
    next(e);
  }
});

export default router;