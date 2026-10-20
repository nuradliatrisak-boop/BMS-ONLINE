<script setup>
import { ref, computed, onMounted, watch } from "vue";
import * as XLSX from "xlsx";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

// Absensi & upah sopir, meniru lembar Excel "Rekap Ritase":
//  - Hari kerja = tanggal yang ada ritasenya (dari Rekap Ritase) + hari berstatus "Kerja"
//  - Tampilan Harian (per bulan) / Bulanan (per tahun) / Tahunan, + Pembayaran upah
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const STATUS = ["Kerja", "Libur", "Izin", "Sakit"];
const SINGKAT = { Kerja: "K", Libur: "L", Izin: "I", Sakit: "S", Ritase: "R" };
const rp = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

const tab = ref("harian"); // harian | bulanan | tahunan | bayar | master
const tahun = ref(now.getFullYear());
const bulan = ref(now.getMonth() + 1);
const loading = ref(false);

const data = ref({ sopir: [], absensi: [], upahPerHari: 0, bayar: [] });
const ritaseHari = ref({}); // { noPolisi: Set("YYYY-MM-DD") } dari Rekap Ritase

const draft = ref({ sopir: [], upahPerHari: "" });
const bayarForm = ref({ sopirId: "", tanggal: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, hari: "", catatan: "" });

async function load() {
  loading.value = true;
  try {
    data.value = await api.get("/absensi-sopir");
    draft.value = { sopir: data.value.sopir.map((s) => ({ ...s })), upahPerHari: String(data.value.upahPerHari || "") };
    if (!bayarForm.value.sopirId && data.value.sopir[0]) bayarForm.value.sopirId = data.value.sopir[0].id;
    await loadRitase();
    await sinkron(true);
  } catch (e) {
    toast(e?.message || "Gagal memuat data absensi");
  } finally {
    loading.value = false;
  }
}
async function loadRitase() {
  try {
    const d = await api.get(`/rekap-penjualan/ritase?from=${tahun.value}-01-01&to=${tahun.value}-12-31&sumber=gabung`);
    const m = {};
    for (const g of d.groups || []) m[g.noPolisi] = new Set((g.rows || []).map((r) => r.tanggal));
    ritaseHari.value = m;
  } catch (e) {
    console.error(e);
    ritaseHari.value = {};
  }
}
// Ambil sopir otomatis dari mobil yang ada di Rekap Ritase, nama sopirnya dari menu Armada/Sopir.
// auto=true: jalan sendiri saat daftar sopir masih kosong. auto=false: tombol manual (hanya menambah yang belum ada).
async function sinkron(auto = false) {
  if (auto && data.value.sopir.length) return;
  try {
    const nopols = Object.keys(ritaseHari.value).filter((n) => n && !n.startsWith("("));
    let armada = [];
    try {
      armada = await api.get("/armada");
    } catch {
      /* tanpa nama sopir pun tetap jalan */
    }
    const namaDari = new Map();
    for (const a of Array.isArray(armada) ? armada : armada.rows || []) {
      const n = String(a.nopol || "").toUpperCase().replace(/\s+/g, " ").trim();
      const nama = a.sopirRef?.nama || a.sopir;
      if (n && nama) namaDari.set(n, nama);
    }
    const ada = new Set(data.value.sopir.map((x) => x.noPolisi));
    const baru = nopols.filter((n) => !ada.has(n)).map((n) => ({ id: "", nama: namaDari.get(n) || `Sopir ${n}`, noPolisi: n }));
    if (!baru.length) {
      if (!auto) toast("Tidak ada mobil baru dari Rekap Ritase");
      return;
    }
    data.value = await api.put("/absensi-sopir/master", { sopir: [...data.value.sopir, ...baru], upahPerHari: data.value.upahPerHari });
    draft.value = { sopir: data.value.sopir.map((x) => ({ ...x })), upahPerHari: String(data.value.upahPerHari || "") };
    if (!bayarForm.value.sopirId && data.value.sopir[0]) bayarForm.value.sopirId = data.value.sopir[0].id;
    toast(`${baru.length} sopir ditambahkan dari Rekap Ritase`);
  } catch (e) {
    console.error(e);
    if (!auto) toast(e?.message || "Gagal mengambil data sopir");
  }
}
onMounted(load);
watch(tahun, loadRitase);

