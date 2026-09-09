<script setup>
// Checklist harian "Jadwal Setor Solar": daftar sopir yang wajib
// menyetorkan sejumlah liter solar pada satu tanggal. Staff input daftar
// ini manual tiap hari (nama + liter wajib), lalu tinggal dicentang kalau
// pas, atau isi angka aktual kalau beda. Sopir yang tidak ada di daftar
// tapi tetap setor tinggal ditambah lewat tombol yang sama.
import { ref, onMounted, watch, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const tanggal = ref(new Date().toISOString().slice(0, 10));
const list = ref([]);
const loading = ref(true);
const utang = ref([]);
const utangLoading = ref(true);

// Input "liter aktual" per baris (cuma dipakai kalau mau ketik beda dari wajib)
const aktualInput = ref({}); // { [id]: string }
const catatanInput = ref({}); // { [id]: string }

async function load() {
  loading.value = true;
  try {
    list.value = await api.get(`/solar-jadwal?tanggal=${tanggal.value}`);
    for (const j of list.value) {
      if (catatanInput.value[j.id] === undefined) catatanInput.value[j.id] = j.catatan || "";
    }
  } catch (e) {
    toast(e.message || "Gagal memuat jadwal setor solar");
  } finally {
    loading.value = false;
  }
}

async function loadUtang() {
  utangLoading.value = true;
  try {
    utang.value = await api.get("/solar-jadwal/utang");
  } catch (e) {
    console.error(e);
  } finally {
    utangLoading.value = false;
  }
}

watch(tanggal, load);
onMounted(() => {
  load();
  loadUtang();
});

// --- Tambah baris jadwal (dipakai juga untuk sopir dadakan yang tidak
// ada di daftar awal tapi tetap setor) ---
const showTambah = ref(false);
const tambahForm = ref({ nama: "", literWajib: "", noSuratJalan: "", catatan: "" });

function bukaTambah() {
  tambahForm.value = { nama: "", literWajib: "", noSuratJalan: "", catatan: "" };
  showTambah.value = true;
}

async function simpanTambah() {
  if (!tambahForm.value.nama.trim()) return toast("Nama sopir wajib diisi");
  const literNum = Number(tambahForm.value.literWajib);
  if (!literNum || literNum <= 0) return toast("Jumlah liter wajib harus lebih dari 0");
  try {
    await api.post("/solar-jadwal", { ...tambahForm.value, tanggal: tanggal.value });
    toast("Baris jadwal ditambahkan");
    showTambah.value = false;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menambah jadwal");
  }
}

// --- Centang: pas (tanpa ketik) atau beda (pakai angka di kolom aktual) ---
async function centangSesuai(j) {
  try {
    await api.post(`/solar-jadwal/${j.id}/centang`, { catatan: catatanInput.value[j.id] });
    toast(`${j.nama} — setor dicatat sesuai (${j.literWajib} L)`);
    await Promise.all([load(), loadUtang()]);
  } catch (e) {
    toast(e.message || "Gagal mencatat setor");
  }
}

async function simpanBeda(j) {
  const nilai = aktualInput.value[j.id];
  const literNum = Number(nilai);
  if (nilai === undefined || nilai === "" || Number.isNaN(literNum)) {
    return toast("Isi dulu jumlah liter yang aktual disetor");
  }
  try {
    await api.post(`/solar-jadwal/${j.id}/centang`, {
      literSetor: literNum,
      catatan: catatanInput.value[j.id],
    });
    toast(`${j.nama} — setor dicatat (${literNum} L)`);
    await Promise.all([load(), loadUtang()]);
  } catch (e) {
    toast(e.message || "Gagal mencatat setor");
  }
}

async function batalkan(j) {
  if (!confirm(`Batalkan catatan setor untuk ${j.nama}? Baris stok solar terkait juga akan dihapus.`)) return;
  try {
    await api.post(`/solar-jadwal/${j.id}/batal`);
    toast("Dibatalkan, kembali ke status Belum");
    await Promise.all([load(), loadUtang()]);
  } catch (e) {
    toast(e.message || "Gagal membatalkan");
  }
}

async function hapus(j) {
  if (!confirm(`Hapus baris jadwal ${j.nama}?`)) return;
  try {
    await api.delete(`/solar-jadwal/${j.id}`);
    toast("Baris jadwal dihapus");
    await Promise.all([load(), loadUtang()]);
  } catch (e) {
    toast(e.message || "Gagal menghapus");
  }
}

function statusBadgeClass(status) {
  if (status === "SESUAI") return "badge b-lunas";
  if (status === "SELISIH") return "badge b-sebagian";
  return "badge b-belumttd";
}
function statusLabel(status) {
  if (status === "SESUAI") return "Sesuai";
  if (status === "SELISIH") return "Selisih";
  return "Belum";
}

const totalWajib = computed(() => list.value.reduce((s, j) => s + j.literWajib, 0));
const totalSetor = computed(() =>
  list.value.reduce((s, j) => s + (j.status !== "BELUM" ? j.literSetor ?? j.literWajib : 0), 0)
);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Jadwal Setor Solar</h1>
      <div class="desc">Checklist harian — daftar sopir yang wajib menyetor solar</div>
    </div>
    <button class="btn btn-primary" @click="bukaTambah">+ Tambah Sopir</button>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom: 16px;">
      <div class="row">
        <div class="field">
          <label>Tanggal Wajib Setor</label>
          <input v-model="tanggal" type="date" />
        </div>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">⛽</div>
      <div>Belum ada jadwal setor untuk tanggal ini.</div>
      <button class="btn btn-primary" style="margin-top:14px;" @click="bukaTambah">+ Tambah Sopir</button>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Daftar Setor — {{ new Date(tanggal).toLocaleDateString("id-ID") }}
        <span class="tag">{{ list.length }} Sopir</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Nama Sopir</th>
            <th class="num">Wajib (L)</th>
            <th>Status</th>
            <th>Realisasi / Aksi</th>
            <th>Catatan</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="j in list" :key="j.id">
            <td>
              {{ j.nama }}
              <div v-if="!j.terjadwal" class="tag" style="margin-top: 4px;">Dadakan</div>
              <div v-if="j.noSuratJalan" class="msub" style="font-size: 11px;">SJ: {{ j.noSuratJalan }}</div>
            </td>
            <td class="num mono">{{ j.literWajib }}</td>
            <td><span :class="statusBadgeClass(j.status)">{{ statusLabel(j.status) }}</span></td>

            <td>
              <template v-if="j.status === 'BELUM'">
                <div style="display:flex; gap:6px; flex-wrap: wrap; align-items:center;">
                  <button class="btn btn-sm btn-primary" @click="centangSesuai(j)">✓ Sesuai ({{ j.literWajib }} L)</button>
                  <input
                    v-model="aktualInput[j.id]"
                    type="number"
                    step="0.1"
                    placeholder="Kalau beda, isi L"
                    style="width: 110px;"
                  />
                  <button class="btn btn-sm btn-ghost" @click="simpanBeda(j)">Simpan Beda</button>
                </div>
              </template>
              <template v-else>
                <div class="mono">{{ j.literSetor }} L</div>
                <div v-if="j.status === 'SELISIH'" class="msub" style="font-size: 11px;">
                  Selisih {{ (j.literWajib - j.literSetor) > 0 ? "kurang" : "lebih" }}
                  {{ Math.abs(j.literWajib - j.literSetor) }} L
                </div>
              </template>
            </td>

            <td>
              <input v-model="catatanInput[j.id]" placeholder="Opsional" style="min-width: 140px;" />
            </td>

            <td style="text-align:right; white-space: nowrap;">
              <button v-if="j.status !== 'BELUM'" class="btn btn-sm btn-ghost" style="margin-right:6px;" @click="batalkan(j)">
                Batalkan
              </button>
              <button class="btn btn-sm btn-danger" @click="hapus(j)">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="msub" style="margin-top: 10px;">
        Total wajib: <b class="mono">{{ totalWajib }} L</b> — Total tersetor: <b class="mono">{{ totalSetor }} L</b>
      </div>
    </div>

    <!-- Rekap Utang Solar per Sopir -->
    <div class="card" style="margin-top: 20px;">
      <div class="section-title">Rekap Utang Solar per Sopir</div>
      <div class="msub" style="margin-bottom: 10px;">
        Saldo utang dihitung otomatis dari akumulasi selisih (wajib − aktual) semua tanggal yang sudah direalisasi.
        Kelebihan setor di hari lain otomatis menutup kekurangan sebelumnya.
      </div>

      <div v-if="utangLoading" class="empty" style="padding: 10px 0;">Memuat rekap…</div>
      <div v-else-if="!utang.length" class="empty" style="padding: 10px 0;">Belum ada data realisasi setor.</div>

      <table v-else>
        <thead>
          <tr>
            <th>Nama Sopir</th>
            <th class="num">Total Wajib (L)</th>
            <th class="num">Total Setor (L)</th>
            <th class="num">Saldo Utang (L)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in utang" :key="r.nama">
            <td>{{ r.nama }}</td>
            <td class="num mono">{{ r.totalWajib }}</td>
            <td class="num mono">{{ r.totalSetor }}</td>
            <td class="num mono" :style="{ color: r.saldoUtang > 0 ? 'var(--red, #dc2626)' : 'var(--green,#16a34a)' }">
              {{ r.saldoUtang > 0 ? r.saldoUtang : 0 }}
              <span v-if="r.saldoUtang <= 0" style="font-size: 11px; font-weight: 400;">(lunas)</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Modal Tambah Sopir -->
  <div v-if="showTambah" class="modal-bg" @click.self="showTambah = false">
    <div class="modal">
      <button class="modal-close" @click="showTambah = false">×</button>
      <h2>Tambah Sopir ke Jadwal</h2>
      <div class="msub">Untuk tanggal {{ new Date(tanggal).toLocaleDateString("id-ID") }}</div>

      <div class="row">
        <div class="field">
          <label>Nama Sopir</label>
          <input v-model="tambahForm.nama" placeholder="Nama sopir" />
        </div>
        <div class="field">
          <label>Liter Wajib Disetor</label>
          <input v-model="tambahForm.literWajib" type="number" step="0.1" placeholder="0" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>No. Surat Jalan (opsional)</label>
          <input v-model="tambahForm.noSuratJalan" />
        </div>
        <div class="field">
          <label>Catatan (opsional)</label>
          <input v-model="tambahForm.catatan" />
        </div>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
        <button class="btn btn-ghost" @click="showTambah = false">Batal</button>
        <button class="btn btn-primary" @click="simpanTambah">Simpan</button>
      </div>
    </div>
  </div>
</template>
