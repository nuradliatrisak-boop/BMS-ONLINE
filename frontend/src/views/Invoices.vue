<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const router = useRouter();
const invoices = ref([]);
const customers = ref([]);
const loading = ref(true);
const showModal = ref(false);

const emptyForm = () => ({
  no: "",
  divisi: DIVISI[0],
  customerId: "",
  tanggal: new Date().toISOString().slice(0, 10),
  jatuhTempo: "",
  catatan: "",
  items: [{ keterangan: "", qty: 1, satuan: "", hargaSatuan: 0 }],
});
const form = ref(emptyForm());

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}
function badgeClass(status) {
  if (status === "LUNAS") return "b-lunas";
  if (status === "SEBAGIAN") return "b-sebagian";
  return "b-belum";
}

async function load() {
  loading.value = true;
  [invoices.value, customers.value] = await Promise.all([
    api.get("/invoices"),
    api.get("/customers"),
  ]);
  loading.value = false;
}

function openModal() {
  form.value = emptyForm();
  showModal.value = true;
}

function addItem() {
  form.value.items.push({ keterangan: "", qty: 1, satuan: "", hargaSatuan: 0 });
}
function removeItem(idx) {
  form.value.items.splice(idx, 1);
}

async function submit() {
  if (!form.value.no || !form.value.customerId) {
    return toast("Nomor invoice dan customer wajib diisi");
  }
  await api.post("/invoices", form.value);
  toast("Invoice dibuat");
  showModal.value = false;
  await load();
}

function goDetail(id) {
  router.push({ name: "invoice-detail", params: { id } });
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Invoice</h1>
      <div class="desc">Tagihan ke customer</div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Buat Invoice</button>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!invoices.length" class="empty">
      <div class="big">🧾</div>
      Belum ada invoice. Klik "Buat Invoice" untuk mulai.
    </div>
    <div v-else class="card">
      <table>
        <thead>
          <tr><th>No</th><th>Customer</th><th>Divisi</th><th>Tanggal</th><th class="num">Total</th><th class="num">Sisa</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="i in invoices" :key="i.id" style="cursor:pointer" @click="goDetail(i.id)">
            <td class="mono">{{ i.no }}</td>
            <td>{{ i.customer?.nama }}</td>
            <td>{{ i.divisi }}</td>
            <td>{{ new Date(i.tanggal).toLocaleDateString('id-ID') }}</td>
            <td class="num mono">{{ rupiah(i.total) }}</td>
            <td class="num mono">{{ rupiah(i.sisaTagihan) }}</td>
            <td><span class="badge" :class="badgeClass(i.status)">{{ i.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal" style="max-width:720px;">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Buat Invoice Baru</h2>
      <div class="msub">Isi data tagihan dan rincian barang/jasa</div>

      <div class="row">
        <div class="field"><label>Nomor Invoice</label><input v-model="form.no" /></div>
        <div class="field"><label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>Customer</label>
          <select v-model="form.customerId">
            <option value="" disabled>Pilih customer</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.nama }}</option>
          </select>
        </div>
        <div class="field"><label>Tanggal</label><input v-model="form.tanggal" type="date" /></div>
      </div>
      <div class="field"><label>Jatuh Tempo (opsional)</label><input v-model="form.jatuhTempo" type="date" /></div>

      <div class="section-title" style="margin-top:8px;">Rincian Item</div>
      <div v-for="(it, idx) in form.items" :key="idx" class="row" style="align-items:flex-end;">
        <div class="field" style="flex:2;"><label>Keterangan</label><input v-model="it.keterangan" /></div>
        <div class="field"><label>Qty</label><input v-model.number="it.qty" type="number" /></div>
        <div class="field"><label>Satuan</label><input v-model="it.satuan" /></div>
        <div class="field"><label>Harga Satuan</label><input v-model.number="it.hargaSatuan" type="number" /></div>
        <button class="btn btn-sm btn-danger" style="margin-bottom:13px;" @click="removeItem(idx)" :disabled="form.items.length === 1">Hapus</button>
      </div>
      <button class="btn btn-ghost btn-sm" @click="addItem">+ Tambah Item</button>

      <div class="field" style="margin-top:14px;"><label>Catatan</label><textarea v-model="form.catatan" rows="2"></textarea></div>

      <button class="btn btn-primary" @click="submit">Simpan Invoice</button>
    </div>
  </div>
</template>
