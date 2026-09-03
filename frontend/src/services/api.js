const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
// Origin backend tanpa "/api" di belakangnya, dipakai untuk membangun URL
// file yang di-upload (mis. bukti Solar) yang di-serve statis dari
// "<origin>/uploads/...", bukan lewat "/api/...".
const BACKEND_ORIGIN = BASE_URL.replace(/\/api\/?$/, "");

function getToken() {
  return localStorage.getItem("bms_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    // Token kadaluarsa / tidak valid -> paksa login ulang
    localStorage.removeItem("bms_token");
    localStorage.removeItem("bms_user");
    window.location.href = "/login";
    throw new Error("Sesi habis, silakan login ulang");
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || "Terjadi kesalahan");
  }
  return data;
}

// Dipakai buat endpoint yang membalas file (misalnya export ke Excel),
// bukan JSON - langsung memicu download di browser lewat link sementara.
async function download(path, fallbackFilename) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    let msg = "Gagal mengunduh file";
    try {
      const data = await res.json();
      msg = data?.error || msg;
    } catch {
      // respons bukan JSON, pakai pesan default
    }
    throw new Error(msg);
  }

  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || fallbackFilename || "download";

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// Dipakai untuk endpoint yang menerima file (multipart/form-data), mis.
// upload bukti Solar - beda dari request() biasa yang selalu mengirim JSON.
async function upload(path, formData, method = "POST") {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Sengaja TIDAK set Content-Type di sini - browser yang mengisi
      // otomatis (termasuk boundary multipart-nya) kalau body-nya FormData.
    },
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem("bms_token");
    localStorage.removeItem("bms_user");
    window.location.href = "/login";
    throw new Error("Sesi habis, silakan login ulang");
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    throw new Error(data?.error || "Terjadi kesalahan");
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
  download,
  upload,
  // Bangun URL lengkap ke file yang diupload (mis. bukti Solar), dari path
  // relatif yang dibalas backend (mis. "/uploads/solar/xxx.jpg").
  fileUrl: (relPath) => (relPath ? `${BACKEND_ORIGIN}${relPath}` : null),
};