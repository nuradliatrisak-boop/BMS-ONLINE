<script setup>
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { printSJ } from "../services/print.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const armadaList = ref([]);
const customers = ref([]);
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);
const editingId = ref(null);

const emptyForm = () => ({
  divisi: DIVISI[0],
  customerId: "",
  armadaId: "",
  jenisBarang: "",
  noPolisi: "",
  sopir: "",
  panjang: 0,
  lebar: 0,
  tinggi: 0,
  tanggal: new Date().toISOString().slice(0, 10),
  jam: new Date().toTimeString().slice(0, 5),
  isDraft: true,
});

const form = ref(emptyForm());

const jumlahDraft = computed(() => list.value.filter((item) => item.isDraft).length);
const jumlahTTD = computed(
  () => list.value.filter((item) => item.statusTTD === "LENGKAP").length
);

// Tujuan bukan isian manual: otomatis dari alamat Customer yang sudah
// diisi lebih dulu di menu Customer, sesuai format kertas fisik.
const formCustomer = computed(() => customers.value.find((c) => c.id === form.value.customerId));
const tujuanPreview = computed(() => formCustomer.value?.alamat || "");

const m3Preview = computed(() => {
  const p = Number(form.value.panjang || 0);
  const l = Number(form.value.lebar || 0);
  const t = Number(form.value.tinggi || 0);
  return Math.round(p * l * t * 1000) / 1000;
});

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

