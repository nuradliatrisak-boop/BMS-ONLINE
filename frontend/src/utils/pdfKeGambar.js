// Ubah file PDF / foto jadi daftar gambar (data URL JPEG) per halaman, supaya bisa dibaca AI di menu Impor.
// pdf.js dimuat hanya saat dibutuhkan (dynamic import) supaya halaman lain tidak jadi berat.
const LEBAR_MAKS = 1600;

function canvasKeJpeg(canvas) {
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function gambarKeJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`Gambar ${file.name} tidak bisa dibuka`));
      i.src = url;
    });
    const skala = Math.min(1, LEBAR_MAKS / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * skala);
    c.height = Math.round(img.height * skala);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return canvasKeJpeg(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfKeJpeg(file, maksHalaman) {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const hasil = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maksHalaman); n++) {
    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const skala = LEBAR_MAKS / Math.max(v1.width, v1.height);
    const vp = page.getViewport({ scale: skala });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    hasil.push(canvasKeJpeg(c));
  }
  return { gambar: hasil, totalHalaman: pdf.numPages };
}

// -> [{ nama, halaman, gambar }]
export async function berkasKeGambar(files, maksHalaman = 12) {
  const out = [];
  for (const f of files) {
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      const { gambar } = await pdfKeJpeg(f, maksHalaman);
      gambar.forEach((g, i) => out.push({ nama: f.name, halaman: i + 1, gambar: g }));
    } else if (f.type.startsWith("image/")) {
      out.push({ nama: f.name, halaman: 1, gambar: await gambarKeJpeg(f) });
    }
  }
  return out;
}
