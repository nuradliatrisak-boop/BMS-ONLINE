<script setup>
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { printSJ } from "../services/print.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const armadaList = ref([]);
const customers = ref([]);
const stockMasterList = ref([]);
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);
const selectedIds = ref([]); // buat pilih beberapa SJ sekaligus (cetak/export gabungan)
const editingId = ref(null);

const emptyForm = () => ({
  divisi: DIVISI[0],
  customerId: "",
  recipientId: "",
  penerima: "",
  tujuan: "",
  armadaId: "",
  jenisBarang: "",
  noPolisi: "",
  sopir: "",
  panjang: 0,
  lebar: 0,
  tinggi: 0,
  tanggal: new Date().toISOString().slice(0, 10),
  jam: new Date().toTimeString().slice(0, 5),
  jumlahSuratJalan: 1,
  isDraft: true,
});

const form = ref(emptyForm());

const jumlahDraft = computed(() => list.value.filter((item) => item.isDraft).length);
const jumlahTTD = computed(
  () => list.value.filter((item) => item.statusTTD === "LENGKAP").length
);

// "Penerima" & "Tujuan" mengikuti daftar Penerima milik Customer (menu
// Customer > Penerima), sesuai format kertas fisik. Kalau customer belum
// punya daftar Penerima, dianggap penerima tunggal = nama & alamat
// customer itu sendiri. Setelah dipilih dari dropdown, kedua kolom ini
// tetap bisa diketik ulang / diedit manual kalau ada perbedaan di lapangan.
const formCustomer = computed(() => customers.value.find((c) => c.id === form.value.customerId));
const recipientOptions = computed(() => formCustomer.value?.recipients || []);

function onCustomerChange() {
  form.value.recipientId = "";
  if (recipientOptions.value.length) {
    // Customer distributor dengan banyak penerima - biarkan dipilih dulu.
    form.value.penerima = "";
    form.value.tujuan = "";
  } else {
    // Customer biasa - penerima = customer itu sendiri.
    form.value.penerima = formCustomer.value?.nama || "";
    form.value.tujuan = formCustomer.value?.alamat || "";
  }
}

