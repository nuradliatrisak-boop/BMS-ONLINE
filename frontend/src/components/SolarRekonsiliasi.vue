<!-- Cek Buku vs Real (Stok Solar).
     Membandingkan isi BUKU catatan dengan setoran REAL (Solar Masuk), supaya
     kelihatan dua jenis kesalahan:
       1. Tercatat di buku harus setor, tapi di real TIDAK setor.
       2. Di real setor, tapi TIDAK tercatat di buku.
     Plus selisih liter kalau dua-duanya ada. Data dari GET /api/solar-buku/rekonsiliasi. -->
<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { fmtL, fmtTgl } from "../utils/solarUtil.js";

const props = defineProps({ versi: { type: Number, default: 0 } });
const emit = defineEmits(["input-real", "berubah"]);

const hariIni = new Date().toLocaleDateString("en-CA");
const awalBulan = `${hariIni.slice(0, 8)}01`;

const dari = ref(awalBulan);
const sampai = ref(hariIni);
const data = ref(null);
const loading = ref(false);
const filter = ref(""); // "" = hanya yang bermasalah, "SEMUA", atau status tertentu
const bukaIsi = ref(false);

const tglBuku = ref(hariIni);
const teksBuku = ref("");
const menyimpan = ref(false);

const STATUS = {
  SESUAI: { label: "Sesuai", kelas: "badge b-lunas" },
  KURANG: { label: "Kurang setor", kelas: "badge b-belum" },
  LEBIH: { label: "Lebih setor", kelas: "badge b-sebagian" },
  TIDAK_SETOR: { label: "Di buku, tidak setor", kelas: "badge b-belum" },
  TIDAK_DI_BUKU: { label: "Setor, tidak di buku", kelas: "badge b-sebagian" },
  MENUNGGU: { label: "Menunggu (hari ini)", kelas: "badge b-belumttd" },
};
const MASALAH = ["TIDAK_SETOR", "TIDAK_DI_BUKU", "KURANG", "LEBIH"];

async function muat() {
  if (!dari.value || !sampai.value) return;
  loading.value = true;
  try {
    data.value = await api.get(`/solar-buku/rekonsiliasi?dari=${dari.value}&sampai=${sampai.value}`);
  } catch (e) {
    toast(e?.message || "Gagal memuat perbandingan buku dan real");
  } finally {
    loading.value = false;
  }
}

onMounted(muat);
watch(() => props.versi, muat);

const ringkasan = computed(() => data.value?.ringkasan || {});
const barisTampil = computed(() => {
  const rows = data.value?.rows || [];
  if (filter.value === "SEMUA") return rows;
  if (filter.value) return rows.filter((r) => r.status === filter.value);
  return rows.filter((r) => MASALAH.includes(r.status));
});
const adaMasalah = computed(() => MASALAH.some((s) => (data.value?.rows || []).some((r) => r.status === s)));

function pilihFilter(f) {
  filter.value = filter.value === f ? "" : f;
}

// ---------- Isi buku ----------
// Satu baris = satu sopir. Contoh: "Aceng 200", "Budi - 150", "Wartono: 1.200"
function parseBaris(teks) {
  const items = [];
  const gagal = [];
  for (const mentah of String(teks || "").split(/\r?\n/)) {
    const baris = mentah.trim();
    if (!baris) continue;
    const m = baris.match(/^(.*?)[\s:=\-–]+([\d.,]+)\s*(?:l|lt|ltr|liter)?\.?$/i);
    if (!m || !m[1].trim()) {
      gagal.push(baris);
      continue;
    }
    let angka = m[2];
    if (/^\d{1,3}(\.\d{3})+$/.test(angka)) angka = angka.replace(/\./g, "");
    const liter = Number(angka.replace(",", "."));
    if (!Number.isFinite(liter) || liter <= 0) {
      gagal.push(baris);
      continue;
    }
    items.push({ nama: m[1].trim(), liter });
  }
  return { items, gagal };
}
const hasilParse = computed(() => parseBaris(teksBuku.value));

