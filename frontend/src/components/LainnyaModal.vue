<!-- Modal pembungkus untuk "Lainnya": menampilkan daftar lengkap saat diklik. -->
<script setup>
defineProps({ title: { type: String, default: "" }, lebar: { type: String, default: "1100px" } });
defineEmits(["close"]);
</script>

<template>
  <div class="modal-bg" @click.self="$emit('close')">
    <div class="modal" :style="{ maxWidth: lebar }">
      <button class="modal-close" @click="$emit('close')">×</button>
      <h2>{{ title }}</h2>
      <slot />
    </div>
  </div>
</template>
