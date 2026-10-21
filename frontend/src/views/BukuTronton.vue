<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import MoneyInput from "../components/MoneyInput.vue";
import SearchableSelect from "../components/SearchableSelect.vue";

// BUKU TRONTON -- digitalisasi buku tulis catatan uang jalan sopir tronton.
// Kolom di buku: Nama | Uang Jalan | Material | Uang Beli Material | Tujuan.
// Input cepat per tanggal (banyak baris sekaligus), nama sopir & material berupa
// dropdown tapi tetap bisa diketik manual kalau belum terdaftar.

const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const angka = (n) => Math.round(Number(n) || 0).toLocaleString("id-ID");
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function tglPanjang(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${HARI[dt.getDay()]}, ${d} ${BULAN[m - 1]} ${y}`;
}

// ---------------- Dropdown ----------------
const opsi = ref({ sopir: [], material: [], materialManual: [], tujuan: [] });
async function loadOpsi() {
  try {
    opsi.value = await api.get("/buku-tronton/opsi");
  } catch (e) {
    toast(e?.message || "Gagal memuat pilihan dropdown");
  }
}
const sopirOptions = computed(() =>
  opsi.value.sopir.map((s) => ({
    value: s.id,
    label: s.nama,
    sub: `${s.tipe === "TRONTON" ? "Tronton" : "Cold Diesel"}${s.nopol ? " · " + s.nopol : ""}`,
  }))
);
const materialOptions = computed(() => opsi.value.material.map((m) => ({ value: m.nama, label: `${m.kode} — ${m.nama}` })));

// ---------------- Input cepat ----------------
const tanggalInput = ref(isoLocal(today));
const masukLaporan = ref(true);
const saving = ref(false);

const barisKosong = () => ({
  k: Math.random().toString(36).slice(2),
  sopirId: "",
  sopirNama: "",
  sopirManual: false,
  noPolisi: "",
  uangJalan: "",
  material: "",
  materialManual: false,
  uangBeliMaterial: "",
  tujuan: "",
  catatan: "",
});
const baris = ref([barisKosong(), barisKosong(), barisKosong()]);

function tambahBaris() {
  baris.value.push(barisKosong());
}
function hapusBaris(i) {
  baris.value.splice(i, 1);
  if (!baris.value.length) baris.value.push(barisKosong());
}
// Salin baris (material, tujuan, uang) -- berguna kalau beberapa sopir ke tujuan yang sama.
function salinBaris(i) {
  const a = baris.value[i];
  baris.value.splice(i + 1, 0, { ...a, k: Math.random().toString(36).slice(2), sopirId: "", sopirNama: "", noPolisi: "", sopirManual: false });
}
function pilihSopir(row) {
  const s = opsi.value.sopir.find((x) => x.id === row.sopirId);
  row.sopirNama = s?.nama || "";
  row.noPolisi = s?.nopol || "";
}
function toggleSopirManual(row) {
  row.sopirManual = !row.sopirManual;
  row.sopirId = "";
  row.sopirNama = "";
  row.noPolisi = "";
}
function toggleMaterialManual(row) {
  row.materialManual = !row.materialManual;
  row.material = "";
}
// Ketik nama manual yang ternyata sudah ada di master -> otomatis dikaitkan.
function cocokkanNama(row) {
  const n = row.sopirNama.trim().toLowerCase().replace(/\s+/g, " ");
  const s = opsi.value.sopir.find((x) => x.nama.toLowerCase() === n);
  if (s) {
    row.sopirId = s.id;
    row.sopirNama = s.nama;
    row.noPolisi = s.nopol || "";
  }
}

const barisTerisi = computed(() => baris.value.filter((r) => r.sopirId || r.sopirNama.trim() || r.uangJalan || r.uangBeliMaterial || r.material || r.tujuan));
const totalInput = computed(() => ({
  uj: barisTerisi.value.reduce((s, r) => s + (Number(r.uangJalan) || 0), 0),
  bm: barisTerisi.value.reduce((s, r) => s + (Number(r.uangBeliMaterial) || 0), 0),
}));

async function simpanSemua() {
  if (!barisTerisi.value.length) return toast("Belum ada baris yang diisi");
  const bolong = barisTerisi.value.findIndex((r) => !r.sopirId && !r.sopirNama.trim());
  if (bolong >= 0) return toast(`Nama sopir di baris ${baris.value.indexOf(barisTerisi.value[bolong]) + 1} belum diisi`);
  saving.value = true;
  try {
    const r = await api.post("/buku-tronton/batch", {
      tanggal: tanggalInput.value,
      masukLaporan: masukLaporan.value,
      rows: barisTerisi.value.map((x) => ({
        sopirId: x.sopirId || null,
        sopirNama: x.sopirNama,
        noPolisi: x.noPolisi,
        uangJalan: x.uangJalan,
        material: x.material,
        uangBeliMaterial: x.uangBeliMaterial,
        tujuan: x.tujuan,
        catatan: x.catatan,
      })),
    });
    toast(`${r.jumlah} baris tersimpan`);
    baris.value = [barisKosong(), barisKosong(), barisKosong()];
    await Promise.all([load(), loadOpsi()]);
  } catch (e) {
    toast(e?.message || "Gagal menyimpan");
  } finally {
    saving.value = false;
  }
}

// ---------------- Daftar tersimpan ----------------
const filter = ref({
  from: isoLocal(new Date(today.getFullYear(), today.getMonth(), 1)),
  to: isoLocal(today),
  sopirId: "",
  q: "",
});
const loading = ref(false);
const rows = ref([]);
const ringkasan = ref({ trip: 0, totalUangJalan: 0, totalUangBeliMaterial: 0, totalKeluar: 0, perSopir: [] });

let seq = 0;
async function load() {
  const my = ++seq;
  loading.value = true;
  try {
    const p = new URLSearchParams();
    if (filter.value.from) p.set("from", filter.value.from);
    if (filter.value.to) p.set("to", filter.value.to);
    if (filter.value.sopirId) p.set("sopirId", filter.value.sopirId);
    if (filter.value.q.trim()) p.set("q", filter.value.q.trim());
    const d = await api.get(`/buku-tronton?${p.toString()}`);
    if (my !== seq) return;
    rows.value = d.rows;
    ringkasan.value = d.ringkasan;
  } catch (e) {
    if (my === seq) toast(e?.message || "Gagal memuat data");
  } finally {
    if (my === seq) loading.value = false;
  }
}
let timer = null;
watch(
  filter,
  () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  },
  { deep: true }
);

const grup = computed(() => {
  const map = new Map();
  for (const r of rows.value) {
    if (!map.has(r.tanggal)) map.set(r.tanggal, []);
    map.get(r.tanggal).push(r);
  }
  return [...map.entries()].map(([tanggal, list]) => ({
    tanggal,
    list,
    uj: list.reduce((s, r) => s + r.uangJalan, 0),
    bm: list.reduce((s, r) => s + r.uangBeliMaterial, 0),
  }));
});

// ---------------- Edit / hapus ----------------
const edit = ref(null);
function bukaEdit(r) {
  const terdaftar = !!r.sopirId;
  const dikenalMaterial = !r.material || opsi.value.material.some((m) => m.nama === r.material);
  edit.value = {
    id: r.id,
    tanggal: r.tanggal,
    sopirId: r.sopirId || "",
    sopirNama: r.sopirNama,
    sopirManual: !terdaftar,
    noPolisi: r.noPolisi || "",
    uangJalan: r.uangJalan || "",
    material: r.material || "",
    materialManual: !dikenalMaterial,
    uangBeliMaterial: r.uangBeliMaterial || "",
    tujuan: r.tujuan || "",
    catatan: r.catatan || "",
    masukLaporan: r.masukLaporan,
  };
}
async function simpanEdit() {
  const e = edit.value;
  if (!e.sopirId && !e.sopirNama.trim()) return toast("Nama sopir wajib diisi");
  try {
    await api.put(`/buku-tronton/${e.id}`, {
      tanggal: e.tanggal,
      sopirId: e.sopirId || null,
      sopirNama: e.sopirNama,
      noPolisi: e.noPolisi,
      uangJalan: e.uangJalan,
      material: e.material,
      uangBeliMaterial: e.uangBeliMaterial,
      tujuan: e.tujuan,
      catatan: e.catatan,
      masukLaporan: e.masukLaporan,
    });
    toast("Perubahan tersimpan");
    edit.value = null;
    await Promise.all([load(), loadOpsi()]);
  } catch (err) {
    toast(err?.message || "Gagal menyimpan perubahan");
  }
}
async function hapus(r) {
  if (!confirm(`Hapus catatan ${r.sopirNama} tanggal ${tglPanjang(r.tanggal)}? Baris di Laporan Divisi yang dibuat otomatis dari catatan ini ikut terhapus.`)) return;
  try {
    await api.delete(`/buku-tronton/${r.id}`);
    toast("Catatan dihapus");
    edit.value = null;
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menghapus");
  }
}
async function daftarkan(nama) {
  if (!confirm(`Daftarkan "${nama}" sebagai sopir Tronton di menu Sopir? Semua catatan Buku Tronton atas nama ini ikut terkait ke sopir tersebut.`)) return;
  try {
    const r = await api.post("/buku-tronton/daftar-sopir", { nama });
    toast(`${r.sopir.nama} terdaftar (${r.dikaitkan} catatan dikaitkan)`);
    await Promise.all([load(), loadOpsi()]);
  } catch (e) {
    toast(e?.message || "Gagal mendaftarkan sopir");
  }
}

onMounted(async () => {
  await loadOpsi();
  await load();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Buku Tronton</h1>
      <div class="desc">Catatan uang jalan, material &amp; tujuan tiap trip sopir tronton (pengganti buku tulis)</div>
    </div>
  </div>

  <div class="content">
    <!-- ================= INPUT CEPAT ================= -->
    <div class="card" style="margin-bottom:16px;">
      <div class="section-title">Input dari buku</div>
      <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px;">
        <div class="field" style="margin:0;">
          <label>Tanggal di buku</label>
          <input v-model="tanggalInput" type="date" />
        </div>
        <label class="draft-check" style="margin:0; flex:1; min-width:260px;">
          <input v-model="masukLaporan" type="checkbox" />
          <div>
            <div>Catat ke Laporan Divisi</div>
            <div class="draft-check-sub">Uang jalan &amp; uang beli material otomatis masuk Laporan Divisi › Armada › Pengeluaran Operasional Sopir.</div>
          </div>
        </label>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:34px;">#</th>
              <th style="min-width:190px;">Nama Sopir</th>
              <th style="min-width:130px;">Uang Jalan</th>
              <th style="min-width:200px;">Material</th>
              <th style="min-width:140px;">Uang Beli Material</th>
              <th style="min-width:170px;">Tujuan</th>
              <th style="min-width:130px;">Catatan</th>
              <th style="width:72px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in baris" :key="r.k">
              <td>{{ i + 1 }}</td>
              <td>
                <SearchableSelect
                  v-if="!r.sopirManual"
                  v-model="r.sopirId"
                  :options="sopirOptions"
                  placeholder="Pilih sopir..."
                  @change="pilihSopir(r)"
                />
                <input
                  v-else
                  v-model="r.sopirNama"
                  list="bt-sopir-list"
                  placeholder="Ketik nama sopir"
                  @change="cocokkanNama(r)"
                />
                <button type="button" class="link-btn" @click="toggleSopirManual(r)">
                  {{ r.sopirManual ? "← pilih dari daftar" : "✍ belum terdaftar? ketik manual" }}
                </button>
                <div v-if="r.noPolisi" class="msub" style="margin:2px 0 0;">{{ r.noPolisi }}</div>
              </td>
              <td><MoneyInput v-model="r.uangJalan" placeholder="0" /></td>
              <td>
                <SearchableSelect
                  v-if="!r.materialManual"
                  v-model="r.material"
                  :options="materialOptions"
                  placeholder="Pilih material..."
                />
                <input v-else v-model="r.material" list="bt-material-list" placeholder="Ketik material" />
                <button type="button" class="link-btn" @click="toggleMaterialManual(r)">
                  {{ r.materialManual ? "← pilih dari daftar" : "✍ ketik manual" }}
                </button>
              </td>
              <td><MoneyInput v-model="r.uangBeliMaterial" placeholder="0" /></td>
              <td><input v-model="r.tujuan" list="bt-tujuan-list" placeholder="mis. Cimanggis" /></td>
              <td><input v-model="r.catatan" placeholder="opsional" /></td>
              <td style="white-space:nowrap;">
                <button class="btn btn-sm btn-ghost" title="Salin baris ini (material, tujuan, uang)" @click="salinBaris(i)">⧉</button>
                <button class="btn btn-sm btn-danger" title="Hapus baris" @click="hapusBaris(i)">×</button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td><b>Total ({{ barisTerisi.length }} baris)</b></td>
              <td class="mono"><b>{{ rupiah(totalInput.uj) }}</b></td>
              <td></td>
              <td class="mono"><b>{{ rupiah(totalInput.bm) }}</b></td>
              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="bt-sopir-list"><option v-for="s in opsi.sopir" :key="s.id" :value="s.nama" /></datalist>
      <datalist id="bt-material-list"><option v-for="m in opsi.materialManual" :key="m" :value="m" /></datalist>
      <datalist id="bt-tujuan-list"><option v-for="t in opsi.tujuan" :key="t" :value="t" /></datalist>

      <div style="display:flex; gap:8px; justify-content:space-between; flex-wrap:wrap; margin-top:12px;">
        <button class="btn btn-ghost" @click="tambahBaris">+ Tambah baris</button>
        <button class="btn btn-primary" :disabled="saving" @click="simpanSemua">{{ saving ? "Menyimpan…" : "Simpan semua" }}</button>
      </div>
    </div>

    <!-- ================= FILTER ================= -->
    <div class="card" style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="margin:0;"><label>Dari</label><input v-model="filter.from" type="date" /></div>
      <div class="field" style="margin:0;"><label>Sampai</label><input v-model="filter.to" type="date" /></div>
      <div class="field" style="margin:0; min-width:200px;">
        <label>Sopir</label>
        <SearchableSelect v-model="filter.sopirId" :options="sopirOptions" placeholder="Semua sopir" />
      </div>
      <div class="field" style="margin:0; flex:1; min-width:200px;">
        <label>Cari (nama / material / tujuan)</label>
        <input v-model="filter.q" placeholder="mis. Cimanggis" />
      </div>
    </div>

    <!-- ================= RINGKASAN ================= -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:14px;">
      <div class="card" style="margin:0;"><div class="msub">Jumlah trip</div><b>{{ ringkasan.trip }}</b></div>
      <div class="card" style="margin:0;"><div class="msub">Total uang jalan</div><b>{{ rupiah(ringkasan.totalUangJalan) }}</b></div>
      <div class="card" style="margin:0;"><div class="msub">Total uang beli material</div><b>{{ rupiah(ringkasan.totalUangBeliMaterial) }}</b></div>
      <div class="card" style="margin:0;"><div class="msub">Total keluar</div><b>{{ rupiah(ringkasan.totalKeluar) }}</b></div>
    </div>

    <div v-if="ringkasan.perSopir.length" class="card" style="margin-bottom:14px;">
      <div class="section-title">Ringkasan per sopir <span class="tag">{{ ringkasan.perSopir.length }} sopir</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sopir</th>
              <th class="num">Trip</th>
              <th class="num">Uang Jalan</th>
              <th class="num">Uang Beli Material</th>
              <th class="num">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in ringkasan.perSopir" :key="(p.sopirId || '') + p.nama">
              <td>
                {{ p.nama }}
                <span v-if="!p.terdaftar" class="tag" style="margin-left:6px;">belum terdaftar</span>
              </td>
              <td class="num mono">{{ p.trip }}</td>
              <td class="num mono">{{ angka(p.uangJalan) }}</td>
              <td class="num mono">{{ angka(p.uangBeliMaterial) }}</td>
              <td class="num mono"><b>{{ angka(p.uangJalan + p.uangBeliMaterial) }}</b></td>
              <td style="text-align:right;">
                <button v-if="!p.terdaftar" class="btn btn-sm btn-gold" @click="daftarkan(p.nama)">Daftarkan sbg sopir</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ================= DAFTAR ================= -->
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!rows.length" class="empty">
      <div class="big">📒</div>
      <div>Belum ada catatan di periode ini.</div>
    </div>
    <div v-else class="card">
      <div class="section-title">Catatan tersimpan <span class="tag">{{ rows.length }} baris</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th class="num">Uang Jalan</th>
              <th>Material</th>
              <th class="num">Uang Beli Material</th>
              <th>Tujuan</th>
              <th>Laporan</th>
              <th></th>
            </tr>
          </thead>
          <tbody v-for="g in grup" :key="g.tanggal">
            <tr>
              <td colspan="7" style="background:#f3f6fb; font-weight:600;">
                {{ tglPanjang(g.tanggal) }}
                <span class="msub" style="margin-left:8px;">{{ g.list.length }} trip · uang jalan {{ rupiah(g.uj) }} · beli material {{ rupiah(g.bm) }}</span>
              </td>
            </tr>
            <tr v-for="r in g.list" :key="r.id">
              <td>
                {{ r.sopirNama }}
                <span v-if="!r.sopirId" class="tag" style="margin-left:6px;">belum terdaftar</span>
                <div v-if="r.noPolisi" class="msub" style="margin:0;">{{ r.noPolisi }}</div>
              </td>
              <td class="num mono">{{ angka(r.uangJalan) }}</td>
              <td>{{ r.material || "-" }}</td>
              <td class="num mono">{{ angka(r.uangBeliMaterial) }}</td>
              <td>
                {{ r.tujuan || "-" }}
                <div v-if="r.catatan" class="msub" style="margin:0;">{{ r.catatan }}</div>
              </td>
              <td>{{ r.masukLaporan ? "✓" : "—" }}</td>
              <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-sm btn-ghost" style="margin-right:6px;" @click="bukaEdit(r)">Edit</button>
                <button class="btn btn-sm btn-danger" @click="hapus(r)">Hapus</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ================= MODAL EDIT ================= -->
  <div v-if="edit" class="modal-bg" @click.self="edit = null">
    <div class="modal">
      <button class="modal-close" @click="edit = null">×</button>
      <h2>Edit catatan Tronton</h2>

      <div class="row">
        <div class="field">
          <label>Tanggal</label>
          <input v-model="edit.tanggal" type="date" />
        </div>
        <div class="field">
          <label>Nama Sopir</label>
          <SearchableSelect
            v-if="!edit.sopirManual"
            v-model="edit.sopirId"
            :options="sopirOptions"
            placeholder="Pilih sopir..."
            @change="pilihSopir(edit)"
          />
          <input v-else v-model="edit.sopirNama" list="bt-sopir-list" placeholder="Ketik nama sopir" @change="cocokkanNama(edit)" />
          <button type="button" class="link-btn" @click="toggleSopirManual(edit)">
            {{ edit.sopirManual ? "← pilih dari daftar" : "✍ ketik manual" }}
          </button>
        </div>
      </div>

      <div class="row">
        <div class="field"><label>Uang Jalan</label><MoneyInput v-model="edit.uangJalan" placeholder="0" /></div>
        <div class="field"><label>Uang Beli Material</label><MoneyInput v-model="edit.uangBeliMaterial" placeholder="0" /></div>
      </div>

      <div class="row">
        <div class="field">
          <label>Material</label>
          <SearchableSelect v-if="!edit.materialManual" v-model="edit.material" :options="materialOptions" placeholder="Pilih material..." />
          <input v-else v-model="edit.material" list="bt-material-list" placeholder="Ketik material" />
          <button type="button" class="link-btn" @click="toggleMaterialManual(edit)">
            {{ edit.materialManual ? "← pilih dari daftar" : "✍ ketik manual" }}
          </button>
        </div>
        <div class="field"><label>Tujuan</label><input v-model="edit.tujuan" list="bt-tujuan-list" /></div>
      </div>

      <div class="row">
        <div class="field"><label>No. Polisi <span class="optional">(opsional)</span></label><input v-model="edit.noPolisi" placeholder="B 1234 XX" /></div>
        <div class="field"><label>Catatan <span class="optional">(opsional)</span></label><input v-model="edit.catatan" /></div>
      </div>

      <label class="draft-check">
        <input v-model="edit.masukLaporan" type="checkbox" />
        <div>
          <div>Catat ke Laporan Divisi</div>
          <div class="draft-check-sub">Kalau dimatikan, baris otomatis di Laporan Divisi untuk catatan ini dihapus.</div>
        </div>
      </label>

      <div style="display:flex; gap:8px; justify-content:space-between; margin-top:8px;">
        <button class="btn btn-danger" @click="hapus({ id: edit.id, sopirNama: edit.sopirNama, tanggal: edit.tanggal })">Hapus</button>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-ghost" @click="edit = null">Batal</button>
          <button class="btn btn-primary" @click="simpanEdit">Simpan</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Aman dipakai ulang: aturan sama dengan yang sudah ada di Surat Jalan, diulang supaya halaman ini tidak bergantung urutan muat CSS. */
.draft-check { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 14px; cursor: pointer; }
.draft-check input { margin-top: 3px; }
.draft-check-sub { font-size: 11px; color: var(--ink-soft); }
.optional { font-weight: 400; color: var(--ink-soft); font-size: 11px; }
.link-btn { background: none; border: 0; color: #2563eb; cursor: pointer; padding: 0 4px; text-decoration: underline; font: inherit; font-size: 11px; font-weight: 400; }
</style>
