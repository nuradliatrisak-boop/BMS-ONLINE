<!--
  DimInput
  Kolom angka ukuran (P / L / T / volume) yang SELALU menampilkan minimal 2 angka di
  belakang koma setelah selesai diketik: 3.6 -> "3.60", 1 -> "1.00".
  (<input type="number"> bawaan browser tidak bisa menampilkan nol di belakang koma.)

  Pemakaian: ganti <input type="number" v-model.number="x"> dengan
    <DimInput v-model="x" />
  Nilai yang dikirim ke v-model tetap angka (Number), atau "" kalau dikosongkan.
-->
<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  modelValue: { type: [Number, String], default: "" },
  minDec: { type: Number, default: 2 },
  maxDec: { type: Number, default: 3 },
});
const emit = defineEmits(["update:modelValue", "change"]);

function fmt(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const f = 10 ** props.maxDec;
  const dec = (String(Math.round(n * f) / f).split(".")[1] || "").length;
  return n.toFixed(Math.min(props.maxDec, Math.max(props.minDec, dec)));
}

const text = ref(fmt(props.modelValue));
const focused = ref(false);

watch(() => props.modelValue, (v) => {
  if (!focused.value) text.value = fmt(v);
});

function onInput(e) {
  let t = String(e.target.value).replace(",", ".").replace(/[^0-9.]/g, "");
  const i = t.indexOf(".");
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, "").slice(0, props.maxDec);
  text.value = t;
  e.target.value = t;
  emit("update:modelValue", t === "" || t === "." ? "" : Number(t));
}
function onFocus(e) {
  focused.value = true;
  e.target.select();
}
function onBlur() {
  focused.value = false;
  text.value = fmt(props.modelValue);
  emit("change");
}
</script>

<template>
  <input
    type="text"
    inputmode="decimal"
    autocomplete="off"
    :value="text"
    @input="onInput"
    @focus="onFocus"
    @blur="onBlur"
  />
</template>
