<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { printGrid, printSJ, printSJBlank, printInvoice } from "../services/print.js";

const tab = ref("sj");
const loading = ref(true);
const saving = ref(false);

const sj = ref(null);
const inv = ref(null);

const sjFieldLabels = {
  apDari: "A/P Dari",
  penerima: "Penerima",
  no: "Nomor SJ",
  tanggal: "Tanggal",
  jam: "Jam",
  tujuan: "Tujuan",
  jenisBarang: "Jenis Barang",
  nopol: "Nomor Polisi",
  ukuranBak: "Ukuran Bak (P L T)",
  m3: "M3",
  sopirNama: "Nama Sopir",
  hormatKamiNama: "Nama Penandatangan (Hormat kami)",
};

async function load() {
  loading.value = true;
  try {
    const data = await api.get("/print-calib");
    sj.value = data.sj;
    inv.value = data.inv;
  } catch (e) {
    toast(e?.message || "Gagal memuat kalibrasi cetak");
  } finally {
    loading.value = false;
  }
}

async function save(jenis) {
  saving.value = true;
  try {
    const body = jenis === "sj" ? sj.value : inv.value;
    await api.put(`/print-calib/${jenis}`, body);
    toast("Kalibrasi berhasil disimpan");
  } catch (e) {
    toast(e?.message || "Gagal menyimpan kalibrasi");
  } finally {
    saving.value = false;
  }
}

function cetakGridSJ() {
  printGrid(sj.value.w, sj.value.h);
}
function cetakGridInv() {
  printGrid(inv.value.w, inv.value.h);
}

function cetakBlankoSJ() {
  printSJBlank();
}

function cetakContohSJ() {
  printSJ({
    no: "SJ-CONTOH-001",
    tanggal: new Date(),
    jam: "10:30",
    tujuan: "JAKARTA UTARA - CONTOH TUJUAN",
    jenisBarang: "BATU SPLIT (CONTOH)",
    noPolisi: "B 1234 CD",
    customer: { kode: "TS001", nama: "CONTOH CUSTOMER" },
    panjang: 4,
    lebar: 2,
    tinggi: 1.5,
    m3: 12,
    sopir: "CONTOH NAMA SOPIR",
  });
}