function onRecipientChange() {
  const r = recipientOptions.value.find((x) => x.id === form.value.recipientId);
  if (r) { form.value.penerima = r.nama; form.value.tujuan = r.alamat; }
}
function onTujuanChange() {
  const r = recipientOptions.value.find((x) => x.alamat === form.value.tujuan && x.nama === form.value.penerima) || recipientOptions.value.find((x) => x.alamat === form.value.tujuan);
  if (r) { form.value.recipientId = r.id; form.value.penerima = r.nama; }
}

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
    const [suratJalanData, armadaData, customerData, stockData] = await Promise.all([
      api.get("/surat-jalan"),
      api.get("/armada"),
      api.get("/customers"),
      api.get("/stock-master"),
    ]);
    list.value = suratJalanData;
    armadaList.value = armadaData;
    customers.value = customerData;
    stockMasterList.value = stockData;
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
    recipientId: "",
    penerima: sj.penerima || "",
    tujuan: sj.tujuan || "",
    armadaId: sj.armadaId || "",
    jenisBarang: sj.jenisBarang || "",
    noPolisi: sj.noPolisi || "",
    sopir: sj.sopir || "",
    panjang: sj.panjang || 0,
    lebar: sj.lebar || 0,
    tinggi: sj.tinggi || 0,
    tanggal: sj.tanggal ? new Date(sj.tanggal).toISOString().slice(0, 10) : "",
    jam: sj.jam || "",
    jumlahSuratJalan: 1,
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
    toast("Customer wajib dipilih");
    return false;
  }
  if (!form.value.penerima?.trim()) {
    toast("Penerima wajib diisi");
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
  if (!editingId.value && (!Number.isInteger(Number(form.value.jumlahSuratJalan)) || Number(form.value.jumlahSuratJalan) < 1 || Number(form.value.jumlahSuratJalan) > 100)) {
    toast("Jumlah surat jalan harus antara 1 sampai 100");
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
      penerima: form.value.penerima?.trim() || null,
      tujuan: form.value.tujuan?.trim() || "",
      jenisBarang: form.value.jenisBarang?.trim() || null,
      noPolisi: form.value.noPolisi?.trim() || null,
      sopir: form.value.sopir?.trim() || null,
      panjang: Number(form.value.panjang) || 0,
      lebar: Number(form.value.lebar) || 0,
      tinggi: Number(form.value.tinggi) || 0,
      tanggal: form.value.tanggal,
      jam: form.value.jam || null,
      isDraft: !!form.value.isDraft,
      ...(!editingId.value ? { jumlahSuratJalan: Number(form.value.jumlahSuratJalan) || 1 } : {}),
    };

    if (editingId.value) {
      await api.put(`/surat-jalan/${editingId.value}`, payload);
      toast("Surat jalan berhasil diperbarui");
    } else {
      const created = await api.post("/surat-jalan", payload);
      if (Array.isArray(created)) {
        toast(`${created.length} surat jalan berhasil disimpan (${created[0]?.no} s/d ${created[created.length - 1]?.no})`);
      } else {
        toast(`Surat jalan ${created.no} berhasil disimpan`);
      }
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

// ---- pilih banyak SJ sekaligus ----
const allSelected = computed(
  () => list.value.length > 0 && selectedIds.value.length === list.value.length
);

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : list.value.map((sj) => sj.id);
}

function toggleSelectOne(id) {
  const i = selectedIds.value.indexOf(id);
  if (i === -1) selectedIds.value.push(id);
  else selectedIds.value.splice(i, 1);
}

function selectedSJList() {
  // urutan sesuai tampilan tabel (bukan urutan klik), biar hasil cetak
  // urut sama seperti yang terlihat di layar
  const idSet = new Set(selectedIds.value);
  return list.value.filter((sj) => idSet.has(sj.id));
}

function cetakTerpilih() {
  const items = selectedSJList();
  if (!items.length) return toast("Pilih dulu Surat Jalan yang mau dicetak");
  printSJ(items); // print.js sudah mendukung array - satu print job berurutan tanpa jeda
}

// Export beberapa SJ sekaligus jadi SATU file .xlsx (satu sheet per SJ).
// Nanti waktu diprint di PC print, harus diprint sebagai satu
// file/workbook (bukan sheet satu-satu) supaya kertas terus nyambung -
// PrintSJExcel.vbs sudah otomatis melakukan ini.
async function exportSJXlsxTerpilih() {
  const ids = selectedIds.value;
  if (!ids.length) return toast("Pilih dulu Surat Jalan yang mau di-export");
  try {
    await api.download("/surat-jalan/export-xlsx-batch", `SJ-Batch-${ids.length}dok.xlsx`, {
      method: "POST",
      body: { ids },
    });
  } catch (error) {
    toast(error?.message || "Gagal export ke Excel");
  }
}

// Export ke .xlsx (Page Setup terkunci di file, dicetak lewat Excel -
// lebih stabil di kertas continuous form / dot matrix daripada lewat
// dialog print browser, karena settingnya tidak balik ke default tiap
// print). Pakai posisi kalibrasi yang sama dengan "Cetak" biasa.
async function exportSJXlsx(sj) {
  try {
    await api.download(`/surat-jalan/${sj.id}/export-xlsx`, `SJ-${sj.no}.xlsx`);
  } catch (error) {
    toast(error?.message || "Gagal export ke Excel");
  }
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
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>Daftar Surat Jalan</span>
          <span class="tag">{{ list.length }} Dokumen</span>
        </div>
      </div>

      <div class="sj-searchbar">
        <input
          v-model="search"
          type="search"
          placeholder="🔎 Cari No SJ, penerima, customer, tujuan, barang, sopir, atau nopol..."
          @keyup.enter="load"
        />
        <button class="btn btn-sm" @click="load">Cari</button>
        <button v-if="search" class="btn btn-sm btn-ghost" @click="search = ''; load()">Reset</button>
      </div>

      <div v-if="selectedIds.length" class="sj-batch-bar">
        <span>{{ selectedIds.length }} dipilih</span>
        <button class="btn btn-sm" @click="cetakTerpilih" title="Cetak semua yang dipilih berurutan tanpa jeda">
          🖨 Cetak Terpilih
        </button>
        <button class="btn btn-sm" @click="exportSJXlsxTerpilih" title="Export semua yang dipilih jadi satu file Excel">
          📊 Export Excel Terpilih
        </button>
        <button class="btn btn-sm btn-ghost" @click="selectedIds = []">Batal pilih</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="checkbox-col">
                <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
              </th>
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
              <td class="checkbox-col">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(sj.id)"
                  @change="toggleSelectOne(sj.id)"
                />
              </td>
              <td><span class="sj-number mono">{{ sj.no }}</span></td>
              <td>
                <strong>{{ sj.customer?.nama || "-" }}</strong>
                <div v-if="sj.penerima && sj.penerima !== sj.customer?.nama" class="sj-penerima-sub">→ {{ sj.penerima }}</div>
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
                  <button class="btn btn-sm btn-ghost" @click="cetak(sj)" title="Cetak lewat browser">🖨</button>
                  <button class="btn btn-sm btn-ghost" @click="exportSJXlsx(sj)" title="Export ke Excel (buat cetak lewat Excel)">📊</button>
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
          <label>Customer <span class="optional">(A/P Dari)</span></label>
          <select v-model="form.customerId" @change="onCustomerChange">
            <option value="" disabled>Pilih customer</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option>
          </select>
        </div>
      </div>

      <div class="row" v-if="recipientOptions.length">
        <div class="field">
          <label>Penerima</label>
          <select v-model="form.recipientId" @change="onRecipientChange">
            <option value="" disabled>Pilih PT / penerima...</option>
            <option v-for="r in recipientOptions" :key="r.id" :value="r.id">{{ r.nama }} — {{ r.alamat }}</option>
          </select>
        </div>
        <div class="field">
          <label>Tujuan</label>
          <select v-model="form.tujuan" @change="onTujuanChange">
            <option value="" disabled>Pilih alamat tujuan...</option>
            <option v-for="r in recipientOptions" :key="r.id" :value="r.alamat">{{ r.alamat }}</option>
          </select>
        </div>
      </div>
      <div class="row" v-else>
        <div class="field"><label>Penerima</label><input v-model="form.penerima" placeholder="Nama penerima" /></div>
        <div class="field"><label>Tujuan</label><input v-model="form.tujuan" placeholder="Alamat tujuan pengiriman" /></div>
      </div>

      <div class="field">
        <label>Jenis Barang / Stock</label>
        <select v-model="form.jenisBarang">
          <option value="">Pilih jenis barang...</option>
          <option v-for="s in stockMasterList" :key="s.id" :value="s.nama">{{ s.kode }} — {{ s.nama }}</option>
        </select>
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

      <div v-if="!editingId" class="field">
        <label>Jumlah Surat Jalan</label>
        <input v-model.number="form.jumlahSuratJalan" type="number" min="1" max="100" step="1" />
        <div class="field-hint">Untuk customer dan tujuan yang sama. Setiap surat jalan akan dibuat dengan nomor yang berbeda otomatis.</div>
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
.sj-penerima-sub { font-size: 11px; color: var(--bms-blue-dark); font-weight: 600; max-width: 260px; }
.sj-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.checkbox-col { width: 32px; text-align: center; }
.sj-batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: #eef4ff;
  border: 1px solid #cfe0fb;
  border-radius: 8px;
  font-size: 13px;
}
.sj-hint { margin-top: 10px; font-size: 11.5px; color: var(--ink-soft); }
.row-4 { grid-template-columns: repeat(4, 1fr); }
.m3-hint { font-size: 12.5px; color: var(--ink-soft); margin: 6px 0 12px; }
.sj-searchbar { display:flex; gap:8px; align-items:center; margin: 10px 0 14px; }
.sj-searchbar input { flex:1; min-width:220px; padding:10px 12px; border:1px solid var(--border, #ddd); border-radius:8px; font-size:13px; }
.draft-check { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 14px; cursor: pointer; }
.draft-check input { margin-top: 3px; }
.draft-check-sub { font-size: 11px; color: var(--ink-soft); }
.optional { font-weight: 400; color: var(--ink-soft); font-size: 11px; }
.field-hint { margin-top: 5px; font-size: 11px; color: var(--ink-soft); line-height: 1.4; }

@media (max-width: 700px) {
  .sj-summary { grid-template-columns: 1fr; }
  .row-4 { grid-template-columns: 1fr 1fr; }
}
</style>
