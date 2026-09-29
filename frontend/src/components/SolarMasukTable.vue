<!-- Tabel Solar Masuk (dipakai di kartu ringkas & di modal "Lainnya"). -->
<script setup>
import { ref, computed } from "vue";
import { api } from "../services/api.js";
import { fmtTgl, fmtL, tglBesok, cekBadge, cekLabel } from "../utils/solarUtil.js";

const props = defineProps({ items: { type: Array, default: () => [] } });
const emit = defineEmits(["sesuai", "beda", "batal", "edit", "hapus"]);

const cekInput = ref({});
const totalReal = computed(() => props.items.reduce((s, t) => s + t.liter, 0));
const totalCatatan = computed(() => props.items.reduce((s, t) => s + (t.literCatatan ?? 0), 0));

function simpanBeda(t) {
  emit("beda", t, cekInput.value[t.id]);
  delete cekInput.value[t.id];
}
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Tanggal</th>
          <th>Nama Sopir</th>
          <th class="num">Real Masuk (L)</th>
          <th>Catatan Buku Sopir</th>
          <th>Status / Selisih</th>
          <th>Ket.</th>
          <th>Bukti</th>
          <th>Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in items" :key="t.id" :style="t.statusCek === 'KURANG' ? 'background: var(--bms-red-soft)' : ''">
          <td style="white-space: nowrap">{{ fmtTgl(t.tanggal) }}<div class="msub mono" style="font-size: 11px">{{ t.no }}</div></td>
          <td>{{ t.nama }}</td>
          <td class="num mono"><b>{{ fmtL(t.liter) }}</b></td>
          <td>
            <div v-if="t.statusCek === 'MENUNGGU'" class="msub" style="font-size: 12px">Bisa dicek mulai {{ tglBesok(t.tanggal) }}</div>
            <div v-else-if="t.statusCek === 'BELUM_DICEK'" style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center">
              <button class="btn btn-sm btn-primary" @click="emit('sesuai', t)">✓ Sama ({{ fmtL(t.liter) }} L)</button>
              <input v-model="cekInput[t.id]" type="number" step="0.1" min="0" placeholder="Angka di buku" style="width: 110px" />
              <button class="btn btn-sm btn-ghost" @click="simpanBeda(t)">Simpan</button>
            </div>
            <div v-else class="mono">{{ fmtL(t.literCatatan) }} L</div>
          </td>
          <td>
            <span :class="cekBadge(t.statusCek)">{{ cekLabel(t.statusCek) }}</span>
            <div v-if="t.statusCek === 'KURANG'" class="msub" style="font-size: 12px; color: #b91c1c">
              Kurang {{ fmtL(Math.abs(t.selisih)) }} L dari buku. Total utang {{ t.nama }}: {{ fmtL(t.saldoSesudah) }} L
            </div>
            <div v-else-if="t.statusCek === 'LEBIH'" class="msub" style="font-size: 12px">
              Lebih {{ fmtL(t.selisih) }} L dari buku.
              <template v-if="t.menutupUtang > 0">
                Menutup utang {{ fmtL(t.menutupUtang) }} L<template v-if="t.saldoSesudah > 0">, sisa utang {{ fmtL(t.saldoSesudah) }} L</template><template v-else> (lunas)</template>.
              </template>
              <template v-if="t.lebihMurni > 0">
                <template v-if="t.menutupUtang > 0">Sisa {{ fmtL(t.lebihMurni) }} L</template>
                <template v-else>Tidak ada utang sebelumnya;</template>
                lebih setor murni.
              </template>
            </div>
          </td>
          <td>{{ t.keterangan || "-" }}</td>
          <td>
            <a v-if="t.buktiUrl" :href="api.fileUrl(t.buktiUrl)" target="_blank" rel="noopener">Lihat</a>
            <span v-else>-</span>
          </td>
          <td style="white-space: nowrap">
            <button v-if="t.literCatatan != null" class="btn btn-ghost btn-sm" @click="emit('batal', t)">Hapus Catatan</button>
            <button class="btn btn-ghost btn-sm" @click="emit('edit', t)">Edit</button>
            <button class="btn btn-ghost btn-sm" @click="emit('hapus', t)">Hapus</button>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2"><b>Total ({{ items.length }} catatan)</b></td>
          <td class="num mono"><b>{{ fmtL(totalReal) }}</b></td>
          <td class="mono" colspan="5"><b>{{ fmtL(totalCatatan) }} L</b> <span class="msub">menurut buku (yang sudah diisi)</span></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
