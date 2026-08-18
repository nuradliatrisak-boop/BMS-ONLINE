<script setup>
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const route = useRoute();
const router = useRouter();
const invoice = ref(null);
const loading = ref(true);
const showModal = ref(false);
const form = ref({ tanggal: new Date().toISOString().slice(0, 10), nominal: 0, metode: "", catatan: "" });

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
  invoice.value = await api.get(`/invoices/${route.params.id}`);
  loading.value = false;
}

async function submitPembayaran() {
  if (!form.value.nominal) return toast("Nominal wajib diisi");
  await api.post(`/invoices/${route.params.id}/pembayaran`, form.value);
  toast("Pembayaran dicatat");
  showModal.value = false;
  form.value = { tanggal: new Date().toISOString().slice(0, 10), nominal: 0, metode: "", catatan: "" };
  await load();
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1 v-if="invoice">Invoice {{ invoice.no }}</h1>
      <div class="desc">Detail tagihan &amp; riwayat pembayaran</div>
    </div>
    <button class="btn btn-ghost" @click="router.push({ name: 'invoices' })">← Kembali</button>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else class="grid g2">
      <div class="card">
        <div class="section-title">Rincian Item <span class="badge" :class="badgeClass(invoice.status)">{{ invoice.status }}</span></div>
        <table>
          <thead><tr><th>Keterangan</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Subtotal</th></tr></thead>
          <tbody>
            <tr v-for="it in invoice.items" :key="it.id">
              <td>{{ it.keterangan }}</td>
              <td class="num mono">{{ it.qty }} {{ it.satuan }}</td>
              <td class="num mono">{{ rupiah(it.hargaSatuan) }}</td>
              <td class="num mono">{{ rupiah(it.qty * it.hargaSatuan) }}</td>
            </tr>
          </tbody>
        </table>
        <div style="display:flex; justify-content:space-between; margin-top:14px; font-weight:700;">
          <span>Total</span><span class="mono">{{ rupiah(invoice.total) }}</span>
        </div>
        <div style="display:flex; justify-content:space-between; color:var(--ink-soft); font-size:13px;">
          <span>Sudah Dibayar</span><span class="mono">{{ rupiah(invoice.dibayar) }}</span>
        </div>
        <div style="display:flex; justify-content:space-between; color:var(--stamp); font-weight:600;">
          <span>Sisa Tagihan</span><span class="mono">{{ rupiah(invoice.sisaTagihan) }}</span>
        </div>
      </div>

      <div class="card">
        <div class="section-title">Riwayat Pembayaran</div>
        <div v-if="!invoice.pembayaran.length" class="empty">Belum ada pembayaran.</div>
        <table v-else>
          <thead><tr><th>Tanggal</th><th class="num">Nominal</th><th>Metode</th></tr></thead>
          <tbody>
            <tr v-for="p in invoice.pembayaran" :key="p.id">
              <td>{{ new Date(p.tanggal).toLocaleDateString('id-ID') }}</td>
              <td class="num mono">{{ rupiah(p.nominal) }}</td>
              <td>{{ p.metode || "-" }}</td>
            </tr>
          </tbody>
        </table>
        <button class="btn btn-gold" style="margin-top:14px;" @click="showModal = true" :disabled="invoice.status === 'LUNAS'">+ Catat Pembayaran</button>
      </div>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Catat Pembayaran</h2>
      <div class="row">
        <div class="field"><label>Tanggal</label><input v-model="form.tanggal" type="date" /></div>
        <div class="field"><label>Nominal</label><input v-model.number="form.nominal" type="number" /></div>
      </div>
      <div class="field"><label>Metode</label><input v-model="form.metode" placeholder="Transfer, Tunai, dll" /></div>
      <div class="field"><label>Catatan</label><textarea v-model="form.catatan" rows="2"></textarea></div>
      <button class="btn btn-primary" @click="submitPembayaran">Simpan</button>
    </div>
  </div>
</template>
