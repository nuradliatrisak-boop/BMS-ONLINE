<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const loading = ref(true);
const saving = ref(false);

const form = ref({
  signerName: "",
});

async function load() {
  loading.value = true;
  try {
    const data = await api.get("/settings");
    form.value.signerName = data.signerName || "";
  } catch (e) {
    toast(e?.message || "Gagal memuat pengaturan");
  } finally {
    loading.value = false;
  }
}

async function submit() {
  saving.value = true;
  try {
    await api.put("/settings", { signerName: form.value.signerName.trim() });
    toast("Pengaturan berhasil disimpan");
  } catch (e) {
    toast(e?.message || "Gagal menyimpan pengaturan");
  } finally {
    saving.value = false;
  }
}


// --- Rate "Uang Makan" Alat Berat (unit + kategori -> nominal), dipakai
// auto-isi saat baris invoice sewa alat berat dibuat (menu Invoice) ---
const uangMakanList = ref([]);
const loadingUangMakan = ref(true);
const uangMakanForm = ref({ unitAlat: "", kategoriAlat: "", nominal: 0 });
const editingUangMakanId = ref(null);

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

async function loadUangMakan() {
  loadingUangMakan.value = true;
  try {
    uangMakanList.value = await api.get("/uang-makan-alat");
  } catch (e) {
    toast(e?.message || "Gagal memuat rate uang makan alat berat");
  } finally {
    loadingUangMakan.value = false;
  }
}

function editUangMakan(r) {
  editingUangMakanId.value = r.id;
  uangMakanForm.value = { unitAlat: r.unitAlat, kategoriAlat: r.kategoriAlat, nominal: r.nominal };
}

function batalEditUangMakan() {
  editingUangMakanId.value = null;
  uangMakanForm.value = { unitAlat: "", kategoriAlat: "", nominal: 0 };
}

async function submitUangMakan() {
  if (!uangMakanForm.value.unitAlat.trim() || !uangMakanForm.value.kategoriAlat.trim()) {
    return toast("Unit alat dan kategori wajib diisi");
  }
  try {
    if (editingUangMakanId.value) {
      await api.put(`/uang-makan-alat/${editingUangMakanId.value}`, uangMakanForm.value);
      toast("Rate berhasil diperbarui");
    } else {
      await api.post("/uang-makan-alat", uangMakanForm.value);
      toast("Rate berhasil ditambahkan");
    }
    batalEditUangMakan();
    await loadUangMakan();
  } catch (e) {
    toast(e?.message || "Gagal menyimpan rate");
  }
}

async function hapusUangMakan(r) {
  if (!confirm(`Hapus rate uang makan ${r.unitAlat} - ${r.kategoriAlat}?`)) return;
  try {
    await api.delete(`/uang-makan-alat/${r.id}`);
    toast("Rate berhasil dihapus");
    await loadUangMakan();
  } catch (e) {
    toast(e?.message || "Gagal menghapus rate");
  }
}

onMounted(() => {
  load();
  loadUangMakan();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Pengaturan</h1>
      <div class="desc">Pengaturan umum yang dipakai di semua dokumen cetak</div>
    </div>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else class="card settings-card">
      <div class="section-title">Penandatangan Dokumen</div>
      <p class="settings-desc">
        Nama yang akan dicetak di kolom <strong>"Hormat kami,"</strong> pada Surat Jalan dan
        Invoice. Berlaku untuk semua dokumen yang dicetak setelah disimpan.
      </p>

      <div class="field" style="max-width: 380px">
        <label>Nama Penandatangan</label>
        <input v-model="form.signerName" placeholder="Contoh: Syamsul" />
      </div>

      <button class="btn btn-primary" :disabled="saving" @click="submit">
        {{ saving ? "Menyimpan..." : "Simpan Pengaturan" }}
      </button>
    </div>
      <div class="card settings-card" style="margin-top:16px;">
      <div class="section-title">Rate Uang Makan Alat Berat</div>
      <p class="settings-desc">
        Nominal uang makan operator per kombinasi Unit Alat + Kategori pemakaian (Bucket/Breker/Longarm/Diatas Air).
        Dipakai auto-isi saat bikin baris invoice sewa alat berat di menu Invoice, tetap bisa ditimpa manual per baris.
      </p>

      <div v-if="loadingUangMakan" class="empty small">Memuat data…</div>

      <table v-else-if="uangMakanList.length" style="margin-bottom:14px;">
        <thead>
          <tr>
            <th>Unit Alat</th>
            <th>Kategori</th>
            <th class="num">Nominal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in uangMakanList" :key="r.id">
            <td>{{ r.unitAlat }}</td>
            <td>{{ r.kategoriAlat }}</td>
            <td class="num mono">{{ rupiah(r.nominal) }}</td>
            <td style="text-align:right; white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" style="margin-right:6px;" @click="editUangMakan(r)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="hapusUangMakan(r)">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty small" style="margin-bottom:14px;">Belum ada rate uang makan alat berat.</div>

      <div class="row row-3">
        <div class="field"><label>Unit Alat</label><input v-model="uangMakanForm.unitAlat" placeholder="Contoh: PC 75" /></div>
        <div class="field">
          <label>Kategori</label>
          <select v-model="uangMakanForm.kategoriAlat">
            <option value="" disabled>Pilih kategori</option>
            <option value="Bucket">Bucket</option>
            <option value="Breker">Breker</option>
            <option value="Longarm">Longarm</option>
            <option value="Diatas Air">Diatas Air</option>
          </select>
        </div>
        <div class="field"><label>Nominal</label><input v-model.number="uangMakanForm.nominal" type="number" min="0" /></div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary btn-sm" @click="submitUangMakan">{{ editingUangMakanId ? "Simpan Perubahan" : "+ Tambah Rate" }}</button>
        <button v-if="editingUangMakanId" class="btn btn-ghost btn-sm" @click="batalEditUangMakan">Batal</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-card { max-width: 560px; }
.settings-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.6; margin: 4px 0 18px; }
</style>
