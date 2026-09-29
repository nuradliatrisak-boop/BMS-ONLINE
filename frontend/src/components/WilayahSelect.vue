<!--
  WilayahSelect -- dropdown wilayah tujuan. Pilihan diambil dari wilayah yang
  pernah dipakai; "+ Wilayah baru…" membuka kolom ketik. Nilai awal diisi
  otomatis oleh induk (kebiasaan operator), tapi selalu bisa diganti.
-->
<script setup>
import { ref, computed, watch } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  options: { type: Array, default: () => [] }, // [{ lokasi, jumlah }]
});
const emit = defineEmits(["update:modelValue"]);

const BARU = "__baru__";
const ketik = ref(false);

const daftar = computed(() => props.options.map((o) => o.lokasi));
const adaDiDaftar = computed(() => daftar.value.some((l) => l.toLowerCase() === props.modelValue.trim().toLowerCase()));

// kalau nilai dari luar (edit/otomatis) tidak ada di daftar -> tampilkan kolom ketik
watch(
  () => props.modelValue,
  (v) => {
    if (v && !adaDiDaftar.value) ketik.value = true;
  },
  { immediate: true }
);

function onPilih(e) {
  const v = e.target.value;
  if (v === BARU) {
    ketik.value = true;
    emit("update:modelValue", "");
  } else {
    ketik.value = false;
    emit("update:modelValue", v);
  }
}
</script>

<template>
  <div>
    <select :value="ketik ? BARU : modelValue" @change="onPilih">
      <option value="" disabled>Pilih wilayah tujuan…</option>
      <option v-for="o in options" :key="o.lokasi" :value="o.lokasi">{{ o.lokasi }}</option>
      <option :value="BARU">+ Wilayah baru…</option>
    </select>
    <input
      v-if="ketik"
      :value="modelValue"
      placeholder="Ketik nama wilayah / lokasi"
      style="margin-top: 6px"
      @input="emit('update:modelValue', $event.target.value)"
    />
  </div>
</template>
