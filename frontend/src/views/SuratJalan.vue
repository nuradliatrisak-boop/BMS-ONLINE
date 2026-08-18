<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const armadaList = ref([]);
const loading = ref(true);
const showModal = ref(false);
const emptyForm = () => ({
  no: "",
  divisi: DIVISI[0],
  armadaId: "",
  tujuan: "",
  tanggal: new Date().toISOString().slice(0, 10),
  isDraft: true,
});
const form = ref(emptyForm());

async function load() {
  loading.value = true;
  [list.value, armadaList.value] = await Promise.all([
    api.get("/surat-jalan"),
    api.get("/armada"),
  ]);
  loading.value = false;
}

function openModal() {
  form.value = emptyForm();
  showModal.value = true;
}

async function submit() {
  if (!form.value.no || !form.value.tujuan) return toast("Nomor dan tujuan wajib diisi");
  await api.post("/surat-jalan", form.value);
  toast("Surat jalan disimpan");
  showModal.value = false;
  await load();
}

async function tandaiTTD(id) {
  await api.patch(`/surat-jalan/${id}/ttd`, {});
  toast("Status TTD diperbarui");
  await load();
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Surat Jalan</h1>
      <div class="desc">Dokumen pengiriman barang</div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Buat Surat Jalan</button>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!list.length" class="empty">
      <div class="big">📄</div>
      Belum ada surat jalan.
    </div>
    <div v-else class="card">
      <table>
        <thead>
          <tr><th>No</th><th>Tujuan</th><th>Armada</th><th>Tanggal</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="sj in list" :key="sj.id">
            <td class="mono">{{ sj.no }}</td>
            <td>{{ sj.tujuan }}</td>
            <td>{{ sj.armada?.nopol || "-" }}</td>
            <td>{{ new Date(sj.tanggal).toLocaleDateString('id-ID') }}</td>
            <td>
              <span class="badge" :class="sj.isDraft ? 'b-draft' : (sj.statusTTD === 'LENGKAP' ? 'b-ttd' : 'b-belumttd')">
                {{ sj.isDraft ? "Draft" : (sj.statusTTD === "LENGKAP" ? "TTD Lengkap" : "Belum TTD") }}
              </span>
            </td>
            <td>
              <button v-if="sj.statusTTD !== 'LENGKAP'" class="btn btn-sm btn-ghost" @click="tandaiTTD(sj.id)">Tandai TTD</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Buat Surat Jalan</h2>
      <div class="row">
        <div class="field"><label>Nomor</label><input v-model="form.no" /></div>
        <div class="field"><label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Tujuan</label><input v-model="form.tujuan" /></div>
      <div class="row">
        <div class="field"><label>Armada</label>
          <select v-model="form.armadaId">
            <option value="">- Tanpa Armada -</option>
            <option v-for="a in armadaList" :key="a.id" :value="a.id">{{ a.nopol }} ({{ a.jenis }})</option>
          </select>
        </div>
        <div class="field"><label>Tanggal</label><input v-model="form.tanggal" type="date" /></div>
      </div>
      <button class="btn btn-primary" @click="submit">Simpan</button>
    </div>
  </div>
</template>
