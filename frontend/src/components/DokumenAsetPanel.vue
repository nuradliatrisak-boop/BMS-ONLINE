<script setup>
// Panel dokumen kelengkapan aset (Mobil/Kapal/Alat Berat) -- dipakai di
// Armada.vue, Kapal.vue, dan AlatBeratUnit.vue. Baris "wajib" (mis. STNK,
// KIR, Gross Akte, dst) sudah otomatis dibuatkan kosong oleh backend waktu
// asetnya dibuat, panel ini tinggal nampilin & mengisi/upload-nya. User
// juga bisa nambah baris dokumen custom sendiri (kolom opsional bebas),
// baik yang perlu file maupun cuma isian teks.
import { ref, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const props = defineProps({
  asetTipe: { type: String, required: true }, // "MOBIL" | "KAPAL" | "ALAT_BERAT"
  asetId: { type: String, required: true },
});

const list = ref([]);
const loading = ref(true);
const savingId = ref(null);

async function load() {
  loading.value = true;
  try {
    list.value = await api.get(`/dokumen?asetTipe=${props.asetTipe}&asetId=${props.asetId}`);
  } catch (e) {
    toast(e.message || "Gagal memuat dokumen");
  } finally {
    loading.value = false;
  }
}

watch(() => [props.asetTipe, props.asetId], load);
onMounted(load);

// --- Isi/ganti file & isian teks per baris (dipakai untuk baris wajib
// maupun custom) ---
const fileInputs = ref({}); // { [dokId]: HTMLInputElement }
function setFileInputRef(id, el) {
  if (el) fileInputs.value[id] = el;
}

async function simpanBaris(d) {
  savingId.value = d.id;
  const fd = new FormData();
  if (d.nilai !== undefined) fd.append("nilai", d.nilai || "");
  if (d.berlakuSampai !== undefined) fd.append("berlakuSampai", d.berlakuSampai || "");
  if (d.catatan !== undefined) fd.append("catatan", d.catatan || "");
  const fileEl = fileInputs.value[d.id];
  const file = fileEl?.files?.[0];
  if (file) fd.append("file", file);

  try {
    await api.upload(`/dokumen/${d.id}`, fd, "PUT");
    toast(`${d.label} berhasil disimpan`);
    if (fileEl) fileEl.value = "";
    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan dokumen");
  } finally {
    savingId.value = null;
  }
}

async function hapusFile(d) {
  if (!confirm(`Hapus file ${d.label}?`)) return;
  const fd = new FormData();
  fd.append("hapusFile", "true");
  try {
    await api.upload(`/dokumen/${d.id}`, fd, "PUT");
    toast("File dihapus");
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus file");
  }
}

async function hapusBaris(d) {
  if (!confirm(`Hapus baris dokumen "${d.label}" ini?`)) return;
  try {
    await api.delete(`/dokumen/${d.id}`);
    toast("Baris dokumen dihapus");
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus baris dokumen");
  }
}

// --- Tambah baris dokumen custom (kolom opsional bebas) ---
const showTambah = ref(false);
const tambahForm = ref({ label: "", butuhFile: true, nilai: "" });
const tambahFileInput = ref(null);

function bukaTambah() {
  tambahForm.value = { label: "", butuhFile: true, nilai: "" };
  showTambah.value = true;
}

async function simpanTambah() {
  if (!tambahForm.value.label.trim()) return toast("Nama/label dokumen wajib diisi");

  const fd = new FormData();
  fd.append("asetTipe", props.asetTipe);
  fd.append("asetId", props.asetId);
  fd.append("label", tambahForm.value.label.trim());
  if (!tambahForm.value.butuhFile) fd.append("nilai", tambahForm.value.nilai || "");
  const file = tambahFileInput.value?.files?.[0];
  if (tambahForm.value.butuhFile && file) fd.append("file", file);

  try {
    await api.upload("/dokumen", fd, "POST");
    toast("Dokumen baru ditambahkan");
    showTambah.value = false;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menambah dokumen");
  }
}
</script>

<template>
  <div class="dok-panel">
    <div v-if="loading" class="empty" style="padding: 20px 0;">Memuat dokumen…</div>

    <div v-else class="dok-list">
      <div v-for="d in list" :key="d.id" class="dok-row">
        <div class="dok-row-head">
          <div class="dok-label">
            {{ d.label }}
            <span v-if="d.wajib" class="tag" style="margin-left: 6px;">Wajib</span>
          </div>
          <button type="button" class="btn btn-sm btn-danger" @click="hapusBaris(d)">
            {{ d.wajib ? "Hapus" : "Hapus Baris" }}
          </button>
        </div>

        <div class="dok-row-body">
          <div v-if="d.fileUrl" class="dok-file-current">
            <a :href="api.fileUrl(d.fileUrl)" target="_blank" rel="noopener">📎 {{ d.fileNama || "Lihat file" }}</a>
            <button type="button" class="link-btn" @click="hapusFile(d)">Hapus file</button>
          </div>

          <div class="row">
            <div class="field">
              <label>{{ d.fileUrl ? "Ganti File" : "Upload File" }} (opsional)</label>
              <input type="file" accept="image/*,application/pdf" :ref="(el) => setFileInputRef(d.id, el)" />
            </div>
            <div class="field">
              <label>Isian Teks (mis. No. Dokumen)</label>
              <input v-model="d.nilai" placeholder="Opsional" />
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label>Berlaku Sampai (opsional)</label>
              <input v-model="d.berlakuSampai" type="date" />
            </div>
            <div class="field">
              <label>Catatan</label>
              <input v-model="d.catatan" placeholder="Opsional" />
            </div>
          </div>

          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="savingId === d.id"
            @click="simpanBaris(d)"
          >
            {{ savingId === d.id ? "Menyimpan…" : "Simpan" }}
          </button>
        </div>
      </div>

      <div v-if="!list.length" class="empty" style="padding: 16px 0;">
        Belum ada baris dokumen.
      </div>
    </div>

    <button type="button" class="btn btn-ghost btn-sm" style="margin-top: 10px;" @click="bukaTambah">
      + Tambah Dokumen / Kolom Opsional
    </button>

    <div v-if="showTambah" class="inline-add-box" style="margin-top: 10px;">
      <div class="row">
        <div class="field">
          <label>Nama/Label Dokumen</label>
          <input v-model="tambahForm.label" placeholder="Contoh: Asuransi, No. Rangka, dst" />
        </div>
        <div class="field">
          <label>Tipe Kolom</label>
          <select v-model="tambahForm.butuhFile">
            <option :value="true">Perlu upload file</option>
            <option :value="false">Cukup isian teks</option>
          </select>
        </div>
      </div>
      <div class="row" v-if="tambahForm.butuhFile">
        <div class="field">
          <label>File (opsional, bisa diisi belakangan)</label>
          <input type="file" accept="image/*,application/pdf" ref="tambahFileInput" />
        </div>
      </div>
      <div class="row" v-else>
        <div class="field">
          <label>Isian</label>
          <input v-model="tambahForm.nilai" placeholder="Opsional, bisa diisi belakangan" />
        </div>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button type="button" class="btn btn-ghost btn-sm" @click="showTambah = false">Batal</button>
        <button type="button" class="btn btn-primary btn-sm" @click="simpanTambah">Simpan</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dok-row {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fbfcfe;
}
.dok-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.dok-label {
  font-weight: 700;
}
.dok-file-current {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
}
.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--bms-blue-dark, #1d4ed8);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}
.inline-add-box {
  background: #f7f9fc;
  border: 1px dashed var(--line);
  border-radius: 9px;
  padding: 12px;
}
</style>
