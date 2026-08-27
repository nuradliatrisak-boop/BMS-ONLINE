<script setup>
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

// Pilihan "Jenis Armada" dibakukan (dropdown) supaya penamaan konsisten
// di seluruh sistem -- terutama Tronton & Cold Diesel, karena nama ini
// dipakai untuk mengelompokkan kendaraan di halaman Laporan Divisi &
// Rekap Armada (kalau ditulis beda-beda, mis. "cold diesel" vs "Colt
// Diesel", kendaraannya tidak akan ketemu di rekap). Tetap bisa ketik
// manual lewat opsi "Lainnya" untuk jenis alat/kendaraan di luar daftar.
const JENIS_ARMADA_OPTIONS = ["Tronton", "Cold Diesel", "Excavator", "Lainnya (ketik manual)"];

const list = ref([]);
const showModal = ref(false);
const loading = ref(true);
const editingId = ref(null);
const jenisCustom = ref(false);

const emptyForm = () => ({
  nopol: "",
  jenis: "",
  sopir: "",
  divisi: DIVISI[0],
  panjang: "",
  lebar: "",
  tinggi: "",
  volume: "",
});

const form = ref(emptyForm());

// Volume otomatis dihitung dari Index P-L-T (mengikuti sheet "INDEK MOBIL"),
// tapi tetap bisa ditimpa manual kalau angkanya beda di lapangan.
const volumeOtomatis = computed(() => {
  const p = Number(form.value.panjang);
  const l = Number(form.value.lebar);
  const t = Number(form.value.tinggi);
  if (!p || !l || !t) return null;
  return Math.round(p * l * t * 100) / 100;
});

function pakaiVolumeOtomatis() {
  if (volumeOtomatis.value !== null) {
    form.value.volume = String(volumeOtomatis.value);
  }
}

async function load() {
  loading.value = true;

  try {
    list.value = await api.get("/armada");
  } catch (e) {
    toast(e.message || "Gagal memuat data armada");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  jenisCustom.value = false;
  showModal.value = true;
}

function openEdit(a) {
  editingId.value = a.id;
  jenisCustom.value = !!a.jenis && !JENIS_ARMADA_OPTIONS.slice(0, -1).includes(a.jenis);
  form.value = {
    nopol: a.nopol,
    jenis: a.jenis,
    sopir: a.sopir || "",
    divisi: a.divisi,
    panjang: a.panjang ?? "",
    lebar: a.lebar ?? "",
    tinggi: a.tinggi ?? "",
    volume: a.volume ?? "",
  };
  showModal.value = true;
}

function onJenisSelect(val) {
  if (val === "Lainnya (ketik manual)") {
    jenisCustom.value = true;
    form.value.jenis = "";
  } else {
    jenisCustom.value = false;
    form.value.jenis = val;
  }
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.nopol || !form.value.jenis) {
    return toast("Nomor polisi dan jenis armada wajib diisi");
  }

  try {
    if (editingId.value) {
      await api.put(`/armada/${editingId.value}`, form.value);
      toast("Armada berhasil diperbarui");
    } else {
      await api.post("/armada", form.value);
      toast("Armada berhasil ditambahkan");
    }

    showModal.value = false;

    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan armada");
  }
}

async function remove(id) {
  if (!confirm("Hapus armada ini?")) return;

  try {
    await api.delete(`/armada/${id}`);
    toast("Armada berhasil dihapus");

    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus armada");
  }
}

