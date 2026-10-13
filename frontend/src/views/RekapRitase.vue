<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import SearchableSelect from "../components/SearchableSelect.vue";

// ---- Pilihan filter disimpan di browser supaya tidak hilang saat refresh ----
const LS_KEY = "bms.rekapRitase.ui";
function readLS() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null") || {};
  } catch {
    return {};
  }
}
function writeLS(v) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    /* abaikan */
  }
}
const saved = readLS();

const today = new Date();
const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const customers = ref([]);
const loading = ref(false);
const groups = ref([]);
const summary = ref({ jumlahNopol: 0, totalRitase: 0, totalKubikasi: 0, tanpaKubikasi: 0 });
const orientasi = ref(saved.orientasi || "portrait");

const filter = ref({
  customerId: saved.customerId || "",
  sumber: saved.sumber || "sj", // "sj" | "gabung" | "manual"
  q: saved.q || "", // kata kunci tujuan / penerima / jenis barang, mis. "Bekasi"
  from: saved.from || isoLocal(new Date(today.getFullYear(), today.getMonth(), 1)),
  to: saved.to || isoLocal(today),
  kubikasiDefault: saved.kubikasiDefault ?? "5,5",
  judulTujuan: saved.judulTujuan || "", // teks dalam kurung di judul, mis. "Buang Tanah ke Bekasi"
});

const customerOptions = computed(() => customers.value.map((c) => ({ value: c.id, label: `${c.kode} — ${c.nama}` })));
const selectedCustomer = computed(() => customers.value.find((c) => c.id === filter.value.customerId));

// ---- format angka ala lembar rekap: 5,5 / 16,5 / 33 / 797,5 ----
const nf = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmt = (n) => nf.format(Number(n) || 0);
function fmtTgl(key) {
  const [y, m, d] = String(key).split("-");
  return `${d}/${m}/${y}`;
}
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function tglPanjang(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return { d, m, y };
}
const periodeText = computed(() => {
  const { from, to } = filter.value;
  if (!from && !to) return "Semua periode";
  if (from && !to) {
    const a = tglPanjang(from);
    return `Mulai ${a.d} ${BULAN[a.m - 1]} ${a.y}`;
  }
  if (!from && to) {
    const b = tglPanjang(to);
    return `Sampai ${b.d} ${BULAN[b.m - 1]} ${b.y}`;
  }
  const a = tglPanjang(from);
  const b = tglPanjang(to);
  if (a.y === b.y && a.m === b.m) {
    return a.d === b.d ? `${a.d} ${BULAN[a.m - 1]} ${a.y}` : `${a.d} – ${b.d} ${BULAN[b.m - 1]} ${b.y}`;
  }
  if (a.y === b.y) return `${a.d} ${BULAN[a.m - 1]} – ${b.d} ${BULAN[b.m - 1]} ${b.y}`;
  return `${a.d} ${BULAN[a.m - 1]} ${a.y} – ${b.d} ${BULAN[b.m - 1]} ${b.y}`;
});
const judul = computed(() => {
  const nama = selectedCustomer.value?.nama || "Semua Customer";
  const tujuan = filter.value.judulTujuan.trim() || filter.value.q.trim();
  return tujuan ? `${nama} (${tujuan})` : nama;
});