// ---- status per sopir per tanggal ----
const absensiMap = computed(() => {
  const m = new Map();
  for (const a of data.value.absensi) m.set(`${a.sopirId}|${a.tanggal}`, a);
  return m;
});
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// status efektif: input manual menang; kalau kosong tapi ada ritase -> "Ritase" (dihitung kerja)
function statusDi(s, tgl) {
  const a = absensiMap.value.get(`${s.id}|${tgl}`);
  if (a) return a.status;
  if (s.noPolisi && ritaseHari.value[s.noPolisi]?.has(tgl)) return "Ritase";
  return "";
}
const isKerja = (st) => st === "Kerja" || st === "Ritase";

const hariBulan = computed(() => {
  const n = new Date(tahun.value, bulan.value, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const d = i + 1;
    return { d, tgl: key(tahun.value, bulan.value, d), nama: HARI[new Date(tahun.value, bulan.value - 1, d).getDay()] };
  });
});

function hitung(s, prefix) {
  const r = { kerja: 0, libur: 0, izin: 0, sakit: 0 };
  const tglSet = new Set();
  for (const a of data.value.absensi) if (a.sopirId === s.id && a.tanggal.startsWith(prefix)) tglSet.add(a.tanggal);
  for (const t of ritaseHari.value[s.noPolisi] || []) if (t.startsWith(prefix)) tglSet.add(t);
  for (const t of tglSet) {
    const st = statusDi(s, t);
    if (isKerja(st)) r.kerja++;
    else if (st === "Libur") r.libur++;
    else if (st === "Izin") r.izin++;
    else if (st === "Sakit") r.sakit++;
  }
  return r;
}

const harianRows = computed(() =>
  data.value.sopir.map((s) => ({ s, cells: hariBulan.value.map((h) => statusDi(s, h.tgl)), total: hitung(s, `${tahun.value}-${pad(bulan.value)}`) }))
);
const bulananRows = computed(() =>
  data.value.sopir.map((s) => {
    const per = BULAN.map((_, i) => hitung(s, `${tahun.value}-${pad(i + 1)}`));
    return { s, per, total: per.reduce((a, x) => ({ kerja: a.kerja + x.kerja, libur: a.libur + x.libur, izin: a.izin + x.izin, sakit: a.sakit + x.sakit }), { kerja: 0, libur: 0, izin: 0, sakit: 0 }) };
  })
);
// Tahunan: semua tahun yang punya data (+ tahun terpilih)
const tahunList = computed(() => {
  const set = new Set([tahun.value]);
  for (const a of data.value.absensi) set.add(Number(a.tanggal.slice(0, 4)));
  for (const b of data.value.bayar) set.add(Number(b.tanggal.slice(0, 4)));
  return [...set].sort((a, b) => a - b);
});
const tahunanRows = computed(() =>
  data.value.sopir.map((s) => ({ s, per: tahunList.value.map((y) => hitung(s, String(y))) }))
);

// klik sel: Kerja -> Libur -> Izin -> Sakit -> kosong
async function ubahSel(s, tgl) {
  const cur = absensiMap.value.get(`${s.id}|${tgl}`)?.status || "";
  const next = cur === "" ? "Kerja" : STATUS[STATUS.indexOf(cur) + 1] || "";
  try {
    await api.post("/absensi-sopir/absensi", { sopirId: s.id, tanggal: tgl, status: next });
    const arr = data.value.absensi.filter((a) => !(a.sopirId === s.id && a.tanggal === tgl));
    if (next) arr.push({ sopirId: s.id, tanggal: tgl, status: next, catatan: "" });
    data.value = { ...data.value, absensi: arr };
  } catch (e) {
    toast(e?.message || "Gagal menyimpan");
  }
}

