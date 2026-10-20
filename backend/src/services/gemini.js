// Pemanggil Gemini bersama untuk "baca dokumen (menu Impor)" dan "AI Assist".
// Memakai env yang SAMA dengan scan kamera (routes/scan.js): GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODELS.
export const aiAktif = () => !!process.env.GEMINI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpError = (status, message) => Object.assign(new Error(message), { status });

function daftarModel() {
  const utama = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const cadangan = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.5-flash-lite").split(",").map((x) => x.trim()).filter(Boolean);
  return [...new Set([utama, ...cadangan])];
}

async function satuPanggilan(model, key, body, tanpaThinking) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const gc = { ...(body.generationConfig || {}) };
    if (!tanpaThinking && /2\.5-flash/.test(model)) gc.thinkingConfig = { thinkingBudget: 0 };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ ...body, generationConfig: gc }),
    });
    if (r.ok) return { ok: true, status: 200, json: await r.json() };
    let detail = "";
    try { detail = (await r.json())?.error?.message || ""; } catch { /* abaikan */ }
    return { ok: false, status: r.status, detail };
  } catch (e) {
    return { ok: false, status: e.name === "AbortError" ? 504 : 0, detail: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// body: { contents, systemInstruction?, tools?, generationConfig? } -> candidate.content ({ role, parts })
export async function geminiGenerate(body) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw httpError(501, "AI belum diaktifkan di server (GEMINI_API_KEY belum diisi)");
  let terakhir = null;
  for (const model of daftarModel()) {
    for (let coba = 0; coba < 2; coba++) {
      let r = await satuPanggilan(model, key, body, false);
      if (!r.ok && r.status === 400 && /thinking/i.test(r.detail || "")) r = await satuPanggilan(model, key, body, true);
      if (r.ok) {
        const content = r.json?.candidates?.[0]?.content;
        if (content?.parts?.length) return content;
        terakhir = { status: 502, detail: "jawaban AI kosong" };
        break;
      }
      terakhir = r;
      console.error(`[ai] model=${model} status=${r.status} ${r.detail || ""}`.slice(0, 300));
      const sementara = r.status === 429 || r.status === 0 || r.status === 504 || r.status >= 500;
      if (!sementara || r.status === 429) break;
      await sleep(700 * (coba + 1));
    }
  }
  const st = terakhir?.status;
  if (st === 429) throw httpError(429, "Kuota gratis AI sedang habis, coba lagi sebentar lagi.");
  if (st === 400 || st === 403 || st === 404) throw httpError(502, `AI menolak permintaan (${st}). Cek GEMINI_MODEL / GEMINI_API_KEY. ${terakhir.detail || ""}`.trim());
  if (st === 504) throw httpError(504, "AI terlalu lama merespons");
  throw httpError(502, `AI sedang sibuk (${st || "tidak terhubung"}). ${terakhir?.detail || ""}`.trim());
}

export async function geminiBacaGambar(prompt, dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) throw httpError(400, "Format gambar tidak valid");
  const content = await geminiGenerate({
    contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  const text = content.parts.map((p) => p.text || "").join("");
  try {
    return JSON.parse(text.replace(/^```json\s*|```\s*$/g, "").trim());
  } catch {
    throw httpError(502, "Jawaban AI tidak bisa dibaca, coba ulangi atau foto lebih jelas");
  }
}
