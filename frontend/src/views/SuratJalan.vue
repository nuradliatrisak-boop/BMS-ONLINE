<script setup>
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = [
  "Supplier",
  "Armada",
  "Alat Berat",
  "Kontraktor",
  "Kapal",
];

const list = ref([]);
const armadaList = ref([]);
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);

const emptyForm = () => ({
  divisi: DIVISI[0],
  armadaId: "",
  tujuan: "",
  tanggal: new Date().toISOString().slice(0, 10),
  isDraft: true,
  detail: null,
});

const form = ref(emptyForm());

const jumlahDraft = computed(() =>
  list.value.filter((item) => item.isDraft).length
);

const jumlahTTD = computed(() =>
  list.value.filter(
    (item) => item.statusTTD === "LENGKAP"
  ).length
);

async function load() {
  loading.value = true;

  try {
    const [suratJalanData, armadaData] =
      await Promise.all([
        api.get("/surat-jalan"),
        api.get("/armada"),
      ]);

    list.value = suratJalanData;
    armadaList.value = armadaData;
  } catch (error) {
    console.error(error);
    toast("Gagal memuat data surat jalan");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  form.value = emptyForm();
  showModal.value = true;
}

function closeModal() {
  if (saving.value) return;

  showModal.value = false;
}

function formatTanggal(tanggal) {
  if (!tanggal) return "-";

  return new Date(tanggal).toLocaleDateString(
    "id-ID",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}

function statusText(sj) {
  if (sj.isDraft) return "Draft";

  if (sj.statusTTD === "LENGKAP") {
    return "TTD Lengkap";
  }

  return "Belum TTD";
}

function statusClass(sj) {
  if (sj.isDraft) return "b-draft";

  if (sj.statusTTD === "LENGKAP") {
    return "b-ttd";
  }

  return "b-belumttd";
}

function validateForm() {
  if (!form.value.divisi) {
    toast("Divisi wajib dipilih");
    return false;
  }

  if (!form.value.tujuan?.trim()) {
    toast("Tujuan wajib diisi");
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
    /*
     * Nomor surat jalan TIDAK dikirim dari frontend.
     * Backend akan membuat otomatis:
     *
     * BMS-SJ-YYYYMM-0001
     */

    const payload = {
      divisi: form.value.divisi,
      armadaId: form.value.armadaId || null,
      tujuan: form.value.tujuan.trim(),
      tanggal: form.value.tanggal,
      isDraft: !!form.value.isDraft,
      detail: form.value.detail || null,
    };

    const created = await api.post(
      "/surat-jalan",
      payload
    );

    toast(
      `Surat jalan ${created.no} berhasil disimpan`
    );

    showModal.value = false;

    await load();
  } catch (error) {
    console.error(error);

    toast(
      error?.message ||
        "Gagal menyimpan surat jalan"
    );
  } finally {
    saving.value = false;
  }
}

async function tandaiTTD(id) {
  try {
    await api.patch(
      `/surat-jalan/${id}/ttd`,
      {}
    );

    toast("Status TTD diperbarui");

    await load();
  } catch (error) {
    console.error(error);
    toast("Gagal memperbarui status TTD");
  }
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Surat Jalan</h1>

      <div class="desc">
        Dokumen pengiriman barang
      </div>
    </div>

    <button
      class="btn btn-primary"
      @click="openModal"
    >
      + Buat Surat Jalan
    </button>
  </div>

  <div class="content">
    <!-- RINGKASAN -->
    <div
      v-if="!loading && list.length"
      class="sj-summary"
    >
      <div class="sj-summary-card">
        <div class="sj-summary-icon">
          📄
        </div>

        <div>
          <div class="sj-summary-label">
            TOTAL SURAT JALAN
          </div>

          <div class="sj-summary-value">
            {{ list.length }}
          </div>
        </div>
      </div>

      <div class="sj-summary-card">
        <div class="sj-summary-icon draft">
          📝
        </div>

        <div>
          <div class="sj-summary-label">
            DRAFT
          </div>

          <div class="sj-summary-value">
            {{ jumlahDraft }}
          </div>
        </div>
      </div>

      <div class="sj-summary-card">
        <div class="sj-summary-icon ttd">
          ✓
        </div>

        <div>
          <div class="sj-summary-label">
            TTD LENGKAP
          </div>

          <div class="sj-summary-value">
            {{ jumlahTTD }}
          </div>
        </div>
      </div>
    </div>

    <!-- LOADING -->
    <div
      v-if="loading"
      class="empty"
    >
      Memuat data…
    </div>

    <!-- EMPTY -->
    <div
      v-else-if="!list.length"
      class="empty"
    >
      <div class="big">
        📄
      </div>

      <div>
        Belum ada surat jalan.
      </div>

      <button
        class="btn btn-primary"
        style="margin-top: 14px"
        @click="openModal"
      >
        + Buat Surat Jalan Pertama
      </button>
    </div>

    <!-- DATA -->
    <div
      v-else
      class="card sj-table-card"
    >
      <div class="section-title">
        Daftar Surat Jalan

        <span class="tag">
          {{ list.length }} Dokumen
        </span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>No Surat Jalan</th>
              <th>Tujuan</th>
              <th>Armada</th>
              <th>Tanggal</th>
              <th>Status</th>
              <th class="action-col">
                Aksi
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="sj in list"
              :key="sj.id"
            >
              <td>
                <span class="sj-number mono">
                  {{ sj.no }}
                </span>
              </td>

              <td>
                <strong>
                  {{ sj.tujuan }}
                </strong>
              </td>

              <td>
                <div
                  v-if="sj.armada"
                  class="armada-info"
                >
                  <strong>
                    {{ sj.armada.nopol }}
                  </strong>

                  <small>
                    {{ sj.armada.jenis }}
                  </small>
                </div>

                <span v-else>
                  -
                </span>
              </td>

              <td>
                {{ formatTanggal(sj.tanggal) }}
              </td>

              <td>
                <span
                  class="badge"
                  :class="statusClass(sj)"
                >
                  {{ statusText(sj) }}
                </span>
              </td>

              <td>
                <button
                  v-if="
                    sj.statusTTD !==
                    'LENGKAP'
                  "
                  class="btn btn-sm btn-ghost"
                  @click="tandaiTTD(sj.id)"
                >
                  ✓ Tandai TTD
                </button>

                <span
                  v-else
                  class="ttd-done"
                >
                  ✓ Selesai
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="sj-hint">
        Nomor surat jalan dibuat otomatis oleh
        sistem.
      </div>
    </div>
  </div>

  <!-- MODAL -->
  <div
    v-if="showModal"
    class="modal-bg"
    @click.self="closeModal"
  >
    <div
      class="modal sj-modal"
    >
      <button
        class="modal-close"
        @click="closeModal"
      >
        ×
      </button>

      <h2>
        Buat Surat Jalan
      </h2>

      <div class="msub">
        Isi informasi pengiriman. Nomor surat
        jalan akan dibuat otomatis oleh sistem.
      </div>

      <!-- NOMOR OTOMATIS -->
      <div class="auto-number-box">
        <div class="auto-number-icon">
          📄
        </div>

        <div>
          <div class="auto-number-label">
            NOMOR SURAT JALAN
          </div>

          <div
            class="auto-number-value mono"
          >
            Dibuat otomatis
          </div>

          <div class="auto-number-note">
            Format: BMS-SJ-YYYYMM-XXXX
          </div>
        </div>
      </div>

      <!-- DIVISI -->
      <div class="field">
        <label>
          Divisi
        </label>

        <select
          v-model="form.divisi"
        >
          <option
            v-for="d in DIVISI"
            :key="d"
            :value="d"
          >
            {{ d }}
          </option>
        </select>
      </div>

      <!-- TUJUAN -->
      <div class="field">
        <label>
          Tujuan
        </label>

        <input
          v-model="form.tujuan"
          placeholder="Contoh: Proyek Cikarang"
        />
      </div>

      <!-- ARMADA + TANGGAL -->
      <div class="row">
        <div class="field">
          <label>
            Armada
          </label>

          <select
            v-model="form.armadaId"
          >
            <option value="">
              - Tanpa Armada -
            </option>

            <option
              v-for="a in armadaList"
              :key="a.id"
              :value="a.id"
            >
              {{ a.nopol }}
              ({{ a.jenis }})
            </option>
          </select>
        </div>

        <div class="field">
          <label>
            Tanggal
          </label>

          <input
            v-model="form.tanggal"
            type="date"
          />
        </div>
      </div>

      <!-- DRAFT -->
      <div class="draft-option">
        <label class="draft-checkbox">
          <input
            v-model="form.isDraft"
            type="checkbox"
          />

          <span>
            Simpan sebagai Draft
          </span>
        </label>

        <small>
          Draft dapat digunakan sebelum dokumen
          ditandatangani.
        </small>
      </div>

      <!-- ACTION -->
      <div class="modal-actions">
        <button
          class="btn btn-ghost"
          :disabled="saving"
          @click="closeModal"
        >
          Batal
        </button>

        <button
          class="btn btn-primary"
          :disabled="saving"
          @click="submit"
        >
          <span v-if="saving">
            Menyimpan…
          </span>

          <span v-else>
            Simpan Surat Jalan
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-wrap {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.action-col {
  min-width: 130px;
}

.sj-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}

.sj-summary-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 15px 17px;
}

.sj-summary-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #eef3f8;
  font-size: 18px;
}

.sj-summary-icon.draft {
  background: #f4e7ce;
}

.sj-summary-icon.ttd {
  background: #e4f3ea;
}

.sj-summary-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-soft);
}