// ---- master sopir ----
function tambahSopir() {
  draft.value.sopir.push({ id: "", nama: "", noPolisi: "" });
}
async function simpanMaster() {
  try {
    data.value = await api.put("/absensi-sopir/master", { sopir: draft.value.sopir, upahPerHari: draft.value.upahPerHari });
    draft.value = { sopir: data.value.sopir.map((s) => ({ ...s })), upahPerHari: String(data.value.upahPerHari || "") };
    toast("Tersimpan");
  } catch (e) {
    toast(e?.message || "Gagal menyimpan");
  }
}

// ---- pembayaran ----
const namaSopir = (id) => data.value.sopir.find((s) => s.id === id)?.nama || "-";
const ringkasBayar = computed(() =>
  data.value.sopir.map((s) => {
    const kerja = hitung(s, "").kerja; // semua tahun
    const dibayar = data.value.bayar.filter((b) => b.sopirId === s.id).reduce((a, b) => a + b.hari, 0);
    const belum = Math.max(0, kerja - dibayar);
    return { s, kerja, dibayar, belum, rupiah: belum * data.value.upahPerHari };
  })
);
const totalBelum = computed(() => ringkasBayar.value.reduce((a, r) => a + r.rupiah, 0));
async function tambahBayar() {
  const f = bayarForm.value;
  try {
    await api.post("/absensi-sopir/bayar", f);
    bayarForm.value = { ...f, hari: "", catatan: "" };
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menyimpan pembayaran");
  }
}
async function hapusBayar(b) {
  if (!confirm(`Hapus pembayaran ${namaSopir(b.sopirId)} (${b.hari} hari)?`)) return;
  await api.delete(`/absensi-sopir/bayar/${b.id}`);
  await load();
}