async function load() {
  loading.value = true;
  try {
    const [suratJalanData, armadaData, customerData] = await Promise.all([
      api.get("/surat-jalan"),
      api.get("/armada"),
      api.get("/customers"),
    ]);
    list.value = suratJalanData;
    armadaList.value = armadaData;
    customers.value = customerData;
  } catch (error) {
    console.error(error);
    toast("Gagal memuat data surat jalan");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  showModal.value = true;
}

function openEdit(sj) {
  editingId.value = sj.id;
  form.value = {
    divisi: sj.divisi,
    customerId: sj.customerId || "",
    armadaId: sj.armadaId || "",
    jenisBarang: sj.jenisBarang || "",
    noPolisi: sj.noPolisi || "",
    sopir: sj.sopir || "",
    panjang: sj.panjang || 0,
    lebar: sj.lebar || 0,
    tinggi: sj.tinggi || 0,
    tanggal: sj.tanggal ? new Date(sj.tanggal).toISOString().slice(0, 10) : "",
    jam: sj.jam || "",
    isDraft: !!sj.isDraft,
  };
  showModal.value = true;
}

function closeModal() {
  if (saving.value) return;
  showModal.value = false;
}

function formatTanggal(tanggal) {
  if (!tanggal) return "-";
  return new Date(tanggal).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusText(sj) {
  if (sj.isDraft) return "Draft";
  if (sj.statusTTD === "LENGKAP") return "TTD Lengkap";
  return "Belum TTD";
}

function statusClass(sj) {
  if (sj.isDraft) return "b-draft";
  if (sj.statusTTD === "LENGKAP") return "b-ttd";
  return "b-belumttd";
}

// Kalau Armada dipilih, ambil otomatis No. Polisi & Sopir dari master
// Armada (masih boleh diubah manual kalau perlu).
function onArmadaChange() {
  const armada = armadaList.value.find((a) => a.id === form.value.armadaId);
  if (armada) {
    if (!form.value.noPolisi) form.value.noPolisi = armada.nopol;
    if (!form.value.sopir && armada.sopir) form.value.sopir = armada.sopir;
  }
}

function validateForm() {
  if (!form.value.divisi) {
    toast("Divisi wajib dipilih");
    return false;
  }
  if (!form.value.customerId) {
    toast("Customer wajib dipilih (tujuan otomatis mengikuti alamat customer)");
    return false;
  }
  if (!form.value.tanggal) {
    toast("Tanggal wajib diisi");
    return false;
  }
  return true;
}

async function submit() {
  if (!validateForm()) return;

  saving.value = true;
  try {
    const payload = {
      divisi: form.value.divisi,
      customerId: form.value.customerId,
      armadaId: form.value.armadaId || null,
      tujuan: tujuanPreview.value,
      jenisBarang: form.value.jenisBarang?.trim() || null,
      noPolisi: form.value.noPolisi?.trim() || null,
      sopir: form.value.sopir?.trim() || null,
      panjang: Number(form.value.panjang) || 0,
      lebar: Number(form.value.lebar) || 0,
      tinggi: Number(form.value.tinggi) || 0,
      tanggal: form.value.tanggal,
      jam: form.value.jam || null,
      isDraft: !!form.value.isDraft,
    };

    if (editingId.value) {
      await api.put(`/surat-jalan/${editingId.value}`, payload);
      toast("Surat jalan berhasil diperbarui");
    } else {
      const created = await api.post("/surat-jalan", payload);
      toast(`Surat jalan ${created.no} berhasil disimpan`);
    }

    showModal.value = false;
    await load();
  } catch (error) {
    console.error(error);
    toast(error?.message || "Gagal menyimpan surat jalan");
  } finally {
    saving.value = false;
  }
}

async function tandaiTTD(id) {
  try {
    await api.patch(`/surat-jalan/${id}/ttd`, {});
    toast("Status TTD diperbarui");
    await load();
  } catch (error) {
    console.error(error);
    toast("Gagal memperbarui status TTD");
  }
}

async function removeSJ(sj) {
  if (!confirm(`Hapus surat jalan ${sj.no}?`)) return;
  try {
    await api.delete(`/surat-jalan/${sj.id}`);
    toast("Surat jalan berhasil dihapus");
    await load();
  } catch (error) {
    toast(error?.message || "Gagal menghapus surat jalan");
  }
}

function cetak(sj) {
  printSJ(sj);
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
    <!-- RINGKASAN -->
    <div v-if="!loading && list.length" class="sj-summary">
      <div class="sj-summary-card">
        <div class="sj-summary-icon">📄</div>
        <div>
          <div class="sj-summary-label">TOTAL SURAT JALAN</div>
          <div class="sj-summary-value">{{ list.length }}</div>
        </div>
      </div>
      <div class="sj-summary-card">
        <div class="sj-summary-icon draft">📝</div>
        <div>
          <div class="sj-summary-label">DRAFT</div>
          <div class="sj-summary-value">{{ jumlahDraft }}</div>
        </div>
      </div>
      <div class="sj-summary-card">
        <div class="sj-summary-icon ttd">✓</div>
        <div>
          <div class="sj-summary-label">TTD LENGKAP</div>
          <div class="sj-summary-value">{{ jumlahTTD }}</div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">📄</div>
      <div>Belum ada surat jalan.</div>
      <button class="btn btn-primary" style="margin-top: 14px" @click="openModal">
        + Buat Surat Jalan Pertama
      </button>
    </div>

    <div v-else class="card sj-table-card">
      <div class="section-title">
        Daftar Surat Jalan
        <span class="tag">{{ list.length }} Dokumen</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>No Surat Jalan</th>
              <th>Customer / Tujuan</th>
              <th>Jenis Barang</th>
              <th>No. Polisi</th>
              <th class="num">M3</th>
              <th>Tanggal</th>
              <th>Status</th>
              <th class="action-col">Aksi</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="sj in list" :key="sj.id">
              <td><span class="sj-number mono">{{ sj.no }}</span></td>
              <td>
                <strong>{{ sj.customer?.nama || "-" }}</strong>
                <div class="sj-tujuan-sub">{{ sj.tujuan }}</div>
              </td>
              <td>{{ sj.jenisBarang || "-" }}</td>
              <td class="mono">{{ sj.noPolisi || "-" }}</td>
              <td class="num mono">{{ Number(sj.m3 || 0).toFixed(3) }}</td>
              <td>{{ formatTanggal(sj.tanggal) }}</td>
              <td>
                <span class="badge" :class="statusClass(sj)">{{ statusText(sj) }}</span>
              </td>
              <td>
                <div class="sj-actions">
                  <button
                    v-if="sj.statusTTD !== 'LENGKAP'"
                    class="btn btn-sm btn-ghost"
                    @click="tandaiTTD(sj.id)"
                  >
                    ✓ TTD
                  </button>
                  <button class="btn btn-sm btn-ghost" @click="cetak(sj)">🖨</button>
                  <button class="btn btn-sm btn-ghost" @click="openEdit(sj)">Edit</button>
                  <button class="btn btn-sm btn-danger" @click="removeSJ(sj)">Hapus</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="sj-hint">Nomor surat jalan dibuat otomatis oleh sistem.</div>
    </div>
  </div>

  <!-- MODAL -->
  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal">
      <button class="modal-close" @click="closeModal">×</button>

      <h2>{{ editingId ? "Edit Surat Jalan" : "Buat Surat Jalan" }}</h2>
      <div class="msub">
        Isi informasi pengiriman. Nomor surat jalan akan dibuat otomatis oleh sistem.
      </div>

      <div class="row">
        <div class="field">
          <label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>

        <div class="field">
          <label>Customer</label>
          <select v-model="form.customerId">
            <option value="" disabled>Pilih customer</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label>Tujuan <span class="optional">(otomatis dari alamat customer)</span></label>
        <input :value="tujuanPreview" disabled placeholder="Pilih customer dulu" />
      </div>

      <div class="field">
        <label>Jenis Barang</label>
        <input v-model="form.jenisBarang" placeholder="Contoh: Pasir Bangka / Batu Split" />
      </div>

      <div class="row">
        <div class="field">
          <label>Armada <span class="optional">(opsional)</span></label>
          <select v-model="form.armadaId" @change="onArmadaChange">
            <option value="">- Pilih armada, atau isi manual di bawah -</option>
            <option v-for="a in armadaList" :key="a.id" :value="a.id">{{ a.nopol }} — {{ a.jenis }}</option>
          </select>
        </div>
        <div class="field">
          <label>Tanggal</label>
          <input v-model="form.tanggal" type="date" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>No. Polisi</label>
          <input v-model="form.noPolisi" placeholder="Contoh: B 9012 XYZ" />
        </div>
        <div class="field">
          <label>Sopir</label>
          <input v-model="form.sopir" placeholder="Nama sopir" />
        </div>
      </div>

      <div class="row row-4">
        <div class="field">
          <label>Panjang (m)</label>
          <input v-model.number="form.panjang" type="number" step="0.01" min="0" />
        </div>
        <div class="field">
          <label>Lebar (m)</label>
          <input v-model.number="form.lebar" type="number" step="0.01" min="0" />
        </div>
        <div class="field">
          <label>Tinggi (m)</label>
          <input v-model.number="form.tinggi" type="number" step="0.01" min="0" />
        </div>
        <div class="field">
          <label>Jam</label>
          <input v-model="form.jam" type="time" />
        </div>
      </div>

      <div class="m3-hint">M3 = <strong>{{ m3Preview.toFixed(3) }}</strong></div>

      <label class="draft-check">
        <input v-model="form.isDraft" type="checkbox" />
        <div>
          <div>Simpan sebagai Draft</div>
          <div class="draft-check-sub">Draft dapat digunakan sebelum dokumen ditandatangani.</div>
        </div>
      </label>

      <div class="modal-actions">
        <button class="btn btn-ghost" :disabled="saving" @click="closeModal">Batal</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? "Menyimpan..." : "Simpan Surat Jalan" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sj-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
.sj-summary-card { display: flex; align-items: center; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.sj-summary-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--bms-blue-soft); font-size: 16px; }
.sj-summary-icon.draft { background: #fff2d9; }
.sj-summary-icon.ttd { background: #dcf5e4; }
.sj-summary-label { font-size: 10.5px; color: var(--ink-soft); letter-spacing: .04em; }
.sj-summary-value { font-size: 20px; font-weight: 800; }
.sj-tujuan-sub { font-size: 11px; color: var(--ink-soft); max-width: 260px; }
.sj-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.sj-hint { margin-top: 10px; font-size: 11.5px; color: var(--ink-soft); }
.row-4 { grid-template-columns: repeat(4, 1fr); }
.m3-hint { font-size: 12.5px; color: var(--ink-soft); margin: 6px 0 12px; }
.draft-check { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 14px; cursor: pointer; }
.draft-check input { margin-top: 3px; }
.draft-check-sub { font-size: 11px; color: var(--ink-soft); }
.optional { font-weight: 400; color: var(--ink-soft); font-size: 11px; }

@media (max-width: 700px) {
  .sj-summary { grid-template-columns: 1fr; }
  .row-4 { grid-template-columns: 1fr 1fr; }
}
</style>