.sj-summary-value {
  margin-top: 2px;
  font-family: "JetBrains Mono", monospace;
  font-size: 20px;
  font-weight: 700;
  color: var(--navy);
}

.sj-number {
  display: inline-block;
  white-space: nowrap;
  font-weight: 700;
  color: var(--navy);
}

.armada-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.armada-info strong {
  font-size: 12px;
}

.armada-info small {
  color: var(--ink-soft);
  font-size: 10px;
}

.ttd-done {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--green);
  font-size: 11px;
  font-weight: 700;
}

.sj-hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--ink-soft);
}

.auto-number-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 15px;
  margin-bottom: 18px;
  background: linear-gradient(
    135deg,
    #f4f8ff,
    #eef4fb
  );
  border: 1px solid #d7e2ef;
  border-radius: 10px;
}

.auto-number-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: var(--navy);
  font-size: 18px;
}

.auto-number-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-soft);
}

.auto-number-value {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 700;
  color: var(--navy);
}

.auto-number-note {
  margin-top: 2px;
  font-size: 10px;
  color: var(--ink-soft);
}

.draft-option {
  padding: 12px 14px;
  margin-top: 4px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #f8fafb;
}

.draft-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  cursor: pointer;
  color: var(--ink);
  font-size: 12px;
}

.draft-checkbox input {
  width: auto;
  margin: 0;
}

.draft-option small {
  display: block;
  margin-top: 5px;
  margin-left: 22px;
  color: var(--ink-soft);
  font-size: 10px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

@media (max-width: 800px) {
  .sj-summary {
    grid-template-columns: 1fr;
  }

  .sj-modal {
    padding: 20px 16px;
  }
}

@media (max-width: 600px) {
  .sj-summary {
    gap: 10px;
  }

  .sj-summary-card {
    padding: 12px 14px;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .modal-actions .btn {
    width: 100%;
    justify-content: center;
  }

  .auto-number-box {
    padding: 11px;
  }

  .auto-number-value {
    font-size: 12px;
  }
}
</style>