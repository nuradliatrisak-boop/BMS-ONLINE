<script setup>
// MENU IMPOR DATA
//  1. Rekapan & Invoice  : dari PDF / foto (dibaca AI) atau Excel rekapan -> invoice + rekapan + pembayaran
//  2. Progres PO         : dari Excel rekapan ala alexander.xls (banyak blok dalam 1 sheet) -> pengiriman PO
//  3. Stok keluar PO     : dari Excel sederhana (No | Tanggal | No Surat | Qty | Total | Upah Kuli)
// Semua langkah: baca -> PERIKSA di layar -> baru Simpan. Aman diulang (data yang sama dilewati).
import { ref, computed, onMounted } from "vue";
import * as XLSX from "xlsx";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { useAuthStore } from "../stores/auth.js";
import MoneyInput from "../components/MoneyInput.vue";
import ImportInvoiceModal from "../components/ImportInvoiceModal.vue";
import { berkasKeGambar } from "../utils/pdfKeGambar.js";
import { bangunDraft, halamanRekapDariAoa } from "../utils/draftImpor.js";
import { parseBlokRekap, ringkasBlok, parseStokKeluar, keTanggal } from "../utils/rekapBlokParser.js";
import { cocokkanCustomer } from "../utils/invoiceImport.js";

const auth = useAuthStore();
const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];
const tab = ref("rekap");
const customers = ref([]);
const aiAktif = ref(false);
const rupiah = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
const angka = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString("id-ID");
const fmtTgl = (t) => { const [y, m, d] = String(t || "").slice(0, 10).split("-"); return y ? `${d}/${m}/${y}` : "-"; };

onMounted(async () => {
  try { customers.value = await api.get("/customers"); } catch { /* opsional */ }
  try { aiAktif.value = (await api.get("/impor/config")).ai; } catch { aiAktif.value = false; }
});

async function bacaExcel(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); // tanpa cellDates: tanggal tetap serial angka (tidak geser zona)
  return wb.SheetNames.map((n) => ({ nama: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }));
}

// =================== 1. REKAPAN & INVOICE ===================
const showModalInvoice = ref(false);
const halamanBaca = ref([]); // hasil bacaan per halaman
const drafts = ref([]);
const membaca = ref(false);
const progresBaca = ref("");
const menyimpan = ref(false);
const hasilSimpan = ref(null);
const gagalBaca = ref([]);

function pasangkanCustomer(list) {
  for (const d of list) {
    const c = cocokkanCustomer(d.namaCustomer, customers.value);
    d.customerId = c ? c.id : "";
  }
}
function susunDraft(halaman) {
  halamanBaca.value = halaman;
  drafts.value = bangunDraft(halaman, "Kontraktor");
  pasangkanCustomer(drafts.value);
  hasilSimpan.value = null;
}

async function pilihBerkasAi(e) {
  const files = [...(e.target.files || [])];
  e.target.value = "";
  if (!files.length) return;
  if (!aiAktif.value) return toast("AI belum aktif di server (isi GEMINI_API_KEY di backend/.env)");
  membaca.value = true;
  gagalBaca.value = [];
  hasilSimpan.value = null;
  try {
    progresBaca.value = "Menyiapkan halaman…";
    const hal = await berkasKeGambar(files);
    if (!hal.length) return toast("Tidak ada PDF / gambar yang bisa dibaca");
    const out = [];
    for (let i = 0; i < hal.length; i++) {
      progresBaca.value = `AI membaca halaman ${i + 1} dari ${hal.length} (${hal[i].nama})…`;
      try {
        const r = await api.post("/impor/baca-ai", { image: hal[i].gambar });
        if (r && (r.jenis === "REKAP" || r.jenis === "INVOICE")) out.push({ ...r, _sumber: `${hal[i].nama} hal. ${hal[i].halaman}` });
        else gagalBaca.value.push(`${hal[i].nama} hal. ${hal[i].halaman}: jenis dokumen tidak dikenali`);
      } catch (err) {
        gagalBaca.value.push(`${hal[i].nama} hal. ${hal[i].halaman}: ${err.message}`);
      }
    }
    susunDraft(out);
    if (!out.length) toast("Tidak ada halaman yang berhasil dibaca");
  } catch (err) {
    toast(err.message || "Gagal membaca berkas");
  } finally {
    membaca.value = false;
    progresBaca.value = "";
  }
}

