// ============================================================
// EXPORT WORD (.doc) -- dipakai halaman "Laporan Divisi" tab
// "Stok Solar". Microsoft Word bisa membuka file HTML yang disimpan
// dengan ekstensi .doc (dan Content-Type application/msword) - jadi
// tidak perlu tambah dependency baru (docx/mammoth dst) yang berat,
// cukup HTML sederhana dengan tabel biasa. Dibuka otomatis oleh Word
// & juga bisa dibuka/diedit ulang di Google Docs kalau diimport.
// ============================================================

function rupiahNum(n) {
  return Math.round(Number(n) || 0);
}

function fmtDateID(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function downloadHtmlAsDoc(html, filename) {
  const full = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8"><title>Export</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    th, td { border: 1px solid #999; padding: 4px 8px; font-size: 12px; }
    th { background: #f0f0f0; text-align: left; }
    .num { text-align: right; }
    h1 { font-size: 16px; text-align: center; margin-bottom: 2px; }
    h2 { font-size: 13px; text-align: center; margin-top: 0; margin-bottom: 2px; }
    .period { text-align: center; color: #555; font-size: 11px; margin-bottom: 16px; }
    .sec-title { font-weight: bold; margin: 14px 0 4px; }
  </style>
  </head><body>${html}</body></html>`;

  const blob = new Blob(["\ufeff", full], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// Stok Solar (BBM)
// ------------------------------------------------------------
export function exportSolarStokWord({ bulanLabel, items, totalMasuk, totalKeluar, saldoSaatIni }) {
  const masuk = items.filter((t) => t.tipe === "MASUK");
  const keluar = items.filter((t) => t.tipe === "KELUAR");

  const rowsMasuk = masuk.length
    ? masuk
        .map(
          (t, i) =>
            `<tr><td>${i + 1}</td><td>${esc(t.no)}</td><td>${fmtDateID(t.tanggal)}</td><td>${esc(t.nama)}</td><td class="num">${t.liter}</td><td>${esc(t.keterangan || "-")}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="6" style="text-align:center;color:#777">Belum ada data.</td></tr>`;

  const rowsKeluar = keluar.length
    ? keluar
        .map(
          (t, i) =>
            `<tr><td>${i + 1}</td><td>${esc(t.no)}</td><td>${fmtDateID(t.tanggal)}</td><td>${esc(t.nama)}</td><td class="num">${t.liter}</td><td>${esc(t.lokasi || "-")}</td><td>${esc(t.keterangan || "-")}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="7" style="text-align:center;color:#777">Belum ada data.</td></tr>`;

  const html = `
    <h1>PT. BINTANG MUARA SEJATI</h1>
    <h2>REKAP STOK SOLAR (BBM) &mdash; ALAT BERAT</h2>
    <div class="period">Bulan ${esc(bulanLabel)}</div>

    <div class="sec-title">Solar Masuk</div>
    <table>
      <tr><th>No</th><th>Nomor</th><th>Tanggal</th><th>Nama Sopir</th><th>Liter</th><th>Keterangan</th></tr>
      ${rowsMasuk}
      <tr><td colspan="4"><b>Total Masuk</b></td><td class="num"><b>${totalMasuk}</b></td><td></td></tr>
    </table>

    <div class="sec-title">Solar Keluar</div>
    <table>
      <tr><th>No</th><th>Nomor</th><th>Tanggal</th><th>Nama Operator</th><th>Liter</th><th>Lokasi</th><th>Keterangan</th></tr>
      ${rowsKeluar}
      <tr><td colspan="4"><b>Total Keluar</b></td><td class="num"><b>${totalKeluar}</b></td><td colspan="2"></td></tr>
    </table>

    <p><b>Sisa Stok Saat Ini: ${saldoSaatIni} Liter</b></p>
  `;

  downloadHtmlAsDoc(html, `stok-solar-${bulanLabel.toLowerCase().replace(/\s+/g, "-")}.doc`);
}
