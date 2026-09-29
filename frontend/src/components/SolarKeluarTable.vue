<!-- Tabel Solar Keluar (dipakai di kartu ringkas & di modal "Lainnya"). -->
<script setup>
import { computed } from "vue";
import { api } from "../services/api.js";
import { fmtTgl, fmtL } from "../utils/solarUtil.js";

const props = defineProps({ items: { type: Array, default: () => [] } });
const emit = defineEmits(["edit", "hapus"]);
const total = computed(() => props.items.reduce((s, t) => s + t.liter, 0));
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Tanggal</th>
          <th>Nama Operator</th>
          <th>Wilayah Tujuan</th>
          <th class="num">Liter</th>
          <th>Ket.</th>
          <th>Bukti</th>
          <th>Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in items" :key="t.id">
          <td style="white-space: nowrap">{{ fmtTgl(t.tanggal) }}<div class="msub mono" style="font-size: 11px">{{ t.no }}</div></td>
          <td>{{ t.nama }}</td>
          <td>{{ t.lokasi || "-" }}</td>
          <td class="num mono"><b>{{ fmtL(t.liter) }}</b></td>
          <td>{{ t.keterangan || "-" }}</td>
          <td>
            <a v-if="t.buktiUrl" :href="api.fileUrl(t.buktiUrl)" target="_blank" rel="noopener">Lihat</a>
            <span v-else>-</span>
          </td>
          <td style="white-space: nowrap">
            <button class="btn btn-ghost btn-sm" @click="emit('edit', t)">Edit</button>
            <button class="btn btn-ghost btn-sm" @click="emit('hapus', t)">Hapus</button>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3"><b>Total ({{ items.length }} catatan)</b></td>
          <td class="num mono"><b>{{ fmtL(total) }}</b></td>
          <td colspan="3"></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