async function pilihExcelRekap(e) {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  membaca.value = true;
  try {
    const out = [];
    for (const sh of await bacaExcel(f)) {
      const h = halamanRekapDariAoa(sh.aoa);
      if (h) out.push(h);
    }
    if (!out.length) return toast("Format rekapan tidak dikenali. Kolom yang dicari: No. Invoice, Jumlah Tagihan, Tgl Pembayaran, Jumlah Pembayaran");
    susunDraft(out);
  } catch (err) {
    toast(err.message || "Gagal membaca Excel");
  } finally {
    membaca.value = false;
  }
}

const hitungDraft = (d) => d.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.hargaSatuan) || 0), 0);
const bayarDraft = (d) => d.pembayaran.reduce((s, p) => s + (Number(p.nominal) || 0), 0);
const bedaTotal = (d) => d.totalKertas > 0 && Math.abs(hitungDraft(d) - d.totalKertas) > 1;
const jumlahPakai = computed(() => drafts.value.filter((d) => d.pakai).length);

async function simpanDraft() {
  const kirim = drafts.value.filter((d) => d.pakai);
  if (!kirim.length) return toast("Tidak ada invoice yang dipilih");
  menyimpan.value = true;
  try {
    const r = await api.post("/impor/invoice", {
      drafts: kirim.map((d) => ({
        no: d.no, noRekap: d.noRekap, tanggal: d.tanggal, divisi: d.divisi, customerId: d.customerId || null, namaCustomer: d.namaCustomer,
        proyekNama: d.proyekNama, totalKertas: d.totalKertas || null, items: d.items, pembayaran: d.pembayaran,
      })),
    });
    hasilSimpan.value = r.hasil;
    const ok = r.hasil.filter((x) => x.status === "DISIMPAN").length;
    toast(`${ok} invoice disimpan, ${r.hasil.length - ok} dilewati`);
    if (ok === r.hasil.length) drafts.value = [];
    try { customers.value = await api.get("/customers"); } catch { /* abaikan */ }
  } catch (err) {
    toast(err.message || "Gagal menyimpan");
  } finally {
    menyimpan.value = false;
  }
}