// ---- export Excel (urutan sheet mirip file Excel kamu) ----
function exportExcel() {
  const wb = XLSX.utils.book_new();
  const h = [["Sopir", "No. Polisi", ...hariBulan.value.map((x) => `${x.nama} ${x.d}`), "Kerja", "Libur", "Izin", "Sakit"]];
  for (const r of harianRows.value) h.push([r.s.nama, r.s.noPolisi, ...r.cells.map((c) => c || ""), r.total.kerja, r.total.libur, r.total.izin, r.total.sakit]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`ABSENSI SOPIR ${BULAN[bulan.value - 1].toUpperCase()} ${tahun.value}`], [], ...h]), "Harian");
  const b = [["Sopir", ...BULAN.map((x) => x), "Total Kerja"]];
  for (const r of bulananRows.value) b.push([r.s.nama, ...r.per.map((p) => p.kerja), r.total.kerja]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`HARI KERJA PER BULAN ${tahun.value}`], [], ...b]), "Bulanan");
  const t = [["Sopir", ...tahunList.value.map(String)]];
  for (const r of tahunanRows.value) t.push([r.s.nama, ...r.per.map((p) => p.kerja)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["HARI KERJA PER TAHUN"], [], ...t]), "Tahunan");
  const p = [["Sopir", "No. Polisi", "Hari Kerja", "Dibayar (hari)", "Belum Dibayar (hari)", "Belum Dibayar (Rp)"]];
  for (const r of ringkasBayar.value) p.push([r.s.nama, r.s.noPolisi, r.kerja, r.dibayar, r.belum, r.rupiah]);
  p.push(["Total belum dibayar", "", "", "", "", totalBelum.value]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["PEMBAYARAN UPAH SOPIR"], [`Upah per hari (Rp): ${data.value.upahPerHari}`], [], ...p]), "Pembayaran");
  XLSX.writeFile(wb, `absensi-upah-sopir-${tahun.value}.xlsx`);
}
const warna = (st) => ({ Kerja: "#d9f2e1", Ritase: "#cfe8ff", Libur: "#eee", Izin: "#fff3c4", Sakit: "#ffd9d9" }[st] || "transparent");
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Absensi &amp; Upah Sopir</h1>
      <div class="desc">Hari kerja / libur sopir (harian, bulanan, tahunan) dan pembayaran upahnya. Hari yang ada ritasenya otomatis dihitung kerja.</div>
    </div>
    <div class="top-actions"><button class="btn btn-ghost" @click="exportExcel">⬇ Export Excel</button></div>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom: 12px">
      <div class="row" style="align-items: end; gap: 12px; flex-wrap: wrap">
        <div class="tabs-line">
          <button v-for="t in [['harian','Harian'],['bulanan','Bulanan'],['tahunan','Tahunan'],['bayar','Pembayaran Upah'],['master','Sopir & Tarif']]" :key="t[0]" class="btn" :class="tab === t[0] ? 'btn-primary' : 'btn-ghost'" @click="tab = t[0]">{{ t[1] }}</button>
        </div>
        <div class="field"><label>Tahun</label><input v-model.number="tahun" type="number" style="width: 90px" /></div>
        <div v-if="tab === 'harian'" class="field">
          <label>Bulan</label>
          <select v-model.number="bulan"><option v-for="(b, i) in BULAN" :key="i" :value="i + 1">{{ b }}</option></select>
        </div>
      </div>
    </div>

    <div v-if="!data.sopir.length && !loading" class="card">
      Belum ada sopir. Sopir otomatis diambil dari mobil di Rekap Ritase; kalau belum ada ritase tahun ini, tambahkan manual di tab <b>Sopir &amp; Tarif</b>.
    </div>

    <!-- HARIAN -->
    <div v-else-if="tab === 'harian'" class="card" style="overflow-x: auto">
      <div style="margin-bottom: 8px; font-size: 12px">
        Klik kotak untuk mengubah: kosong → <b>K</b>erja → <b>L</b>ibur → <b>I</b>zin → <b>S</b>akit → kosong. <b>R</b> (biru) = otomatis dari ritase.
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>Sopir</th>
            <th v-for="h in hariBulan" :key="h.d" style="text-align: center; min-width: 34px">{{ h.nama }}<br />{{ h.d }}</th>
            <th>Kerja</th><th>Libur</th><th>Izin</th><th>Sakit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in harianRows" :key="r.s.id">
            <td style="white-space: nowrap"><b>{{ r.s.nama }}</b><br /><small>{{ r.s.noPolisi }}</small></td>
            <td v-for="(c, i) in r.cells" :key="i" :style="{ background: warna(c), textAlign: 'center', cursor: 'pointer', userSelect: 'none' }" @click="ubahSel(r.s, hariBulan[i].tgl)">{{ SINGKAT[c] || "" }}</td>
            <td><b>{{ r.total.kerja }}</b></td><td>{{ r.total.libur }}</td><td>{{ r.total.izin }}</td><td>{{ r.total.sakit }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- BULANAN -->
    <div v-else-if="tab === 'bulanan'" class="card" style="overflow-x: auto">
      <table class="tbl">
        <thead><tr><th>Sopir</th><th v-for="b in BULAN" :key="b">{{ b.slice(0, 3) }}</th><th>Total Kerja</th><th>Libur</th><th>Izin</th><th>Sakit</th></tr></thead>
        <tbody>
          <tr v-for="r in bulananRows" :key="r.s.id">
            <td><b>{{ r.s.nama }}</b></td>
            <td v-for="(p, i) in r.per" :key="i" style="text-align: center">{{ p.kerja || "" }}</td>
            <td><b>{{ r.total.kerja }}</b></td><td>{{ r.total.libur }}</td><td>{{ r.total.izin }}</td><td>{{ r.total.sakit }}</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top: 6px; font-size: 12px">Angka = jumlah hari kerja per bulan tahun {{ tahun }}.</div>
    </div>

    <!-- TAHUNAN -->
    <div v-else-if="tab === 'tahunan'" class="card" style="overflow-x: auto">
      <table class="tbl">
        <thead><tr><th>Sopir</th><th v-for="y in tahunList" :key="y">{{ y }}</th></tr></thead>
        <tbody>
          <tr v-for="r in tahunanRows" :key="r.s.id">
            <td><b>{{ r.s.nama }}</b></td>
            <td v-for="(p, i) in r.per" :key="i">{{ p.kerja }} kerja · {{ p.libur }} libur · {{ p.izin + p.sakit }} izin/sakit</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- PEMBAYARAN -->
    <div v-else-if="tab === 'bayar'">
      <div class="card" style="margin-bottom: 12px; overflow-x: auto">
        <div style="margin-bottom: 8px">Upah per hari: <b>{{ rp(data.upahPerHari) }}</b> <small>(ubah di tab Sopir &amp; Tarif)</small></div>
        <table class="tbl">
          <thead><tr><th>Sopir</th><th>No. Polisi</th><th>Hari Kerja</th><th>Dibayar (hari)</th><th>Belum Dibayar (hari)</th><th>Belum Dibayar (Rp)</th></tr></thead>
          <tbody>
            <tr v-for="r in ringkasBayar" :key="r.s.id">
              <td><b>{{ r.s.nama }}</b></td><td>{{ r.s.noPolisi }}</td><td>{{ r.kerja }}</td><td>{{ r.dibayar }}</td><td>{{ r.belum }}</td><td>{{ rp(r.rupiah) }}</td>
            </tr>
            <tr><td colspan="5"><b>Total belum dibayar</b></td><td><b>{{ rp(totalBelum) }}</b></td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div style="font-weight: 600; margin-bottom: 8px">Catat pembayaran</div>
        <div class="row" style="gap: 10px; flex-wrap: wrap; align-items: end">
          <div class="field"><label>Sopir</label><select v-model="bayarForm.sopirId"><option v-for="s in data.sopir" :key="s.id" :value="s.id">{{ s.nama }}</option></select></div>
          <div class="field"><label>Tanggal bayar</label><input v-model="bayarForm.tanggal" type="date" /></div>
          <div class="field"><label>Dibayar (hari)</label><input v-model="bayarForm.hari" inputmode="decimal" placeholder="6" style="width: 90px" /></div>
          <div class="field"><label>Catatan</label><input v-model="bayarForm.catatan" /></div>
          <button class="btn btn-primary" @click="tambahBayar">+ Simpan</button>
        </div>
        <table v-if="data.bayar.length" class="tbl" style="margin-top: 10px">
          <thead><tr><th>Tanggal</th><th>Sopir</th><th>Hari</th><th>Rupiah</th><th>Catatan</th><th></th></tr></thead>
          <tbody>
            <tr v-for="b in [...data.bayar].sort((a, c) => c.tanggal.localeCompare(a.tanggal))" :key="b.id">
              <td>{{ b.tanggal }}</td><td>{{ namaSopir(b.sopirId) }}</td><td>{{ b.hari }}</td><td>{{ rp(b.hari * data.upahPerHari) }}</td><td>{{ b.catatan }}</td>
              <td><button class="btn btn-ghost" @click="hapusBayar(b)">Hapus</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- MASTER -->
    <div v-else class="card">
      <div class="row" style="gap: 10px; margin-bottom: 10px">
        <div class="field"><label>Upah per hari (Rp)</label><input v-model="draft.upahPerHari" inputmode="numeric" placeholder="500000" /></div>
      </div>
      <table class="tbl">
        <thead><tr><th>Nama Sopir</th><th>No. Polisi mobilnya</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in draft.sopir" :key="i">
            <td><input v-model="s.nama" placeholder="Nanang" /></td>
            <td><input v-model="s.noPolisi" placeholder="B 9661 UYW" /></td>
            <td><button class="btn btn-ghost" @click="draft.sopir.splice(i, 1)">Hapus</button></td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top: 10px; display: flex; gap: 8px">
        <button class="btn btn-ghost" @click="tambahSopir">+ Tambah sopir</button>
        <button class="btn btn-ghost" @click="sinkron(false)">↻ Ambil dari Rekap Ritase</button>
        <button class="btn btn-primary" @click="simpanMaster">Simpan</button>
      </div>
    </div>
  </div>
</template>