async function loadCustomers() {
  try {
    customers.value = await api.get("/customers");
    // customer yang tersimpan sudah tidak ada -> kembali ke "Semua Customer"
    // (jangan dipaksa ke customer pertama)
    if (filter.value.customerId && !customers.value.some((c) => c.id === filter.value.customerId)) {
      filter.value.customerId = "";
    }
  } catch (e) {
    console.error(e);
    toast("Gagal memuat master customer");
  }
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const p = new URLSearchParams();
    if (filter.value.customerId) p.set("customerId", filter.value.customerId);
    if (filter.value.q.trim()) p.set("q", filter.value.q.trim());
    if (filter.value.from) p.set("from", filter.value.from);
    if (filter.value.to) p.set("to", filter.value.to);
    const kd = String(filter.value.kubikasiDefault ?? "").replace(",", ".").trim();
    if (kd) p.set("kubikasiDefault", kd);
    p.set("sumber", filter.value.sumber);
    const d = await api.get(`/rekap-penjualan/ritase?${p.toString()}`);
    if (seq !== loadSeq) return; // ada permintaan yang lebih baru
    groups.value = d.groups || [];
    summary.value = d.summary || { jumlahNopol: 0, totalRitase: 0, totalKubikasi: 0, tanpaKubikasi: 0 };
  } catch (e) {
    console.error(e);
    if (seq === loadSeq) toast(e?.message || "Gagal memuat rekap ritase");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

// ---- Input manual ritase ----
const manualRows = ref([]);
const manualForm = ref({ id: "", tanggal: isoLocal(today), noPolisi: "", ritase: "", kubikasi: "", catatan: "" });
const manualSaving = ref(false);
const nopolOptions = computed(() => [...new Set([...groups.value.map((g) => g.noPolisi), ...manualRows.value.map((m) => m.noPolisi)])].filter((n) => !n.startsWith("(")));

async function loadManual() {
  try {
    const p = new URLSearchParams();
    if (filter.value.customerId) p.set("customerId", filter.value.customerId);
    if (filter.value.from) p.set("from", filter.value.from);
    if (filter.value.to) p.set("to", filter.value.to);
    manualRows.value = (await api.get(`/rekap-penjualan/ritase-manual?${p.toString()}`)).rows || [];
  } catch (e) {
    console.error(e);
  }
}
function resetManualForm(keepTanggal = true) {
  manualForm.value = {
    id: "",
    tanggal: keepTanggal ? manualForm.value.tanggal : isoLocal(new Date()),
    noPolisi: keepTanggal ? manualForm.value.noPolisi : "",
    ritase: "",
    kubikasi: manualForm.value.kubikasi,
    catatan: "",
  };
}
function editManual(m) {
  manualForm.value = { id: m.id, tanggal: m.tanggal, noPolisi: m.noPolisi, ritase: String(m.ritase), kubikasi: m.kubikasi ? String(m.kubikasi).replace(".", ",") : "", catatan: m.catatan || "" };
}
async function simpanManual() {
  const f = manualForm.value;
  if (!f.tanggal || !f.noPolisi.trim() || !(Number(String(f.ritase).replace(",", ".")) > 0)) {
    return toast("Tanggal, No. Polisi, dan Ritase wajib diisi");
  }
  manualSaving.value = true;
  try {
    const body = { ...f, customerId: filter.value.customerId || "" };
    delete body.id;
    if (f.id) await api.put(`/rekap-penjualan/ritase-manual/${f.id}`, body);
    else await api.post("/rekap-penjualan/ritase-manual", body);
    toast(f.id ? "Ritase manual diperbarui" : "Ritase manual ditambahkan");
    resetManualForm(true);
    if (filter.value.sumber === "sj") filter.value.sumber = "gabung"; // supaya langsung terlihat di rekap
    await Promise.all([loadManual(), load()]);
  } catch (e) {
    toast(e?.message || "Gagal menyimpan ritase manual");
  } finally {
    manualSaving.value = false;
  }
}
async function hapusManual(m) {
  if (!confirm(`Hapus input manual ${m.noPolisi} tanggal ${fmtTgl(m.tanggal)} (${m.ritase} ritase)?`)) return;
  try {
    await api.delete(`/rekap-penjualan/ritase-manual/${m.id}`);
    if (manualForm.value.id === m.id) resetManualForm(true);
    await Promise.all([loadManual(), load()]);
  } catch (e) {
    toast(e?.message || "Gagal menghapus");
  }
}

// muat ulang otomatis (ditunda sebentar supaya mengetik tidak memicu banyak request)
let timer = null;
watch(
  [filter, orientasi],
  () => {
    const f = filter.value;
    writeLS({ ...f, orientasi: orientasi.value });
    clearTimeout(timer);
    timer = setTimeout(() => {
      load();
      loadManual();
    }, 350);
  },
  { deep: true }
);

onMounted(async () => {
  await loadCustomers();
  await Promise.all([load(), loadManual()]);
});

// ---- Cetak / PDF ----
function printReport() {
  if (!groups.value.length) return toast("Tidak ada data untuk dicetak");
  // @page dari halaman Rekap Penjualan bisa tertinggal di <head>; buang dulu
  document.getElementById("rekap-penjualan-print-orientation")?.remove();
  document.getElementById("rekap-ritase-print-orientation")?.remove();
  const tag = document.createElement("style");
  tag.id = "rekap-ritase-print-orientation";
  tag.textContent = `@media print { @page { size: A4 ${orientasi.value}; margin: 12mm; } }`;
  document.head.appendChild(tag);
  window.print();
}

// ---- Export Excel (format sama dengan lembar rekap) ----
async function exportExcel() {
  if (!groups.value.length) return toast("Tidak ada data untuk diexport");
  const XLSX = await import("xlsx");
  const aoa = [["REKAP RITASE SURAT JALAN"], [judul.value], [`Periode ${periodeText.value}`], []];
  groups.value.forEach((g) => {
    aoa.push([`No. Polisi: ${g.noPolisi}`]);
    aoa.push(["Tanggal", "No. Polisi", "Ritase", "Kubikasi (m³)", "Total Kubikasi (m³)"]);
    g.rows.forEach((r) => aoa.push([fmtTgl(r.tanggal), g.noPolisi, r.ritase, r.kubikasi, r.total]));
    aoa.push(["Total", "", g.totalRitase, "-", g.totalKubikasi]);
    aoa.push([]);
  });
  aoa.push([`Total keseluruhan: ${summary.value.totalRitase} ritase = ${fmt(summary.value.totalKubikasi)} m³`]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 9 }, { wch: 15 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rekap Ritase");
  const nm = (selectedCustomer.value?.nama || "semua-customer").replace(/[^a-z0-9]+/gi, "-");
  XLSX.writeFile(wb, `rekap-ritase-${nm}-${filter.value.from || "awal"}_${filter.value.to || "akhir"}.xlsx`);
}
</script>

<template>
  <div class="topbar no-print">
    <div>
      <h1>Rekap Ritase</h1>
      <div class="desc">Hitung ritase dari Surat Jalan: per No. Polisi dan per tanggal (1 Surat Jalan = 1 ritase).</div>
    </div>
    <div class="top-actions">
      <div class="field orientasi-field">
        <label>Orientasi Cetak</label>
        <select v-model="orientasi">
          <option value="portrait">Vertikal (Portrait)</option>
          <option value="landscape">Horizontal (Landscape)</option>
        </select>
      </div>
      <button class="btn btn-ghost" @click="printReport">🖨 Cetak / PDF</button>
      <button class="btn btn-ghost" @click="exportExcel">⬇ Export Excel</button>
    </div>
  </div>

  <div class="content no-print">
    <div class="card filter-card">
      <div class="row">
        <div class="field">
          <label>Customer</label>
          <SearchableSelect v-model="filter.customerId" :options="customerOptions" placeholder="Semua Customer" />
        </div>
        <div class="field">
          <label>Dari Tanggal</label>
          <input v-model="filter.from" type="date" />
        </div>
        <div class="field">
          <label>Sampai Tanggal</label>
          <input v-model="filter.to" type="date" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Filter Tujuan / Barang <span class="opt">(opsional, cocok di tujuan, penerima, jenis barang)</span></label>
          <input v-model="filter.q" placeholder="Contoh: Bekasi" />
        </div>
        <div class="field">
          <label>Teks di Judul <span class="opt">(opsional, tampil dalam kurung)</span></label>
          <input v-model="filter.judulTujuan" placeholder="Contoh: Buang Tanah ke Bekasi" />
        </div>
        <div class="field">
          <label>Sumber Ritase</label>
          <select v-model="filter.sumber">
            <option value="sj">Surat Jalan saja</option>
            <option value="gabung">Surat Jalan + input manual</option>
            <option value="manual">Input manual saja</option>
          </select>
        </div>
        <div class="field">
          <label>Kubikasi per Ritase <span class="opt">(m³, dipakai jika SJ belum ada m³)</span></label>
          <input v-model="filter.kubikasiDefault" inputmode="decimal" placeholder="5,5" />
        </div>
      </div>
    </div>

    <div class="card manual-card">
      <div class="manual-title">✎ Input Manual Ritase <span class="opt">(untuk ritase yang belum/tidak ada surat jalannya; ikut dihitung bila Sumber = "Surat Jalan + input manual" atau "Input manual saja")</span></div>
      <div class="row">
        <div class="field"><label>Tanggal</label><input v-model="manualForm.tanggal" type="date" /></div>
        <div class="field">
          <label>No. Polisi</label>
          <input v-model="manualForm.noPolisi" list="nopol-list" placeholder="B 9305 UYX" />
          <datalist id="nopol-list"><option v-for="n in nopolOptions" :key="n" :value="n" /></datalist>
        </div>
        <div class="field"><label>Ritase</label><input v-model="manualForm.ritase" inputmode="numeric" placeholder="3" /></div>
        <div class="field"><label>Kubikasi / ritase <span class="opt">(m³, kosong = default)</span></label><input v-model="manualForm.kubikasi" inputmode="decimal" placeholder="5,5" /></div>
        <div class="field"><label>Catatan</label><input v-model="manualForm.catatan" placeholder="opsional" /></div>
      </div>
      <div class="manual-actions">
        <button class="btn btn-primary" :disabled="manualSaving" @click="simpanManual">{{ manualSaving ? "Menyimpan..." : manualForm.id ? "Simpan Perubahan" : "＋ Tambah Ritase" }}</button>
        <button v-if="manualForm.id" class="btn btn-ghost" @click="resetManualForm(false)">Batal edit</button>
        <span class="opt">Disimpan untuk customer yang sedang dipilih ({{ selectedCustomer?.nama || "Semua Customer" }}).</span>
      </div>
      <div v-if="manualRows.length" class="table-wrap manual-list">
        <table class="rekap-table">
          <thead><tr><th>Tanggal</th><th>No. Polisi</th><th class="num">Ritase</th><th class="num">Kubikasi</th><th>Catatan</th><th></th></tr></thead>
          <tbody>
            <tr v-for="m in manualRows" :key="m.id">
              <td>{{ fmtTgl(m.tanggal) }}</td><td class="mono">{{ m.noPolisi }}</td><td class="num">{{ m.ritase }}</td>
              <td class="num">{{ m.kubikasi ? fmt(m.kubikasi) : "default" }}</td><td>{{ m.catatan }}</td>
              <td class="aksi"><button class="btn btn-sm btn-ghost" @click="editManual(m)">Edit</button> <button class="btn btn-sm btn-danger" @click="hapusManual(m)">Hapus</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="rekap-summary grid g3">
      <div class="stat"><div class="lbl">JUMLAH KENDARAAN</div><div class="val">{{ summary.jumlahNopol }}</div></div>
      <div class="stat"><div class="lbl">TOTAL RITASE</div><div class="val">{{ summary.totalRitase }}</div></div>
      <div class="stat"><div class="lbl">TOTAL KUBIKASI</div><div class="val">{{ fmt(summary.totalKubikasi) }} m³</div></div>
    </div>

    <div v-if="summary.ritaseManual" class="info">✎ {{ summary.ritaseManual }} ritase pada rekap ini berasal dari input manual.</div>
    <div v-if="summary.tanpaKubikasi" class="warn">
      ⚠ {{ summary.tanpaKubikasi }} ritase belum punya kubikasi (m³), jadi dihitung memakai
      <b>{{ filter.kubikasiDefault || 0 }} m³</b> per ritase. Isi m³ di surat jalannya kalau angkanya berbeda.
    </div>

    <div class="card">
      <div v-if="loading" class="empty">Memuat rekap ritase...</div>
      <div v-else-if="!groups.length" class="empty">
        <div class="big">🚚</div>
        <strong>Tidak ada surat jalan pada filter ini</strong>
        <div class="empty-desc">Cek rentang tanggal, customer, atau kata kunci tujuan. Surat jalan berstatus draft tidak dihitung.</div>
      </div>
      <template v-else>
        <div class="judul">
          <div class="j1">REKAP RITASE SURAT JALAN</div>
          <div class="j2">{{ judul }}</div>
          <div class="j3">Periode {{ periodeText }}</div>
        </div>
        <div v-for="g in groups" :key="g.noPolisi" class="grp">
          <div class="grp-title">No. Polisi: {{ g.noPolisi }}</div>
          <div class="table-wrap">
            <table class="rekap-table">
              <thead>
                <tr><th>Tanggal</th><th>No. Polisi</th><th class="num">Ritase</th><th class="num">Kubikasi (m³)</th><th class="num">Total Kubikasi (m³)</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in g.rows" :key="r.tanggal + '|' + r.kubikasi">
                  <td>{{ fmtTgl(r.tanggal) }}</td>
                  <td class="mono">{{ g.noPolisi }}</td>
                  <td class="num">{{ r.ritase }}<span v-if="r.manualRitase" class="mnl" :title="r.manualRitase + ' ritase dari input manual'"> ✎</span></td>
                  <td class="num">{{ fmt(r.kubikasi) }}<span v-if="r.pakaiDefault" class="dflt" title="Memakai kubikasi default"> *</span></td>
                  <td class="num">{{ fmt(r.total) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td colspan="2"><b>Total</b></td><td class="num"><b>{{ g.totalRitase }}</b></td><td class="num">-</td><td class="num"><b>{{ fmt(g.totalKubikasi) }}</b></td></tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div class="grand">Total keseluruhan: <b>{{ summary.totalRitase }} ritase = {{ fmt(summary.totalKubikasi) }} m³</b></div>
      </template>
    </div>
  </div>

  <!-- DOKUMEN CETAK -->
  <div class="print-document">
    <div class="print-paper">
      <div class="p-title">REKAP RITASE SURAT JALAN</div>
      <div class="p-sub">{{ judul }}</div>
      <div class="p-sub">Periode {{ periodeText }}</div>
      <div v-for="g in groups" :key="'p' + g.noPolisi" class="p-grp">
        <div class="p-nopol">No. Polisi: {{ g.noPolisi }}</div>
        <table class="p-table">
          <thead>
            <tr><th>Tanggal</th><th>No. Polisi</th><th>Ritase</th><th>Kubikasi (m³)</th><th>Total Kubikasi<br />(m³)</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in g.rows" :key="r.tanggal + '|' + r.kubikasi">
              <td>{{ fmtTgl(r.tanggal) }}</td><td>{{ g.noPolisi }}</td><td>{{ r.ritase }}</td><td>{{ fmt(r.kubikasi) }}</td><td>{{ fmt(r.total) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td colspan="2">Total</td><td>{{ g.totalRitase }}</td><td>-</td><td>{{ fmt(g.totalKubikasi) }}</td></tr>
          </tfoot>
        </table>
      </div>
      <div class="p-grand">Total keseluruhan: {{ summary.totalRitase }} ritase = {{ fmt(summary.totalKubikasi) }} m³</div>
    </div>
  </div>
</template>

<style scoped>
.top-actions { display:flex; gap:8px; align-items:flex-end; }
.orientasi-field { min-width:170px; margin-bottom:0; }
.orientasi-field select { height:38px; }
.filter-card { margin-bottom:16px; }
.rekap-summary { margin-bottom:16px; }
.opt { font-weight:400; color:var(--ink-soft); font-size:11px; }
.warn { margin-bottom:16px; padding:10px 12px; border-radius:8px; background:#fff6e0; border:1px solid #f0d58a; font-size:12.5px; }
.judul { text-align:center; margin-bottom:14px; }
.j1 { font-weight:800; letter-spacing:.5px; }
.j2 { font-weight:700; margin-top:2px; }
.j3 { color:var(--ink-soft); font-size:12px; margin-top:2px; }
.grp { margin-bottom:18px; }
.grp-title { font-weight:700; margin-bottom:6px; }
.table-wrap { width:100%; overflow-x:auto; }
.rekap-table th, .rekap-table td { white-space:nowrap; }
.rekap-table td.num, .rekap-table th.num { text-align:right; }
.dflt { color:#b26a00; }
.mnl { color:#2a6fb0; font-size:11px; }
.manual-card { margin-bottom:16px; }
.manual-title { font-weight:700; margin-bottom:8px; }
.manual-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:4px; }
.manual-list { margin-top:12px; max-height:260px; overflow:auto; }
.aksi { white-space:nowrap; }
.info { margin-bottom:16px; padding:10px 12px; border-radius:8px; background:var(--bms-blue-soft); font-size:12.5px; }
.grand { margin-top:6px; padding:10px 12px; border-radius:8px; background:var(--bms-blue-soft); }
.print-document { display:none; }

@media (max-width:700px) {
  .top-actions { flex-direction:column; align-items:stretch; }
  .top-actions .btn { width:100%; justify-content:center; }
  .orientasi-field { width:100%; }
}

@media print {
  body { background:#fff !important; }
  .no-print, .sidebar, .topbar, .content { display:none !important; }
  .print-document { display:block !important; }
  .print-paper { color:#111; font-family:Arial, sans-serif; font-size:11px; }
  .p-title { text-align:center; font-weight:800; font-size:15px; }
  .p-sub { text-align:center; font-weight:700; font-size:12px; margin-top:2px; }
  .p-grp { margin-top:12px; break-inside:avoid; }
  .p-nopol { font-weight:800; margin-bottom:4px; }
  .p-table { width:100%; border-collapse:collapse; }
  .p-table th, .p-table td { border:1px solid #555; padding:3px 6px; text-align:center; }
  .p-table th { background:#f3f3f3; font-weight:800; }
  .p-table tfoot td { font-weight:800; }
  .p-grand { margin-top:14px; font-weight:800; font-size:12px; }
}
</style>