// =================== 2. PROGRES PO (Excel ala alexander) ===================
const pad = (n) => String(n).padStart(2, "0");
const kemarin30 = (() => { const d = new Date(Date.now() - 30 * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const bloksSemua = ref([]);
const progDari = ref(kemarin30);
const progSampai = ref("");
const namaFileProg = ref("");
const hasilCocok = ref([]);
const mencocokkan = ref(false);
const menyimpanProg = ref(false);
const laporProg = ref(null);

async function pilihExcelProg(e) {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  membaca.value = true;
  hasilCocok.value = [];
  laporProg.value = null;
  try {
    let semua = [];
    for (const sh of await bacaExcel(f)) semua = semua.concat(parseBlokRekap(sh.aoa).map((b) => ({ ...b, id: `${sh.nama}#${b.id}` })));
    bloksSemua.value = semua;
    namaFileProg.value = f.name;
    if (!semua.length) toast("Tidak ada blok “Rekapan Invoice” di file ini");
  } catch (err) {
    toast(err.message || "Gagal membaca Excel");
  } finally {
    membaca.value = false;
  }
}
const blokTerpilih = computed(() => {
  const out = [];
  for (const b of bloksSemua.value) {
    if (b.layout !== "MATERIAL" || !b.noPo) continue;
    const rows = b.rows.filter((r) => r.tanggal && r.qty > 0 && (!progDari.value || r.tanggal >= progDari.value) && (!progSampai.value || r.tanggal <= progSampai.value));
    if (rows.length) out.push({ ...b, rows });
  }
  return out;
});
const infoProg = computed(() => {
  const lain = bloksSemua.value.filter((b) => b.layout === "LAIN").length;
  const tanpaPo = bloksSemua.value.filter((b) => b.layout === "MATERIAL" && !b.noPo).length;
  return { total: bloksSemua.value.length, lain, tanpaPo };
});

async function cocokkan() {
  if (!blokTerpilih.value.length) return toast("Tidak ada baris pengiriman pada rentang tanggal ini");
  mencocokkan.value = true;
  laporProg.value = null;
  try {
    const r = await api.post("/impor/po-progres/cocokkan", {
      bloks: blokTerpilih.value.map((b) => ({ id: b.id, noPo: b.noPo, rows: b.rows.map((x) => ({ tanggal: x.tanggal, noSj: x.noSj, noPolisi: x.noPolisi, jenis: x.jenis, qty: x.qty })) })),
    });
    const info = new Map(blokTerpilih.value.map((b) => [b.id, b]));
    hasilCocok.value = r.hasil.map((h) => ({
      ...h,
      noInvoice: info.get(h.id)?.noInvoice || "",
      penerima: info.get(h.id)?.penerima || "",
      setuju: h.caraCocok === "PASTI",
      rows: h.rows.filter((x) => x.status !== "KOSONG").map((x) => ({ ...x, pakai: x.status === "BARU", itemPilih: x.itemId || "", upahKuli: "" })),
    }));
  } catch (err) {
    toast(err.message || "Gagal mencocokkan");
  } finally {
    mencocokkan.value = false;
  }
}
function pilihItem(x) {
  x.pakai = !!x.itemPilih;
}
const ringkasCocok = computed(() => {
  const c = { baru: 0, sudah: 0, perlu: 0, tanpaPo: 0 };
  for (const h of hasilCocok.value) for (const x of h.rows) {
    if (x.status === "BARU") c.baru++;
    else if (x.status === "SUDAH_ADA") c.sudah++;
    else if (x.status === "TANPA_PO") c.tanpaPo++;
    else c.perlu++;
  }
  return c;
});
const jumlahSimpanProg = computed(() => hasilCocok.value.reduce((s, h) => s + (h.poId && h.setuju ? h.rows.filter((x) => x.pakai && x.itemPilih).length : 0), 0));

async function simpanProg() {
  const perPo = new Map();
  for (const h of hasilCocok.value) {
    if (!h.poId || !h.setuju) continue;
    for (const x of h.rows) {
      if (!x.pakai || !x.itemPilih) continue;
      if (!perPo.has(h.poId)) perPo.set(h.poId, []);
      perPo.get(h.poId).push({ itemId: x.itemPilih, tanggal: x.tanggal, qty: x.qty, noSuratJalan: x.noSj, catatan: `Excel ${h.noInvoice || ""} ${x.noPolisi || ""}`.trim(), upahKuli: x.upahKuli || null });
    }
  }
  if (!perPo.size) return toast("Tidak ada baris yang dipilih");
  menyimpanProg.value = true;
  const lapor = { dibuat: 0, dilewati: 0, gagal: [] };
  for (const [poId, rows] of perPo) {
    try {
      const r = await api.post(`/po/${poId}/pengiriman/bulk`, { rows });
      lapor.dibuat += r.dibuat;
      lapor.dilewati += r.dilewati;
    } catch (err) {
      lapor.gagal.push(`${hasilCocok.value.find((h) => h.poId === poId)?.poNo}: ${err.message}`);
    }
  }
  menyimpanProg.value = false;
  laporProg.value = lapor;
  toast(`${lapor.dibuat} pengiriman tersimpan`);
  if (!lapor.gagal.length) hasilCocok.value = [];
}

// =================== 3. STOK KELUAR PO (Excel sederhana) ===================
const stok = ref(null); // { judul, rows, namaFile }
const poList = ref([]);
const modeStok = ref("baru"); // "baru" | "ada"
const poPilih = ref("");
const itemPilih = ref("");
const formBaru = ref({ uraian: "", satuan: "BH", qty: 0, customerId: "", namaCustomer: "", proyek: "", divisi: "Kontraktor" });
const menyimpanStok = ref(false);
const laporStok = ref(null);

const poTerpilih = computed(() => poList.value.find((p) => p.id === poPilih.value) || null);
function judulKeForm(judul) {
  const jd = [...judul];
  const f = { uraian: "", satuan: "BH", qty: 0, customerId: "", namaCustomer: "", proyek: "", divisi: "Kontraktor" };
  const idxQty = jd.findIndex((t) => /^\d[\d.,]*$/.test(t));
  if (idxQty >= 0) { f.qty = Number(String(jd[idxQty]).replace(/\./g, "").replace(",", ".")) || 0; }
  const teks = jd.filter((_, i) => i !== idxQty);
  const judulCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  f.uraian = judulCase(teks[0] || "");
  f.namaCustomer = teks[1] || "";
  f.proyek = judulCase(teks[2] || "");
  const c = cocokkanCustomer(f.namaCustomer, customers.value);
  if (c) f.customerId = c.id;
  return f;
}
async function pilihExcelStok(e) {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  laporStok.value = null;
  try {
    const sheets = await bacaExcel(f);
    const hasil = sheets.map((s) => ({ s, r: parseStokKeluar(s.aoa) })).find((x) => x.r.rows.length);
    if (!hasil) return toast("Tidak ada baris pengiriman. Kolom yang dicari: Tanggal, No Surat, Qty (dan opsional Total, Upah Kuli)");
    stok.value = { ...hasil.r, namaFile: f.name };
    formBaru.value = judulKeForm(hasil.r.judul);
    try { poList.value = await api.get("/po"); } catch { poList.value = []; }
    modeStok.value = "baru";
  } catch (err) {
    toast(err.message || "Gagal membaca Excel");
  }
}
const totalStokKirim = computed(() => (stok.value ? stok.value.rows.reduce((s, r) => s + r.qty, 0) : 0));
const totalStokUpah = computed(() => (stok.value ? stok.value.rows.reduce((s, r) => s + (Number(r.upahKuli) || 0), 0) : 0));

async function simpanStok() {
  if (!stok.value) return;
  menyimpanStok.value = true;
  try {
    let poId, itemId;
    if (modeStok.value === "baru") {
      const f = formBaru.value;
      if (!f.uraian || !(Number(f.qty) > 0)) return toast("Isi nama barang dan total stok");
      if (!f.customerId && !f.namaCustomer) return toast("Pilih customer atau ketik nama customer");
      const tgls = stok.value.rows.map((r) => r.tanggal).sort();
      const po = await api.post("/po", {
        otomatis: true, divisi: f.divisi, tanggal: tgls[0], customerId: f.customerId || null, namaCustomer: f.namaCustomer || null, proyek: f.proyek || null,
        catatan: `Dibuat dari impor stok ${stok.value.namaFile}`, ppnPersen: 0, items: [{ uraian: f.uraian, satuan: f.satuan || null, qty: Number(f.qty), hargaSatuan: 0 }],
      });
      poId = po.id;
      itemId = po.items[0].id;
    } else {
      if (!poTerpilih.value || !itemPilih.value) return toast("Pilih PO dan barangnya");
      poId = poPilih.value;
      itemId = itemPilih.value;
    }
    const r = await api.post(`/po/${poId}/pengiriman/bulk`, {
      rows: stok.value.rows.map((x) => ({ itemId, tanggal: x.tanggal, qty: x.qty, noSuratJalan: x.noSurat, upahKuli: x.upahKuli || null })),
    });
    laporStok.value = { dibuat: r.dibuat, dilewati: r.dilewati, poNo: r.po.no, terkirim: r.po.totalTerkirim, total: r.po.totalQty, upah: r.po.totalUpahKuli };
    toast(`${r.dibuat} pengiriman tersimpan`);
    stok.value = null;
  } catch (err) {
    toast(err.message || "Gagal menyimpan");
  } finally {
    menyimpanStok.value = false;
  }
}
function unduhTemplateStok() {
  const aoa = [["NAMA BARANG"], ["NAMA CUSTOMER"], [11000], ["NAMA PROYEK"], ["No", "Tanggal", "No Surat", "QTY", "Total", "Upah Kuli"], [1, "2026-10-15", "NO-SURAT-001", 300, 10700, 150000]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Stok");
  XLSX.writeFile(wb, "template-stok-keluar-po.xlsx");
}
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Impor Data</h1>
      <div class="desc">Masukkan rekapan, invoice, progres PO, dan stok keluar dari Excel / PDF / foto — diperiksa dulu di layar sebelum disimpan, aman diulang</div>
    </div>
  </div>

  <div class="content">
    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px">
      <button class="btn" :class="{ 'btn-primary': tab === 'rekap' }" @click="tab = 'rekap'">1. Rekapan &amp; Invoice</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'prog' }" @click="tab = 'prog'">2. Progres PO (Excel)</button>
      <button class="btn" :class="{ 'btn-primary': tab === 'stok' }" @click="tab = 'stok'">3. Stok Keluar PO (Excel)</button>
    </div>

    <!-- ================= 1 ================= -->
    <template v-if="tab === 'rekap'">
      <div class="card" style="margin-bottom: 14px">
        <div class="section-title">Pilih sumber</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center">
          <label class="btn btn-primary" :style="{ opacity: aiAktif ? 1 : 0.5 }">
            📄 PDF / foto (dibaca AI)
            <input type="file" accept="application/pdf,image/*" multiple style="display: none" :disabled="membaca" @change="pilihBerkasAi" />
          </label>
          <label class="btn">
            📊 Excel rekapan
            <input type="file" accept=".xlsx,.xls" style="display: none" :disabled="membaca" @change="pilihExcelRekap" />
          </label>
          <button class="btn" @click="showModalInvoice = true">🧾 Excel invoice detail (1 sheet = 1 invoice)</button>
        </div>
        <div class="msub" style="margin-top: 8px">
          PDF/foto: pilih sekaligus halaman rekapan <b>dan</b> halaman invoice-nya (boleh satu PDF berisi banyak halaman). AI membaca tiap halaman, lalu sistem memasangkan invoice dengan baris rekapannya (No. Rekapan + pembayaran).
          <span v-if="!aiAktif" style="color: #c0392b"> AI belum aktif: isi GEMINI_API_KEY di backend/.env.</span>
        </div>
        <div v-if="membaca" class="msub" style="margin-top: 8px">⏳ {{ progresBaca || "Membaca file…" }}</div>
        <div v-for="g in gagalBaca" :key="g" class="msub" style="color: #c0392b">⚠ {{ g }}</div>
      </div>

      <div v-if="drafts.length" class="card" style="margin-bottom: 14px; overflow-x: auto">
        <div class="section-title">Periksa hasil bacaan ({{ jumlahPakai }} dari {{ drafts.length }} invoice dipilih)</div>
        <div class="msub" style="margin-bottom: 8px">Betulkan yang salah baca langsung di kolom. Kalau “Total hitungan” beda dengan total di kertas, invoice itu akan ditolak sampai angkanya cocok.</div>
        <div v-for="d in drafts" :key="d.id" class="card" style="margin: 0 0 10px; border: 1px solid #e3e3e3" :style="{ opacity: d.pakai ? 1 : 0.5 }">
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end">
            <label style="display: flex; align-items: center; gap: 4px"><input v-model="d.pakai" type="checkbox" /> Simpan</label>
            <div class="field" style="margin: 0"><label>No. Invoice</label><input v-model="d.no" style="width: 140px" /></div>
            <div class="field" style="margin: 0"><label>Tanggal</label><input v-model="d.tanggal" type="date" /></div>
            <div class="field" style="margin: 0"><label>No. Rekapan</label><input v-model="d.noRekap" style="width: 170px" placeholder="002/INV-BMS/X/2026" /></div>
            <div class="field" style="margin: 0">
              <label>Customer</label>
              <select v-model="d.customerId" style="max-width: 220px">
                <option value="">➕ Baru: {{ d.namaCustomer || "(isi nama)" }}</option>
                <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option>
              </select>
            </div>
            <div v-if="!d.customerId" class="field" style="margin: 0"><label>Nama customer baru</label><input v-model="d.namaCustomer" /></div>
            <div v-if="auth.isAdmin" class="field" style="margin: 0">
              <label>Divisi</label>
              <select v-model="d.divisi"><option v-for="x in DIVISI" :key="x" :value="x">{{ x }}</option></select>
            </div>
            <div v-if="d.divisi === 'Kontraktor'" class="field" style="margin: 0"><label>Proyek</label><input v-model="d.proyekNama" style="width: 200px" /></div>
          </div>
          <div style="margin-top: 6px; font-size: 13px">
            Total hitungan <b class="mono">{{ rupiah(hitungDraft(d)) }}</b>
            <template v-if="d.totalKertas"> • di kertas <b class="mono">{{ rupiah(d.totalKertas) }}</b> <span :style="{ color: bedaTotal(d) ? '#c0392b' : '#159447' }">{{ bedaTotal(d) ? "✗ BEDA" : "✓ cocok" }}</span></template>
            • dibayar <b class="mono">{{ rupiah(bayarDraft(d)) }}</b> • sisa <b class="mono">{{ rupiah(hitungDraft(d) - bayarDraft(d)) }}</b>
            <span v-if="d.soloRekap" class="msub"> • hanya dari rekap (halaman invoice tidak ada, dicatat 1 baris)</span>
          </div>
          <div v-for="(r, i) in d.ragu" :key="i" class="msub" style="color: #c47b12">⚠ AI ragu: {{ r.bidang }} — {{ r.alasan }}</div>
          <details style="margin-top: 6px">
            <summary>{{ d.items.length }} baris barang / jasa</summary>
            <table style="margin-top: 6px">
              <thead><tr><th>Tgl</th><th>Keterangan</th><th class="num">Qty</th><th>Satuan</th><th class="num">Harga</th><th class="num">Jumlah</th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in d.items" :key="i">
                  <td><input v-model="it.tglPakai" type="date" /></td>
                  <td><input v-model="it.keterangan" style="min-width: 280px" /></td>
                  <td><input v-model.number="it.qty" type="number" step="any" style="width: 80px" /></td>
                  <td><input v-model="it.satuan" style="width: 60px" /></td>
                  <td><MoneyInput v-model="it.hargaSatuan" /></td>
                  <td class="num mono">{{ rupiah((Number(it.qty) || 0) * (Number(it.hargaSatuan) || 0)) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-for="(p, i) in d.pembayaran" :key="'p' + i" style="margin-top: 6px; display: flex; gap: 8px; align-items: center">
              Pembayaran: <input v-model="p.tanggal" type="date" /> <MoneyInput v-model="p.nominal" />
            </div>
          </details>
        </div>
        <button class="btn btn-primary" :disabled="menyimpan || !jumlahPakai" @click="simpanDraft">{{ menyimpan ? "Menyimpan…" : `Simpan ${jumlahPakai} invoice` }}</button>
      </div>

      <div v-if="hasilSimpan" class="card" style="overflow-x: auto">
        <div class="section-title">Hasil simpan</div>
        <table>
          <thead><tr><th>No. Invoice</th><th>Status</th><th class="num">Total</th><th class="num">Dibayar</th><th>Keterangan</th></tr></thead>
          <tbody>
            <tr v-for="(h, i) in hasilSimpan" :key="i">
              <td class="mono">{{ h.no }}</td>
              <td :style="{ color: h.status === 'DISIMPAN' ? '#159447' : '#c0392b' }">{{ h.status }}</td>
              <td class="num mono">{{ h.total ? rupiah(h.total) : "-" }}</td><td class="num mono">{{ h.dibayar ? rupiah(h.dibayar) : "-" }}</td>
              <td>{{ h.alasan }}<span v-if="h.customerBaru"> (customer baru: {{ h.customerBaru }})</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ================= 2 ================= -->
    <template v-if="tab === 'prog'">
      <div class="card" style="margin-bottom: 14px">
        <div class="section-title">Progres / transaksi PO dari Excel rekapan (format alexander.xls)</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end">
          <label class="btn btn-primary">📊 Pilih Excel<input type="file" accept=".xlsx,.xls" style="display: none" :disabled="membaca" @change="pilihExcelProg" /></label>
          <div class="field" style="margin: 0"><label>Dari tanggal kirim</label><input v-model="progDari" type="date" /></div>
          <div class="field" style="margin: 0"><label>Sampai</label><input v-model="progSampai" type="date" /></div>
          <button class="btn btn-gold" :disabled="mencocokkan || !blokTerpilih.length" @click="cocokkan">{{ mencocokkan ? "Mencocokkan…" : "Cocokkan ke PO" }}</button>
        </div>
        <div v-if="membaca" class="msub" style="margin-top: 8px">⏳ Membaca file (file besar butuh beberapa detik)…</div>
        <div v-if="namaFileProg" class="msub" style="margin-top: 8px">
          {{ namaFileProg }}: {{ infoProg.total }} blok rekapan. Pada rentang tanggal ini ada <b>{{ blokTerpilih.length }}</b> blok dengan pengiriman.
          <span v-if="infoProg.lain"> {{ infoProg.lain }} blok berformat lain (sewa alat) tidak dibaca.</span>
          <span v-if="infoProg.tanpaPo"> {{ infoProg.tanpaPo }} blok tanpa No PO dilewati.</span>
        </div>
        <div class="msub">Tip: file berisi data sejak 2022 — cukup pilih rentang tanggal yang baru (default 30 hari terakhir). Baris yang sudah tercatat di PO otomatis ditandai “sudah ada”, tidak dobel.</div>
      </div>

      <div v-if="hasilCocok.length" class="card" style="margin-bottom: 14px">
        <div class="section-title">Hasil pencocokan</div>
        <div class="msub" style="margin-bottom: 8px">
          Baru: <b>{{ ringkasCocok.baru }}</b> • sudah ada: {{ ringkasCocok.sudah }} • perlu dipilih / tidak cocok: {{ ringkasCocok.perlu }} • PO tidak ditemukan: {{ ringkasCocok.tanpaPo }}
        </div>
        <div v-for="h in hasilCocok" :key="h.id" class="card" style="margin: 0 0 10px; border: 1px solid #e3e3e3; overflow-x: auto">
          <div style="font-weight: 600">
            {{ h.noInvoice || "(tanpa no. invoice)" }} • {{ h.penerima }}
            <span class="msub"> No PO di Excel: {{ h.noPo }}</span>
          </div>
          <div v-if="h.poId" style="margin: 4px 0">
            → PO di sistem: <b>{{ h.poNo }}</b>
            <span v-if="h.caraCocok === 'PERKIRAAN'" style="color: #c47b12"> (nomor mirip, bukan persis)
              <label style="margin-left: 6px"><input v-model="h.setuju" type="checkbox" /> ya, benar PO ini</label></span>
          </div>
          <div v-else style="margin: 4px 0; color: #c0392b">
            PO tidak ditemukan di sistem — dilewati. Buat PO-nya dulu di menu Purchase Order, lalu ulangi.
            <span v-if="h.kandidatPo.length">Kandidat mirip: {{ h.kandidatPo.map((k) => k.no).join(", ") }}</span>
          </div>
          <table>
            <thead><tr><th></th><th>Tanggal</th><th>No Surat</th><th>No Polisi</th><th>Barang di Excel</th><th class="num">Qty</th><th>Barang PO</th><th>Status</th><th class="num">Upah kuli</th></tr></thead>
            <tbody>
              <tr v-for="(x, i) in h.rows" :key="i" :style="{ opacity: x.status === 'SUDAH_ADA' || x.status === 'TANPA_PO' ? 0.55 : 1 }">
                <td><input v-model="x.pakai" type="checkbox" :disabled="!h.poId || !x.itemPilih" /></td>
                <td>{{ fmtTgl(x.tanggal) }}</td><td class="mono">{{ x.noSj }}</td><td>{{ x.noPolisi }}</td><td>{{ x.jenis }}</td><td class="num mono">{{ angka(x.qty) }}</td>
                <td>
                  <select v-if="h.poId && (x.status === 'AMBIGU' || x.status === 'BARANG_TIDAK_ADA' || x.status === 'BARU')" v-model="x.itemPilih" @change="pilihItem(x)">
                    <option value="">Pilih barang PO…</option>
                    <option v-for="it in (x.status === 'AMBIGU' ? x.kandidatItem : h.itemPo)" :key="it.id" :value="it.id">{{ it.uraian }}</option>
                  </select>
                  <span v-else>-</span>
                </td>
                <td>{{ { BARU: "baru", SUDAH_ADA: "sudah ada", AMBIGU: "pilih barang", BARANG_TIDAK_ADA: "barang tak cocok", TANPA_PO: "tanpa PO" }[x.status] }}</td>
                <td style="width: 130px"><MoneyInput v-if="x.status !== 'SUDAH_ADA' && h.poId" v-model="x.upahKuli" placeholder="0" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <button class="btn btn-primary" :disabled="menyimpanProg || !jumlahSimpanProg" @click="simpanProg">{{ menyimpanProg ? "Menyimpan…" : `Simpan ${jumlahSimpanProg} pengiriman ke PO` }}</button>
      </div>
      <div v-if="laporProg" class="card">
        Tersimpan <b>{{ laporProg.dibuat }}</b> pengiriman baru, {{ laporProg.dilewati }} dilewati (sudah ada).
        <div v-for="g in laporProg.gagal" :key="g" style="color: #c0392b">⚠ {{ g }}</div>
      </div>
    </template>

    <!-- ================= 3 ================= -->
    <template v-if="tab === 'stok'">
      <div class="card" style="margin-bottom: 14px">
        <div class="section-title">Stok keluar PO dari Excel</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center">
          <label class="btn btn-primary">📊 Pilih Excel<input type="file" accept=".xlsx,.xls" style="display: none" @change="pilihExcelStok" /></label>
          <button class="btn" @click="unduhTemplateStok">⬇ Unduh template</button>
        </div>
        <div class="msub" style="margin-top: 8px">Format: judul di atas (nama barang, customer, total stok, proyek), lalu tabel <b>No | Tanggal | No Surat | QTY | Total | Upah Kuli</b>. Kolom Total (sisa) dihitung ulang oleh sistem; kolom Upah Kuli opsional dan otomatis masuk Laporan Divisi &gt; Pengeluaran.</div>
      </div>

      <div v-if="stok" class="card" style="margin-bottom: 14px; overflow-x: auto">
        <div class="section-title">Periksa — {{ stok.namaFile }}</div>
        <div style="display: flex; gap: 14px; margin-bottom: 8px">
          <label><input v-model="modeStok" type="radio" value="baru" /> Buat PO baru dari file ini</label>
          <label><input v-model="modeStok" type="radio" value="ada" /> Tambahkan ke PO yang sudah ada</label>
        </div>
        <div v-if="modeStok === 'baru'" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 10px">
          <div class="field" style="margin: 0"><label>Nama barang</label><input v-model="formBaru.uraian" /></div>
          <div class="field" style="margin: 0"><label>Satuan</label><input v-model="formBaru.satuan" style="width: 70px" /></div>
          <div class="field" style="margin: 0"><label>Total stok / pesanan</label><input v-model.number="formBaru.qty" type="number" style="width: 110px" /></div>
          <div class="field" style="margin: 0">
            <label>Customer</label>
            <select v-model="formBaru.customerId" style="max-width: 220px"><option value="">➕ Baru: {{ formBaru.namaCustomer || "(isi nama)" }}</option><option v-for="c in customers" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option></select>
          </div>
          <div v-if="!formBaru.customerId" class="field" style="margin: 0"><label>Nama customer</label><input v-model="formBaru.namaCustomer" /></div>
          <div class="field" style="margin: 0"><label>Proyek</label><input v-model="formBaru.proyek" /></div>
          <div v-if="auth.isAdmin" class="field" style="margin: 0"><label>Divisi</label><select v-model="formBaru.divisi"><option v-for="x in DIVISI" :key="x" :value="x">{{ x }}</option></select></div>
        </div>
        <div v-else style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
          <div class="field" style="margin: 0"><label>PO</label>
            <select v-model="poPilih" @change="itemPilih = ''"><option value="">Pilih PO…</option><option v-for="p in poList" :key="p.id" :value="p.id">{{ p.no }} — {{ p.namaCustomerTampil }}</option></select>
          </div>
          <div v-if="poTerpilih" class="field" style="margin: 0"><label>Barang</label>
            <select v-model="itemPilih"><option value="">Pilih barang…</option><option v-for="i in poTerpilih.items" :key="i.id" :value="i.id">{{ i.uraian }} (sisa {{ angka(i.sisa) }})</option></select>
          </div>
        </div>
        <table>
          <thead><tr><th>No</th><th>Tanggal</th><th>No Surat</th><th class="num">Qty</th><th class="num">Sisa di Excel</th><th class="num">Upah kuli</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in stok.rows" :key="i">
              <td>{{ i + 1 }}</td><td>{{ fmtTgl(r.tanggal) }}</td><td class="mono">{{ r.noSurat }}</td><td class="num mono">{{ angka(r.qty) }}</td>
              <td class="num mono">{{ r.sisa === null ? "-" : angka(r.sisa) }}</td><td style="width: 150px"><MoneyInput v-model="r.upahKuli" placeholder="0" /></td>
            </tr>
            <tr style="font-weight: 600"><td></td><td>TOTAL</td><td></td><td class="num mono">{{ angka(totalStokKirim) }}</td><td></td><td class="num mono">{{ rupiah(totalStokUpah) }}</td></tr>
          </tbody>
        </table>
        <button class="btn btn-primary" style="margin-top: 10px" :disabled="menyimpanStok" @click="simpanStok">{{ menyimpanStok ? "Menyimpan…" : "Simpan stok keluar" }}</button>
      </div>

      <div v-if="laporStok" class="card">
        ✓ PO <b>{{ laporStok.poNo }}</b>: {{ laporStok.dibuat }} pengiriman tersimpan ({{ laporStok.dilewati }} dilewati karena sudah ada). Terkirim {{ angka(laporStok.terkirim) }} dari {{ angka(laporStok.total) }}<span v-if="laporStok.upah"> • total upah kuli {{ rupiah(laporStok.upah) }}</span>.
        Cetak kartu stok (Excel/PDF) dari menu Purchase Order → Rincian.
      </div>
    </template>
  </div>

  <ImportInvoiceModal v-if="showModalInvoice" :customers="customers" @close="showModalInvoice = false" @done="showModalInvoice = false" />
</template>