function fmtUkuran(a) {
  if (!a.panjang && !a.lebar && !a.tinggi) return "-";
  return `${a.panjang ?? "-"} x ${a.lebar ?? "-"} x ${a.tinggi ?? "-"} m`;
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Armada</h1>
      <div class="desc">
        Kendaraan dan alat operasional perusahaan
      </div>
    </div>

    <button class="btn btn-primary" @click="openModal">
      + Tambah Armada
    </button>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">
      Memuat data…
    </div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">🚚</div>
      <div>Belum ada armada terdaftar.</div>

      <button
        class="btn btn-primary"
        style="margin-top:14px;"
        @click="openModal"
      >
        + Tambah Armada
      </button>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Daftar Armada
        <span class="tag">{{ list.length }} Armada</span>
      </div>

      <div class="msub" style="margin-bottom:10px;">
        Index P-L-T &amp; Volume dipakai sebagai acuan kapasitas muatan (m³) per kendaraan,
        sesuai master data "Indek Mobil".
      </div>

      <table>
        <thead>
          <tr>
            <th>No. Polisi</th>
            <th>Jenis Armada</th>
            <th>Sopir</th>
            <th>Divisi</th>
            <th>Index P-L-T</th>
            <th>Volume (m³)</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="a in list" :key="a.id">
            <td class="mono">
              {{ a.nopol }}
            </td>

            <td>
              {{ a.jenis }}
            </td>

            <td>
              {{ a.sopir || "-" }}
            </td>

            <td>
              {{ a.divisi }}
            </td>

            <td class="mono">
              {{ fmtUkuran(a) }}
            </td>

            <td class="mono">
              {{ a.volume ?? "-" }}
            </td>

            <td style="text-align:right; white-space:nowrap;">
              <button
                class="btn btn-sm btn-ghost"
                @click="openEdit(a)"
              >
                Edit
              </button>

              <button
                class="btn btn-sm btn-danger"
                @click="remove(a.id)"
              >
                Hapus
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div
    v-if="showModal"
    class="modal-bg"
    @click.self="closeModal"
  >
    <div class="modal">
      <button
        class="modal-close"
        @click="closeModal"
      >
        ×
      </button>

      <h2>{{ editingId ? "Edit Armada" : "Tambah Armada" }}</h2>

      <div class="msub">
        Isi data kendaraan atau alat operasional
      </div>

      <div class="row">
        <div class="field">
          <label>Nomor Polisi</label>
          <input
            v-model="form.nopol"
            placeholder="Contoh: B 1234 XYZ"
          />
        </div>

        <div class="field">
          <label>Jenis Armada</label>
          <select
            :value="jenisCustom ? 'Lainnya (ketik manual)' : form.jenis"
            @change="onJenisSelect($event.target.value)"
          >
            <option value="" disabled>Pilih jenis</option>
            <option v-for="j in JENIS_ARMADA_OPTIONS" :key="j" :value="j">{{ j }}</option>
          </select>
          <input
            v-if="jenisCustom"
            v-model="form.jenis"
            placeholder="Ketik jenis armada/alat, mis. Dump Truck"
            style="margin-top: 6px"
          />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Sopir / Operator</label>
          <input
            v-model="form.sopir"
            placeholder="Nama sopir / operator"
          />
        </div>

        <div class="field">
          <label>Divisi</label>

          <select v-model="form.divisi">
            <option
              v-for="d in DIVISI"
              :key="d"
              :value="d"
            >
              {{ d }}
            </option>
          </select>
        </div>
      </div>

      <div class="msub" style="margin-top:10px;">
        Index P-L-T (ukuran bak, meter) &amp; Volume — opsional
      </div>

      <div class="row">
        <div class="field">
          <label>Panjang (m)</label>
          <input
            v-model="form.panjang"
            type="number"
            step="0.01"
            placeholder="Panjang"
          />
        </div>

        <div class="field">
          <label>Lebar (m)</label>
          <input
            v-model="form.lebar"
            type="number"
            step="0.01"
            placeholder="Lebar"
          />
        </div>

        <div class="field">
          <label>Tinggi (m)</label>
          <input
            v-model="form.tinggi"
            type="number"
            step="0.01"
            placeholder="Tinggi"
          />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Volume (m³)</label>
          <input
            v-model="form.volume"
            type="number"
            step="0.01"
            placeholder="Volume kapasitas"
          />
        </div>

        <div
          class="field"
          style="justify-content:flex-end; display:flex; flex-direction:column;"
        >
          <button
            v-if="volumeOtomatis !== null"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="pakaiVolumeOtomatis"
          >
            Pakai hasil P×L×T ({{ volumeOtomatis }} m³)
          </button>
        </div>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
        <button
          class="btn btn-ghost"
          @click="closeModal"
        >
          Batal
        </button>

        <button
          class="btn btn-primary"
          @click="submit"
        >
          Simpan Armada
        </button>
      </div>
    </div>
  </div>
</template>