async function simpanBuku() {
  const { items, gagal } = hasilParse.value;
  if (!items.length) return toast("Belum ada baris yang valid. Format: Nama spasi liter, contoh: Aceng 200");
  if (gagal.length && !confirm(`${gagal.length} baris tidak terbaca dan akan dilewati:\n\n${gagal.join("\n")}\n\nLanjut simpan ${items.length} baris yang valid?`)) return;
  menyimpan.value = true;
  try {
    const r = await api.post("/solar-buku/massal", { tanggal: tglBuku.value, items });
    toast(`${r.disimpan} baris buku disimpan${r.dilewati.length ? `, ${r.dilewati.length} dilewati (sudah ada / tidak valid)` : ""}`);
    teksBuku.value = "";
    if (tglBuku.value < dari.value) dari.value = tglBuku.value;
    if (tglBuku.value > sampai.value) sampai.value = tglBuku.value;
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal menyimpan isi buku");
  } finally {
    menyimpan.value = false;
  }
}

// ---------- Aksi per baris ----------
async function masukkanKeBuku(r) {
  try {
    for (const id of r.realIds) await api.post("/solar-buku/dari-real", { solarTxId: id });
    toast(`${r.nama} (${fmtL(r.realLiter)} L) dimasukkan ke buku`);
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal memasukkan ke buku");
  }
}

async function ubahBuku(r) {
  if (r.bukuIds.length !== 1) return toast("Ada lebih dari satu baris buku untuk nama ini, hapus lalu isi ulang.");
  const v = prompt(`Liter di buku untuk ${r.nama} (${fmtTgl(r.tanggal)}):`, String(r.bukuLiter));
  if (v === null) return;
  const liter = Number(String(v).replace(",", "."));
  if (!Number.isFinite(liter) || liter <= 0) return toast("Liter harus angka lebih dari 0");
  try {
    await api.put(`/solar-buku/${r.bukuIds[0]}`, { liter });
    toast("Isi buku diperbarui");
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal memperbarui isi buku");
  }
}

async function hapusBuku(r) {
  if (!confirm(`Hapus ${r.nama} (${fmtL(r.bukuLiter)} L) dari buku tanggal ${fmtTgl(r.tanggal)}? Setoran real tidak ikut terhapus.`)) return;
  try {
    for (const id of r.bukuIds) await api.delete(`/solar-buku/${id}`);
    toast("Dihapus dari buku");
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal menghapus dari buku");
  }
}

const fmtSelisih = (r) => {
  if (r.status === "KURANG") return `−${fmtL(Math.abs(r.selisih))} L`;
  if (r.status === "LEBIH") return `+${fmtL(r.selisih)} L`;
  if (r.status === "TIDAK_SETOR") return `−${fmtL(r.bukuLiter)} L`;
  if (r.status === "TIDAK_DI_BUKU") return `+${fmtL(r.realLiter)} L`;
  return "-";
};
</script>

