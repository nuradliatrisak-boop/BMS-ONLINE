<script setup>
// Input nominal uang yang titik ribuannya langsung tampil SAMBIL DIKETIK
// (1000000 -> 1.000.000). Dipakai pengganti <input type="number"> untuk semua
// kolom Rp. Nilai yang dikirim ke v-model tetap ANGKA biasa (bukan teks
// bertitik), atau "" kalau kolomnya dikosongkan -- sama seperti
// v-model.number di input type=number sebelumnya, jadi kode simpan/kirim
// ke server tidak perlu diubah.
//
// Pemakaian:  <MoneyInput v-model="form.nominal" placeholder="0" />
import { ref, watch } from "vue";

const props = defineProps({
  modelValue: { type: [Number, String], default: "" },
});
const emit = defineEmits(["update:modelValue"]);

function formatTampil(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("id-ID");
}

function parseDigits(str) {
  const d = String(str || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 15);
  return d;
}

function beriTitik(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const tampil = ref(formatTampil(props.modelValue));

// Sinkron kalau nilainya diubah dari luar (mis. form di-reset / diisi auto).
watch(
  () => props.modelValue,
  (v) => {
    const sekarang = parseDigits(tampil.value);
    const baru = v === "" || v === null || v === undefined ? "" : String(Math.round(Number(v) || 0));
    if (sekarang !== baru && !(baru === "0" && sekarang === "")) {
      tampil.value = formatTampil(v);
    }
  }
);

function onInput(e) {
  const input = e.target;
  const raw = input.value;
  const pos = input.selectionStart ?? raw.length;
  const digitSebelumKursor = raw.slice(0, pos).replace(/\D/g, "").length;

  const digits = parseDigits(raw);
  const formatted = beriTitik(digits);

  tampil.value = formatted;
  input.value = formatted;

  // Kursor tetap di posisi angka yang sama walau titik bertambah/berkurang.
  let hitung = 0;
  let idx = formatted.length;
  if (digitSebelumKursor === 0) idx = 0;
  else {
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) hitung++;
      if (hitung === digitSebelumKursor) { idx = i + 1; break; }
    }
  }
  input.setSelectionRange(idx, idx);

  emit("update:modelValue", digits === "" ? "" : Number(digits));
}

// Kolom bernilai 0 dikosongkan saat difokus supaya langsung bisa diketik
// tanpa harus hapus "0" dulu; kalau dibiarkan kosong, balik jadi "0".
function onFocus() {
  if (tampil.value === "0") tampil.value = "";
}
function onBlur() {
  tampil.value = formatTampil(props.modelValue);
}
</script>

<template>
  <input
    type="text"
    inputmode="numeric"
    autocomplete="off"
    :value="tampil"
    @input="onInput"
    @focus="onFocus"
    @blur="onBlur"
  />
</template>
