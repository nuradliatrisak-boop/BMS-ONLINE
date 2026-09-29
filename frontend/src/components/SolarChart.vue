<!--
  SolarChart -- grafik batang Solar Masuk vs Keluar per hari/minggu/bulan.
  bars: [{ label, tip, masuk, keluar }]. Geser ke samping kalau batangnya banyak.
-->
<script setup>
import { computed, ref } from "vue";
import { fmtL } from "../utils/solarUtil.js";

const props = defineProps({ bars: { type: Array, default: () => [] } });

const H = 220;
const PAD = { l: 44, r: 8, t: 12, b: 34 };
const colW = computed(() => (props.bars.length > 40 ? 26 : props.bars.length > 20 ? 34 : 46));
const W = computed(() => Math.max(560, PAD.l + PAD.r + props.bars.length * colW.value));

const maks = computed(() => {
  const m = Math.max(1, ...props.bars.flatMap((b) => [b.masuk, b.keluar]));
  const step = Math.pow(10, Math.floor(Math.log10(m)));
  return Math.ceil(m / step) * step;
});
const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / maks.value);
const ticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((f) => f * maks.value));
const skipLabel = computed(() => (props.bars.length > 40 ? 3 : props.bars.length > 20 ? 2 : 1));

const hover = ref(null);
</script>

<template>
  <div class="sc-wrap">
    <div class="sc-legend">
      <span><i style="background: #159447"></i>Solar Masuk</span>
      <span><i style="background: #e08a12"></i>Solar Keluar</span>
    </div>
    <div v-if="!bars.length" class="empty" style="padding: 24px 0">Belum ada data untuk digrafikkan.</div>
    <div v-else class="sc-scroll">
      <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" role="img" aria-label="Grafik solar masuk dan keluar">
        <g v-for="t in ticks" :key="t">
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="#e2e8f0" stroke-width="1" />
          <text :x="PAD.l - 6" :y="y(t) + 4" text-anchor="end" font-size="10" fill="#64748b">{{ fmtL(t) }}</text>
        </g>
        <g v-for="(b, i) in bars" :key="i" @mouseenter="hover = i" @mouseleave="hover = null">
          <rect
            :x="PAD.l + i * colW"
            :y="PAD.t"
            :width="colW"
            :height="H - PAD.t - PAD.b"
            :fill="hover === i ? '#eaf1fb' : 'transparent'"
          />
          <rect
            :x="PAD.l + i * colW + colW * 0.12"
            :y="y(b.masuk)"
            :width="colW * 0.36"
            :height="Math.max(0, H - PAD.b - y(b.masuk))"
            fill="#159447"
            rx="2"
          />
          <rect
            :x="PAD.l + i * colW + colW * 0.52"
            :y="y(b.keluar)"
            :width="colW * 0.36"
            :height="Math.max(0, H - PAD.b - y(b.keluar))"
            fill="#e08a12"
            rx="2"
          />
          <text
            v-if="i % skipLabel === 0"
            :x="PAD.l + i * colW + colW / 2"
            :y="H - PAD.b + 14"
            text-anchor="middle"
            font-size="10"
            fill="#64748b"
          >{{ b.label }}</text>
          <title>{{ b.tip }} — Masuk {{ fmtL(b.masuk) }} L • Keluar {{ fmtL(b.keluar) }} L</title>
        </g>
      </svg>
    </div>
    <div v-if="hover !== null && bars[hover]" class="sc-tip">
      <b>{{ bars[hover].tip }}</b> &nbsp; Masuk <span style="color: #159447">{{ fmtL(bars[hover].masuk) }} L</span>
      &nbsp;•&nbsp; Keluar <span style="color: #b96e05">{{ fmtL(bars[hover].keluar) }} L</span>
    </div>
    <div v-else class="sc-tip msub">Arahkan kursor ke batang untuk melihat angkanya.</div>
  </div>
</template>

<style scoped>
.sc-legend {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}
.sc-legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 6px;
}
.sc-scroll {
  overflow-x: auto;
}
.sc-tip {
  min-height: 20px;
  font-size: 13px;
  margin-top: 4px;
}
</style>