<template>
  <div class="card" style="margin-bottom: 20px" :style="adaMasalah ? 'border-color: #f3b4b4' : ''">
    <div class="section-title">
      Cek Buku vs Real
      <span v-if="data" class="tag">{{ data.rows.length }} baris dibandingkan</span>
    </div>
    <div class="msub" style="margin-bottom: 12px">
      Mencocokkan isi buku catatan dengan setoran real (Solar Masuk) per tanggal dan nama sopir. Kelihatan siapa yang
      <b>tercatat di buku tapi tidak setor</b>, siapa yang <b>setor tapi tidak tercatat di buku</b>, dan siapa yang jumlahnya beda.
    </div>

    <div class="rk-bar">
      <div class="field" style="margin: 0">
        <label>Dari</label>
        <input v-model="dari" type="date" @change="muat" />
      </div>
      <div class="field" style="margin: 0">
        <label>Sampai</label>
        <input v-model="sampai" type="date" @change="muat" />
      </div>
      <button class="btn btn-ghost" @click="bukaIsi = !bukaIsi">{{ bukaIsi ? "Tutup" : "+ Isi buku" }}</button>
    </div>

    <!-- Isi buku -->
    <div v-if="bukaIsi" class="rk-isi">
      <div class="rk-isi-grid">
        <div class="field" style="margin: 0">
          <label>Tanggal di buku</label>
          <input v-model="tglBuku" type="date" />
        </div>
        <div class="field" style="margin: 0">
          <label>Isi buku (satu baris satu sopir)</label>
          <textarea v-model="teksBuku" rows="5" placeholder="Aceng 200&#10;Budi 150&#10;Wartono 100"></textarea>
        </div>
      </div>
      <div class="msub" style="margin: 6px 0 10px">
        Format: <b>Nama [spasi] liter</b>. Terbaca <b>{{ hasilParse.items.length }}</b> baris<template v-if="hasilParse.gagal.length">,
        <span style="color: #b91c1c">{{ hasilParse.gagal.length }} tidak terbaca</span></template>.
        Nama yang mirip dengan data setoran (huruf besar/kecil, singkatan) otomatis disamakan.
      </div>
      <button class="btn btn-primary" :disabled="menyimpan || !hasilParse.items.length" @click="simpanBuku">
        {{ menyimpan ? "Menyimpan..." : `Simpan ke buku (${hasilParse.items.length})` }}
      </button>
    </div>

    <div v-if="loading && !data" class="empty small">Memuat…</div>

    <template v-if="data">
      <!-- Ringkasan -->
      <div class="rk-kpis">
        <button class="rk-kpi" :class="{ aktif: filter === 'TIDAK_SETOR' }" style="--c: #c91c22" @click="pilihFilter('TIDAK_SETOR')">
          <div class="rk-lbl">Di buku, tidak setor</div>
          <div class="rk-val">{{ ringkasan.tidakSetor || 0 }}</div>
          <div class="rk-sub">{{ fmtL(ringkasan.literTidakSetor) }} L</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'TIDAK_DI_BUKU' }" style="--c: #c47b12" @click="pilihFilter('TIDAK_DI_BUKU')">
          <div class="rk-lbl">Setor, tidak di buku</div>
          <div class="rk-val">{{ ringkasan.tidakDiBuku || 0 }}</div>
          <div class="rk-sub">{{ fmtL(ringkasan.literTidakDiBuku) }} L</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'KURANG' }" style="--c: #c91c22" @click="pilihFilter('KURANG')">
          <div class="rk-lbl">Kurang setor</div>
          <div class="rk-val">{{ ringkasan.kurang || 0 }}</div>
          <div class="rk-sub">{{ fmtL(ringkasan.literKurang) }} L</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'LEBIH' }" style="--c: #c47b12" @click="pilihFilter('LEBIH')">
          <div class="rk-lbl">Lebih setor</div>
          <div class="rk-val">{{ ringkasan.lebih || 0 }}</div>
          <div class="rk-sub">{{ fmtL(ringkasan.literLebih) }} L</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'SESUAI' }" style="--c: #159447" @click="pilihFilter('SESUAI')">
          <div class="rk-lbl">Sesuai</div>
          <div class="rk-val">{{ ringkasan.sesuai || 0 }}</div>
          <div class="rk-sub">buku = real</div>
        </button>
      </div>

      <div v-if="data.tanggalBukuKosong.length" class="rk-info">
        <b>{{ data.tanggalBukuKosong.length }} tanggal belum ada isi bukunya</b> (ada setoran real tapi buku belum diisi), jadi tidak dihitung
        sebagai "tidak di buku":
        {{ data.tanggalBukuKosong.slice(0, 6).map((t) => fmtTgl(t.tanggal)).join(", ") }}<template v-if="data.tanggalBukuKosong.length > 6"> dan {{ data.tanggalBukuKosong.length - 6 }} lainnya</template>.
        Klik <b>+ Isi buku</b> untuk melengkapi.
      </div>

      <!-- Per sopir -->
      <div v-if="data.perSopir.length" style="margin: 14px 0">
        <div class="msub" style="font-weight: 600; margin-bottom: 6px">Rekap per sopir (yang bermasalah)</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sopir</th>
                <th class="num">Di buku, tidak setor</th>
                <th class="num">Setor, tidak di buku</th>
                <th class="num">Kurang (L)</th>
                <th class="num">Lebih (L)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in data.perSopir" :key="s.nama">
                <td>{{ s.nama }}</td>
                <td class="num mono">
                  <span v-if="s.tidakSetor" style="color: #b91c1c; font-weight: 600">{{ s.tidakSetor }}× ({{ fmtL(s.literTidakSetor) }} L)</span><span v-else>-</span>
                </td>
                <td class="num mono">
                  <span v-if="s.tidakDiBuku" style="color: #b45309; font-weight: 600">{{ s.tidakDiBuku }}× ({{ fmtL(s.literTidakDiBuku) }} L)</span><span v-else>-</span>
                </td>
                <td class="num mono">{{ s.kurangLiter ? fmtL(s.kurangLiter) : "-" }}</td>
                <td class="num mono">{{ s.lebihLiter ? fmtL(s.lebihLiter) : "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail -->
      <div style="display: flex; align-items: center; gap: 10px; margin: 14px 0 6px; flex-wrap: wrap">
        <div class="msub" style="font-weight: 600; margin: 0">
          {{ filter === "SEMUA" ? "Semua baris" : filter ? STATUS[filter]?.label : "Yang perlu dicek" }}
        </div>
        <button class="btn btn-ghost btn-sm" @click="filter = filter === 'SEMUA' ? '' : 'SEMUA'">
          {{ filter === "SEMUA" ? "Hanya yang bermasalah" : "Tampilkan semua" }}
        </button>
        <button v-if="filter && filter !== 'SEMUA'" class="btn btn-ghost btn-sm" @click="filter = ''">Reset filter</button>
      </div>

      <div v-if="!barisTampil.length" class="empty small">
        <template v-if="!data.rows.length">Belum ada isi buku maupun setoran pada periode ini.</template>
        <template v-else-if="!filter">Tidak ada selisih. Semua yang tercatat di buku sesuai dengan setoran real. 🎉</template>
        <template v-else>Tidak ada baris untuk filter ini.</template>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Sopir</th>
              <th class="num">Buku (L)</th>
              <th class="num">Real (L)</th>
              <th>Status</th>
              <th class="num">Selisih</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in barisTampil" :key="r.tanggal + r.nama + r.status" :style="r.status === 'TIDAK_SETOR' ? 'background: var(--bms-red-soft)' : ''">
              <td style="white-space: nowrap">{{ fmtTgl(r.tanggal) }}</td>
              <td>
                {{ r.nama }}
                <div v-if="r.bukuSumber === 'CATATAN_REAL'" class="msub" style="font-size: 11px">buku dari catatan lama di setoran</div>
                <div v-if="r.keterangan" class="msub" style="font-size: 11px">{{ r.keterangan }}</div>
              </td>
              <td class="num mono">{{ r.bukuLiter == null ? "—" : fmtL(r.bukuLiter) }}</td>
              <td class="num mono">{{ r.status === "TIDAK_SETOR" || r.status === "MENUNGGU" ? "0" : fmtL(r.realLiter) }}</td>
              <td><span :class="STATUS[r.status]?.kelas">{{ STATUS[r.status]?.label }}</span></td>
              <td class="num mono">{{ fmtSelisih(r) }}</td>
              <td style="white-space: nowrap">
                <button v-if="r.status === 'TIDAK_DI_BUKU'" class="btn btn-sm btn-primary" @click="masukkanKeBuku(r)">+ Masukkan ke buku</button>
                <button v-if="r.status === 'TIDAK_SETOR' || r.status === 'MENUNGGU'" class="btn btn-sm btn-ghost" title="Ternyata sudah setor, catat di Solar Masuk" @click="emit('input-real', r)">Catat setoran</button>
                <template v-if="r.bukuIds.length">
                  <button class="btn btn-sm btn-ghost" @click="ubahBuku(r)">Ubah buku</button>
                  <button class="btn btn-sm btn-ghost" @click="hapusBuku(r)">Hapus buku</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rk-bar { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px; }
.rk-isi { background: #f7f9fc; border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 14px; }
.rk-isi-grid { display: grid; grid-template-columns: 180px 1fr; gap: 12px; }
.rk-isi textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13px; resize: vertical; }
.rk-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 4px; }
.rk-kpi { text-align: left; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--c); border-radius: 10px; padding: 10px 12px; cursor: pointer; font: inherit; }
.rk-kpi.aktif { background: #fff8e6; box-shadow: 0 0 0 2px var(--c) inset; }
.rk-lbl { font-size: 11px; color: var(--ink-soft); }
.rk-val { font-size: 22px; font-weight: 800; color: var(--c); }
.rk-sub { font-size: 11px; color: var(--ink-soft); }
.rk-info { margin-top: 12px; font-size: 12px; background: #fff7e6; border: 1px solid #f3dfb0; color: #8a5a00; border-radius: 8px; padding: 8px 10px; line-height: 1.5; }
@media (max-width: 700px) { .rk-isi-grid { grid-template-columns: 1fr; } }
</style>
