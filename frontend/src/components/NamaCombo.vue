<!--
  NamaCombo
  Kolom nama dengan dropdown daftar nama yang sudah pernah tercatat, tapi
  tetap bisa ketik nama baru kalau belum ada di daftar. Huruf besar/kecil
  tidak dibedakan ("aceng" = "Aceng"); begitu selesai diketik, ejaannya
  otomatis diseragamkan ke nama yang sudah ada / Huruf Awal Kapital.

  Pemakaian:
    <NamaCombo v-model="form.nama" :options="daftarNama" placeholder="Pilih / ketik nama" />
-->
<script setup>
import { ref, computed } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  options: { type: Array, default: () => [] }, // ["Aceng", "Budi", ...]
  placeholder: { type: String, default: "Pilih atau ketik nama..." },
});
const emit = defineEmits(["update:modelValue"]);

const open = ref(false);
const highlighted = ref(-1);

const rapikan = (s) => String(s || "").trim().replace(/\s+/g, " ");
const key = (s) => rapikan(s).toLowerCase();
const titleCase = (s) =>
  rapikan(s)
    .toLowerCase()
    .replace(/(^|[\s.\-'])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

const filtered = computed(() => {
  const q = key(props.modelValue);
  if (!q) return props.options;
  return props.options.filter((o) => key(o).includes(q));
});
const adaPersis = computed(() => props.options.some((o) => key(o) === key(props.modelValue)));
const namaBaru = computed(() => (key(props.modelValue) && !adaPersis.value ? titleCase(props.modelValue) : ""));

function pick(nama) {
  emit("update:modelValue", nama);
  open.value = false;
  highlighted.value = -1;
}

function seragamkan() {
  const v = rapikan(props.modelValue);
  if (!v) return emit("update:modelValue", "");
  const cocok = props.options.find((o) => key(o) === key(v));
  emit("update:modelValue", cocok ?? titleCase(v));
}

function onBlur() {
  // tunda sedikit supaya klik pada opsi sempat diproses
  setTimeout(() => {
    open.value = false;
    seragamkan();
  }, 150);
}

function onKeydown(e) {
  const total = filtered.value.length + (namaBaru.value ? 1 : 0);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    open.value = true;
    highlighted.value = Math.min(highlighted.value + 1, total - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlighted.value = Math.max(highlighted.value - 1, 0);
  } else if (e.key === "Enter" && open.value && highlighted.value >= 0) {
    e.preventDefault();
    const idx = highlighted.value;
    pick(idx < filtered.value.length ? filtered.value[idx] : namaBaru.value);
  } else if (e.key === "Escape") {
    open.value = false;
  }
}
</script>

<template>
  <div class="nama-combo">
    <input
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      autocomplete="off"
      @input="emit('update:modelValue', $event.target.value); open = true; highlighted = -1"
      @focus="open = true"
      @click="open = true"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <span class="nc-caret">▾</span>
    <div v-if="open && (filtered.length || namaBaru)" class="nc-options">
      <div
        v-for="(n, idx) in filtered"
        :key="n"
        class="nc-option"
        :class="{ active: idx === highlighted }"
        @mousedown.prevent="pick(n)"
        @mouseenter="highlighted = idx"
      >{{ n }}</div>
      <div
        v-if="namaBaru"
        class="nc-option nc-new"
        :class="{ active: highlighted === filtered.length }"
        @mousedown.prevent="pick(namaBaru)"
        @mouseenter="highlighted = filtered.length"
      >+ Tambah nama baru: <b>{{ namaBaru }}</b></div>
    </div>
  </div>
</template>

<style scoped>
.nama-combo {
  position: relative;
  width: 100%;
}
.nama-combo input {
  width: 100%;
  padding: 8px 28px 8px 10px;
  border: 1px solid var(--line, #d9dee5);
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  background: #fff;
}
.nc-caret {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--ink-soft, #8a94a3);
  font-size: 11px;
}
.nc-options {
  position: absolute;
  z-index: 40;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  max-height: 220px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--line, #d9dee5);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}
.nc-option {
  padding: 8px 10px;
  font-size: 14px;
  cursor: pointer;
}
.nc-option.active {
  background: #eef3fb;
}
.nc-new {
  border-top: 1px solid var(--line, #d9dee5);
  color: var(--accent, #2563eb);
}
</style>
