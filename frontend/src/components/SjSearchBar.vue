<script setup>
// Kotak cari serbaguna di atas daftar Surat Jalan yang mau dipilih ke invoice.
// Filternya sendiri dijalankan induknya (lihat utils/sjSearch.js); komponen ini
// cuma tampilan: kotak cari, info jumlah, dan 2 tombol bantu centang.
defineProps({
  modelValue: { type: String, default: "" },
  total: { type: Number, default: 0 }, // semua SJ yang tersedia
  tampil: { type: Number, default: 0 }, // yang lolos pencarian
  tercentang: { type: Number, default: 0 }, // semua yang tercentang (termasuk yang tersembunyi)
  tersembunyi: { type: Number, default: 0 }, // tercentang tapi tidak lolos pencarian
});
defineEmits(["update:modelValue", "centang-tampil", "kosongkan"]);
</script>

<template>
  <div class="sjs">
    <div class="sjs-row">
      <div class="sjs-box">
        <span class="sjs-ico">🔍</span>
        <input
          :value="modelValue"
          type="search"
          placeholder="Cari apa saja: no SJ, tujuan, penerima, barang, no. polisi, sopir, tanggal…"
          @input="$emit('update:modelValue', $event.target.value)"
        />
        <button v-if="modelValue" type="button" class="sjs-x" title="Hapus pencarian" @click="$emit('update:modelValue', '')">✕</button>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="!tampil" @click="$emit('centang-tampil')">
        ✓ Centang yang tampil
      </button>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="!tercentang" @click="$emit('kosongkan')">
        Kosongkan centang
      </button>
    </div>
    <div class="sjs-info">
      <template v-if="modelValue">Menampilkan <b>{{ tampil }}</b> dari {{ total }} surat jalan • </template>
      <b>{{ tercentang }}</b> tercentang
      <span v-if="tersembunyi > 0" class="sjs-warn">
        ⚠ {{ tersembunyi }} tercentang tapi tersembunyi oleh pencarian (tetap ikut ditambahkan)
      </span>
    </div>
  </div>
</template>

<style scoped>
.sjs { margin: 10px 0 8px; }
.sjs-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sjs-box { position: relative; flex: 1; min-width: 240px; }
.sjs-box input {
  width: 100%;
  padding: 8px 30px 8px 32px;
  border: 1px solid var(--line, #d9dee7);
  border-radius: 8px;
  font-size: 13px;
}
.sjs-ico { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 13px; opacity: 0.7; }
.sjs-x {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  border: none; background: none; cursor: pointer; font-size: 14px; color: var(--ink-soft, #7a8499);
}
.sjs-info { font-size: 12px; color: var(--ink-soft, #7a8499); margin-top: 6px; }
.sjs-warn { color: #b45309; margin-left: 8px; }
</style>