function cetakContohInvoice() {
  printInvoice({
    no: "INV-CONTOH-001",
    halaman: 1,
    tanggal: new Date(),
    divisi: "Supplier",
    customer: { kode: "TS001", nama: "TB. CONTOH PELANGGAN", alamat: "Jl. Contoh No. 1, Jakarta", npwp: "-" },
    catatan: "Ini contoh invoice untuk kalibrasi cetak.",
    dibayar: 0,
    sisaTagihan: 3000000,
    total: 3000000,
    items: [
      {
        keterangan: "Contoh Barang",
        qty: 1,
        satuan: "Rit",
        hargaSatuan: 3000000,
        suratJalan: {
          tanggal: new Date(),
          no: "SJ-CONTOH-001",
          sopir: "CONTOH NAMA SOPIR",
          tujuan: "JAKARTA UTARA",
          panjang: 4,
          lebar: 2,
          tinggi: 1.5,
          m3: 12,
        },
      },
    ],
  });
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Kalibrasi Cetak</h1>
      <div class="desc">Atur posisi cetak Surat Jalan &amp; Invoice supaya pas dengan kertas berlubang milik kamu</div>
    </div>
  </div>

  <div class="content">
    <div v-if="loading" class="empty"><div class="big">◌</div>Memuat kalibrasi...</div>

    <template v-else>
      <div class="card calib-intro">
        <strong>Cara kalibrasi (butuh printer + kertas asli sekarang):</strong>
        <ol>
          <li>Pasang kertas continuous form kamu ke printer, lalu klik <b>"Cetak Kotak Bantu (grid 5mm)"</b> di bawah — ini akan mencetak garis bantu tiap 5mm di seluruh kertas.</li>
          <li>Lihat hasil cetak: ukur dari tepi kertas ke posisi yang seharusnya (misal ke kotak "Nomor Polisi") pakai penggaris, dalam satuan milimeter.</li>
          <li>Masukkan angka hasil ukur ke kolom X (dari kiri) dan Y (dari atas) di bawah untuk tiap data.</li>
          <li>Klik <b>"Simpan"</b>, lalu klik <b>"Cetak Contoh"</b> untuk cek hasilnya di kertas asli. Ulangi sampai pas persis.</li>
        </ol>
      </div>

      <div class="calib-tabs">
        <button class="btn" :class="tab === 'sj' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'sj'">Surat Jalan</button>
        <button class="btn" :class="tab === 'inv' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'inv'">Invoice</button>
      </div>

      <div v-if="tab === 'sj'" class="card calib-card">
        <div class="form-section-title">Ukuran Kertas &amp; Posisi Global</div>
        <div class="row4">
          <div class="field"><label>Lebar kertas (mm)</label><input v-model.number="sj.w" type="number" step="0.1" /></div>
          <div class="field"><label>Tinggi kertas (mm)</label><input v-model.number="sj.h" type="number" step="0.1" /></div>
          <div class="field"><label>Geser semua ke kanan (mm)</label><input v-model.number="sj.offsetX" type="number" step="0.1" /></div>
          <div class="field"><label>Geser semua ke bawah (mm)</label><input v-model.number="sj.offsetY" type="number" step="0.1" /></div>
        </div>

        <div class="form-section-title" style="margin-top:16px">Posisi Tiap Data</div>
        <div class="calib-field-row calib-field-head">
          <div>Data</div><div>X (mm)</div><div>Y (mm)</div><div>Ukuran font (pt)</div>
        </div>
        <div class="calib-field-row" v-for="(label, key) in sjFieldLabels" :key="key">
          <div>{{ label }}</div>
          <input v-model.number="sj.fields[key].x" type="number" step="0.5" />
          <input v-model.number="sj.fields[key].y" type="number" step="0.5" />
          <input v-model.number="sj.fields[key].size" type="number" step="0.5" />
        </div>

        <div class="calib-actions">
          <button class="btn btn-ghost" @click="cetakGridSJ">Cetak Kotak Bantu (grid 5mm)</button>
          <button class="btn btn-ghost" @click="cetakBlankoSJ">Cetak Blanko Kosong</button>
          <button class="btn btn-ghost" @click="cetakContohSJ">Cetak Contoh Data</button>
          <button class="btn btn-primary" :disabled="saving" @click="save('sj')">{{ saving ? "Menyimpan..." : "Simpan Kalibrasi Surat Jalan" }}</button>
        </div>
      </div>

      <div v-else class="card calib-card">
        <div class="form-section-title">Ukuran Kertas &amp; Posisi Global</div>
        <div class="row4">
          <div class="field"><label>Lebar kertas (mm)</label><input v-model.number="inv.w" type="number" step="0.1" /></div>
          <div class="field"><label>Tinggi kertas (mm)</label><input v-model.number="inv.h" type="number" step="0.1" /></div>
          <div class="field"><label>Geser semua ke kanan (mm)</label><input v-model.number="inv.offsetX" type="number" step="0.1" /></div>
          <div class="field"><label>Geser semua ke bawah (mm)</label><input v-model.number="inv.offsetY" type="number" step="0.1" /></div>
        </div>
        <div class="field" style="max-width:260px">
          <label>Jarak dari atas ke mulai isi (kop surat) (mm)</label>
          <input v-model.number="inv.topMargin" type="number" step="0.5" />
        </div>

        <div class="calib-actions">
          <button class="btn btn-ghost" @click="cetakGridInv">Cetak Kotak Bantu (grid 5mm)</button>
          <button class="btn btn-ghost" @click="cetakContohInvoice">Cetak Contoh Invoice</button>
          <button class="btn btn-primary" :disabled="saving" @click="save('inv')">{{ saving ? "Menyimpan..." : "Simpan Kalibrasi Invoice" }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.calib-intro { margin-bottom: 18px; font-size: 12.5px; line-height: 1.6; }
.calib-intro ol { margin: 8px 0 0; padding-left: 20px; }
.calib-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.calib-card { max-width: 780px; }
.row4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 4px; }
.calib-field-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.calib-field-head { font-weight: 700; color: var(--ink-soft); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid var(--line); }
.calib-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
@media (max-width: 700px) {
  .row4 { grid-template-columns: repeat(2, 1fr); }
  .calib-field-row { grid-template-columns: 1fr; gap: 3px; }
}
</style>