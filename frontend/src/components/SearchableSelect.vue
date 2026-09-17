<!--
  SearchableSelect
  Dropdown biasa tapi bisa diketik buat nyaring opsi — dipakai buat ganti
  <select> yang isinya banyak (customer, jenis barang, armada, dll) biar
  ga usah scroll manual. Untuk enum pendek (Divisi, status, dll) ga perlu
  dipakai, <select> biasa udah cukup.

  Pemakaian:
    <SearchableSelect
      v-model="form.customerId"
      :options="customers.map(c => ({ value: c.id, label: `${c.kode} — ${c.nama}` }))"
      placeholder="Pilih customer..."
    />
-->
<script setup>
import { ref, computed, watch, nextTick } from "vue";

const props = defineProps({
  modelValue: { type: [String, Number, null], default: "" },
  options: { type: Array, default: () => [] }, // [{ value, label, sub? }]
  placeholder: { type: String, default: "Pilih..." },
  searchPlaceholder: { type: String, default: "Ketik untuk cari..." },
  disabled: { type: Boolean, default: false },
  clearable: { type: Boolean, default: true },
  emptyText: { type: String, default: "Tidak ada hasil" },
});

const emit = defineEmits(["update:modelValue", "change"]);

const open = ref(false);
const query = ref("");
const highlighted = ref(-1);
const rootEl = ref(null);
const inputEl = ref(null);

const selected = computed(() =>
  props.options.find((o) => o.value === props.modelValue) || null
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) =>
    `${o.label} ${o.sub || ""}`.toLowerCase().includes(q)
  );
});

// Kalau lagi ga fokus/ketik, tampilkan label yang lagi kepilih.
watch(
  () => props.modelValue,
  () => {
    if (!open.value) query.value = selected.value?.label || "";
  },
  { immediate: true }
);

function openDropdown() {
  if (props.disabled) return;
  open.value = true;
  query.value = "";
  highlighted.value = filtered.value.findIndex((o) => o.value === props.modelValue);
  nextTick(() => inputEl.value?.select());
}

function closeDropdown() {
  open.value = false;
  query.value = selected.value?.label || "";
  highlighted.value = -1;
}

function pick(opt) {
  emit("update:modelValue", opt.value);
  emit("change", opt.value);
  closeDropdown();
}

function clearSelection(e) {
  e?.stopPropagation();
  emit("update:modelValue", "");
  emit("change", "");
  query.value = "";
  open.value = false;
}

function onBlur() {
  // delay biar klik di opsi sempat ke-handle dulu sebelum list ditutup
  setTimeout(() => {
    if (open.value) closeDropdown();
  }, 150);
}

function onKeydown(e) {
  if (!open.value) {
    if (["ArrowDown", "Enter"].includes(e.key)) {
      e.preventDefault();
      openDropdown();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlighted.value = Math.min(highlighted.value + 1, filtered.value.length - 1);
    scrollToHighlighted();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlighted.value = Math.max(highlighted.value - 1, 0);
    scrollToHighlighted();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const opt = filtered.value[highlighted.value];
    if (opt) pick(opt);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeDropdown();
    inputEl.value?.blur();
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    const list = rootEl.value?.querySelector(".ss-options");
    const item = list?.children?.[highlighted.value];
    item?.scrollIntoView({ block: "nearest" });
  });
}
</script>

<template>
  <div class="searchable-select" ref="rootEl" :class="{ disabled }">
    <div class="ss-input-wrap">
      <input
        ref="inputEl"
        type="text"
        :disabled="disabled"
        :placeholder="selected ? '' : placeholder"
        v-model="query"
        autocomplete="off"
        @focus="openDropdown"
        @click="openDropdown"
        @input="open = true"
        @blur="onBlur"
        @keydown="onKeydown"
      />
      <button
        v-if="clearable && modelValue"
        type="button"
        class="ss-clear"
        tabindex="-1"
        title="Hapus pilihan"
        @mousedown.prevent="clearSelection"
      >×</button>
      <span class="ss-caret">▾</span>
    </div>
    <div v-if="open" class="ss-options">
      <div
        v-for="(opt, idx) in filtered"
        :key="opt.value"
        class="ss-option"
        :class="{ active: idx === highlighted, selected: opt.value === modelValue }"
        @mousedown.prevent="pick(opt)"
        @mouseenter="highlighted = idx"
      >
        {{ opt.label }}
        <span v-if="opt.sub" class="ss-option-sub">{{ opt.sub }}</span>
      </div>
      <div v-if="!filtered.length" class="ss-empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<style scoped>
.searchable-select {
  position: relative;
  width: 100%;
}
.ss-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.ss-input-wrap input {
  width: 100%;
  padding: 8px 54px 8px 10px;
  border: 1px solid var(--line, #d9dee5);
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  background: #fff;
}
.searchable-select.disabled .ss-input-wrap input {
  background: #f2f3f5;
  cursor: not-allowed;
}
.ss-clear {
  position: absolute;
  right: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  color: var(--ink-soft, #8a94a3);
  padding: 2px 4px;
}
.ss-clear:hover { color: var(--ink, #1f2937); }
.ss-caret {
  position: absolute;
  right: 10px;
  pointer-events: none;
  color: var(--ink-soft, #8a94a3);
  font-size: 11px;
}
.ss-options {
  position: absolute;
  z-index: 40;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--line, #d9dee5);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(20, 25, 35, 0.12);
  padding: 4px;
}
.ss-option {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.ss-option.active { background: var(--brand-soft, #eef2ff); }
.ss-option.selected { font-weight: 600; }
.ss-option-sub { color: var(--ink-soft, #8a94a3); font-size: 12px; }
.ss-empty {
  padding: 10px;
  text-align: center;
  color: var(--ink-soft, #8a94a3);
  font-size: 13px;
}
</style>