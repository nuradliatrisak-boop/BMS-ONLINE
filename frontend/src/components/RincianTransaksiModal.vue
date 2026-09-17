<!--
  RincianTransaksiModal
  Dipakai di halaman rekap/laporan (Laporan Divisi, Rekap Keseluruhan) --
  pas baris kategori APAPUN diklik (selain "Invoice (Sistem)", yang punya
  modal sendiri: InvoiceDrilldownModal), modal ini nampilin daftar transaksi
  manual yang dijumlah jadi angka baris itu -- lengkap tanggal & catatan --
  dan tiap barisnya bisa dicetak (nota ringkas), atau cetak semua sekaligus.

  Pemakaian:
    <RincianTransaksiModal
      v-if="showRincian"
      :divisi="divisi"
      :kelompok="k.key"
      :kelompok-label="k.label"
      :kategori="r.kategori"
      :sub-kategori="r.subKategori"
      :dari="dari"        // "YYYY-MM-DD"
      :sampai="sampai"    // "YYYY-MM-DD"
      :label="'September 2026'"
      @close="showRincian = false"
    />
-->
<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { printRincianTransaksi, printRincianTransaksiSatuan } from "../services/print.js";

const props = defineProps({
  divisi: { type: String, required: true },
  kelompok: { type: String, required: true },
  kelompokLabel: { type: String, default: "" },
  kategori: { type: String, required: true },
  subKategori: { type: String, default: "" },
  dari: { type: String, required: true },
  sampai: { type: String, required: true },
  label: { type: String, default: "" },
});
const emit = defineEmits(["close"]);

const loading = ref(true);
const items = ref([]);
const total = ref(0);

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}
function fmtTgl(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function isAutoMirror(t) {
  return !!t.sumber && t.sumber.startsWith("AUTO_MIRROR_OF:");
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    params.set("divisi", props.divisi);
    params.set("kelompok", props.kelompok);
    params.set("kategori", props.kategori);
    if (props.subKategori) params.set("subKategori", props.subKategori);
    params.set("dari", props.dari);
    params.set("sampai", props.sampai);
    const res = await api.get(`/divisi-tx/rincian?${params.toString()}`);
    items.value = res.items || [];
    total.value = res.total || 0;
  } catch (error) {
    toast(error?.message || "Gagal memuat rincian transaksi");
  } finally {
    loading.value = false;
  }
}

function cetakSatu(t) {
  printRincianTransaksiSatuan(t, {
    divisi: props.divisi,
    kelompokLabel: props.kelompokLabel,
    kategori: props.kategori,
  });
}
function cetakSemua() {
  printRincianTransaksi({
    divisi: props.divisi,
    kelompokLabel: props.kelompokLabel,
    kategori: props.kategori,
    subKategori: props.subKategori,
    label: props.label,
    items: items.value,
    total: total.value,
  });
}

onMounted(load);
</script>

<template>
  <div class="modal-bg" @click.self="emit('close')">
    <div class="modal" style="max-width: 760px">
      <button class="modal-close" @click="emit('close')">×</button>
      <h2>Rincian &mdash; {{ kategori }}<span v-if="subKategori"> ({{ subKategori }})</span></h2>
      <div class="msub">
        {{ divisi }} &mdash; {{ kelompokLabel }}<span v-if="label"> &mdash; {{ label }}</span>.
        Daftar transaksi manual yang dijumlah jadi angka baris ini.
      </div>

      <div v-if="loading" class="empty small">Memuat…</div>
      <div v-else-if="!items.length" class="empty small">Tidak ada transaksi tercatat pada periode ini.</div>
      <template v-else>
        <div class="table-wrap">
          <table class="sj-pick-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Rincian</th>
                <th style="text-align: right">Nominal</th>
                <th>Catatan</th>
                <th style="width: 90px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in items" :key="t.id">
                <td>{{ fmtTgl(t.tanggal) }}</td>
                <td>
                  <span v-if="t.subKategori">{{ t.subKategori }}</span>
                  <span v-else-if="t.qty && t.hargaSatuan">{{ t.qty }} x {{ rupiah(t.hargaSatuan) }}</span>
                  <span v-else>-</span>
                </td>
                <td class="mono" style="text-align: right">{{ rupiah(t.nominal) }}</td>
                <td>{{ t.keterangan || "-" }}</td>
                <td style="white-space: nowrap">
                  <span
                    v-if="isAutoMirror(t)"
                    class="tag"
                    title="Otomatis mengikuti input di divisi asal, tidak ada nota terpisah di sini."
                  >
                    Otomatis
                  </span>
                  <button v-else class="btn btn-ghost btn-sm" @click="cetakSatu(t)">Cetak</button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2"><b>Total</b></td>
                <td class="mono" style="text-align: right"><b>{{ rupiah(total) }}</b></td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </template>

      <div class="modal-actions">
        <button class="btn btn-ghost" @click="emit('close')">Tutup</button>
        <button v-if="items.length" class="btn btn-primary" @click="cetakSemua">🖨 Cetak Semua</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clickable-row { cursor: pointer; }
.clickable-row:hover { background: var(--brand-soft, #eef2ff); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>