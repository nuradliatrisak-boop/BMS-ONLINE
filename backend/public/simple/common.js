// common.js
// Sengaja ditulis pakai JavaScript lama-kompatibel (tanpa optional chaining "?.",
// tanpa object/array spread "...", tanpa nullish coalescing "??") supaya jalan
// di Firefox 52 ESR / Windows XP.
//
// Halaman ini di-serve dari backend Express yang sama (lihat index.js),
// jadi API dipanggil dengan path relatif "/api/..." -> otomatis 1 origin
// dengan backend, tidak perlu setting CORS/URL terpisah.

var API_BASE = "/api";

function getToken() {
  return localStorage.getItem("bms_token");
}

function getUser() {
  var raw = localStorage.getItem("bms_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setSession(token, user) {
  localStorage.setItem("bms_token", token);
  localStorage.setItem("bms_user", JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem("bms_token");
  localStorage.removeItem("bms_user");
}

function logout() {
  clearSession();
  window.location.href = "login.html";
}

// Wajib login. Panggil di awal tiap halaman selain login.html.
function requireLogin() {
  var token = getToken();
  if (!token) {
    window.location.href = "login.html";
    return null;
  }
  return getUser();
}

// Panggilan API sederhana berbasis fetch + async/await (didukung Firefox 52+).
function apiRequest(path, method, body) {
  var token = getToken();
  var headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  var opts = { method: method || "GET", headers: headers };
  if (body !== undefined && body !== null) {
    opts.body = JSON.stringify(body);
  }

  return fetch(API_BASE + path, opts).then(function (res) {
    if (res.status === 401) {
      clearSession();
      window.location.href = "login.html";
      throw new Error("Sesi habis, silakan login ulang");
    }

    var contentType = res.headers.get("content-type") || "";
    var isJson = contentType.indexOf("application/json") !== -1;

    return (isJson ? res.json() : Promise.resolve(null)).then(function (data) {
      if (!res.ok) {
        var msg = (data && data.error) ? data.error : "Terjadi kesalahan pada server";
        throw new Error(msg);
      }
      return data;
    });
  });
}

var api = {
  get: function (path) { return apiRequest(path, "GET"); },
  post: function (path, body) { return apiRequest(path, "POST", body); },
  put: function (path, body) { return apiRequest(path, "PUT", body); },
  patch: function (path, body) { return apiRequest(path, "PATCH", body); },
  del: function (path) { return apiRequest(path, "DELETE"); }
};

function showMsg(el, text, kind) {
  el.className = "msg " + (kind === "ok" ? "ok" : "err");
  el.textContent = text;
  el.style.display = "block";
}

function hideMsg(el) {
  el.style.display = "none";
}

function todayStr() {
  var d = new Date();
  var m = String(d.getMonth() + 1);
  var day = String(d.getDate());
  if (m.length < 2) m = "0" + m;
  if (day.length < 2) day = "0" + day;
  return d.getFullYear() + "-" + m + "-" + day;
}

function nowTimeStr() {
  var d = new Date();
  var h = String(d.getHours());
  var mi = String(d.getMinutes());
  if (h.length < 2) h = "0" + h;
  if (mi.length < 2) mi = "0" + mi;
  return h + ":" + mi;
}

function rupiah(n) {
  var num = Math.round(Number(n) || 0);
  var s = String(num);
  var out = "";
  var count = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    out = s.charAt(i) + out;
    count++;
    if (count % 3 === 0 && i !== 0) {
      out = "." + out;
    }
  }
  return "Rp " + out;
}

function escapeHtml(v) {
  return String(v === undefined || v === null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
