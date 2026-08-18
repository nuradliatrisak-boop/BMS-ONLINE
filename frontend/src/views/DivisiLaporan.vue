<script setup>
import { ref, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const divisi = ref(DIVISI[0]);
const bulan = ref(new Date().toISOString().slice(0, 7));
const laporan = ref(null);
const txList = ref([]);
const showModal = ref(false);
const form = ref({ tipe: "penjualan", keterangan: "", nominal: 0, tanggal: new Date().toISOString().slice(0, 10) });

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

async function load() {
  laporan.value = await api.get(`/divisi-tx/laporan/${divisi.value}/${bulan.value}`);
  const all = await api.get(`/divisi-tx?bulan=${bulan.value}`);
  txList.value = all.filter((t) => t.divisi === divisi.value);
}

async function submit() {
  if (!form.value.keterangan || !form.value.nominal) return toast("Keterangan dan nominal wajib diisi");
  await api.post("/divisi-tx", { ...form.value, divisi: divisi.value });
  toast("Transaksi dicatat");
  showModal.value = false;
  form.value = { tipe: "penjualan", keterangan: "", nominal: 0, tanggal: new Date().toISOString().slice(0, 10) };
  await load();
}

watch([divisi, bulan], load);
onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Laporan Divisi</h1>
      <div class="desc">Laba rugi bulanan per divisi</div>
    </div>
    <button class="btn btn-primary" @click="showModal = true">+ Catat Transaksi</button>
  </div>
  <div class="content">
    <div class="row" style="max-width:420px; margin-bottom:20px;">
      <div class="field"><label>Divisi</label>
        <select v-model="divisi">
          <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <div class="field"><label>Bulan</label><input v-model="bulan" type="month" /></div>
    </div>

    <div v-if="laporan" class="grid g3" style="margin-bottom:20px;">
      <div class="stat"><div class="lbl">Penjualan</div><div class="val">{{ rupiah(laporan.penjualan) }}</div></div>
      <div class="stat"><div class="lbl">Pengeluaran</div><div class="val">{{ rupiah(laporan.pengeluaran) }}</div></div>
      <div class="stat"><div class="lbl">Laba / Rugi</div><div class="val">{{ rupiah(laporan.laba) }}</div></div>
    </div>

    <div class="card">
      <div class="section-title">Transaksi Manual Bulan Ini</div>
      <div v-if="!txList.length" class="empty">Belum ada transaksi manual bulan ini.</div>
      <table v-else>
        <thead><tr><th>Tanggal</th><th>Tipe</th><th>Keterangan</th><th class="num">Nominal</th></tr></thead>
        <tbody>
          <tr v-for="t in txList" :key="t.id">
            <td>{{ new Date(t.tanggal).toLocaleDateString('id-ID') }}</td>
            <td>{{ t.tipe === 'PENJUALAN' ? 'Penjualan' : 'Pengeluaran' }}</td>
            <td>{{ t.keterangan }}</td>
            <td class="num mono">{{ rupiah(t.nominal) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Catat Transaksi — {{ divisi }}</h2>
      <div class="field"><label>Tipe</label>
        <select v-model="form.tipe">
          <option value="penjualan">Penjualan</option>
          <option value="pengeluaran">Pengeluaran</option>
        </select>
      </div>
      <div class="field"><label>Keterangan</label><input v-model="form.keterangan" /></div>
      <div class="row">
        <div class="field"><label>Nominal</label><input v-model.number="form.nominal" type="number" /></div>
        <div class="field"><label>Tanggal</label><input v-model="form.tanggal" type="date" /></div>
      </div>
      <button class="btn btn-primary" @click="submit">Simpan</button>
    </div>
  </div>
</template>
