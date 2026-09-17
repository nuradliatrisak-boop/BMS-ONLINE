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
  del: function (path) { return apiRequest(path, "DELETE"); },
  // Dipakai buat endpoint yang membalas file (contoh: export invoice/surat
  // jalan ke Excel), bukan JSON - langsung memicu download di browser.
  // options opsional: { method: "POST", body: {...} } - dipakai untuk
  // export gabungan beberapa dokumen sekaligus (lihat surat-jalan-list.html).
  download: function (path, fallbackFilename, options) {
    var token = getToken();
    var opts = options || {};
    var headers = {};
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }
    if (opts.body) {
      headers["Content-Type"] = "application/json";
    }

    return fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      if (res.status === 401) {
        clearSession();
        window.location.href = "login.html";
        throw new Error("Sesi habis, silakan login ulang");
      }

      if (!res.ok) {
        return res.json().catch(function () { return null; }).then(function (data) {
          var msg = (data && data.error) ? data.error : "Gagal mengunduh file";
          throw new Error(msg);
        });
      }

      var disposition = res.headers.get("content-disposition") || "";
      var match = disposition.match(/filename="?([^"]+)"?/);
      var filename = (match && match[1]) ? match[1] : (fallbackFilename || "download");

      return res.blob().then(function (blob) {
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.parentNode.removeChild(a);
        window.URL.revokeObjectURL(url);
      });
    });
  }
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

// Upgrade <select> biasa jadi bisa diketik buat nyaring opsi (dipakai buat
// dropdown yang isinya banyak: customer, stock, armada, dll), tanpa perlu
// ubah kode lain yang sudah baca/tulis ".value" atau dengar event "change"
// dari select itu -- select aslinya tetap ada di DOM (disembunyikan),
// cuma ditambah tampilan input+daftar di atasnya, dan disinkronkan otomatis.
//
// Pemakaian: panggil sekali setelah elemen <select>-nya ada di DOM, boleh
// sebelum opsinya diisi (baru keisi belakangan lewat appendChild, tetap
// otomatis ke-refresh):
//   makeSearchableSelect(document.getElementById("customerId"), { placeholder: "Cari customer..." });
function makeSearchableSelect(select, opts) {
  if (!select || select.getAttribute("data-searchable") === "1") return;
  select.setAttribute("data-searchable", "1");
  opts = opts || {};

  var wrap = document.createElement("div");
  wrap.className = "ss-wrap";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.className = (select.className || "") + " ss-native";

  var input = document.createElement("input");
  input.type = "text";
  input.className = "ss-input";
  input.autocomplete = "off";
  input.placeholder = opts.placeholder || "Ketik untuk cari...";
  wrap.appendChild(input);

  var list = document.createElement("div");
  list.className = "ss-list";
  list.style.display = "none";
  wrap.appendChild(list);

  function currentLabel() {
    var opt = select.options[select.selectedIndex];
    return opt ? opt.textContent : "";
  }

  function renderList(filter) {
    list.innerHTML = "";
    var q = (filter || "").toLowerCase();
    var any = false;
    for (var i = 0; i < select.options.length; i++) {
      var opt = select.options[i];
      if (opt.disabled) continue;
      var text = opt.textContent;
      if (q && text.toLowerCase().indexOf(q) === -1) continue;
      any = true;
      (function (opt, text) {
        var item = document.createElement("div");
        item.className = "ss-item";
        if (opt.value === select.value) item.className += " active";
        item.textContent = text;
        item.addEventListener("mousedown", function (e) {
          e.preventDefault();
          select.value = opt.value;
          input.value = text;
          list.style.display = "none";
          var ev;
          try {
            ev = new Event("change", { bubbles: true });
          } catch (err) {
            ev = document.createEvent("Event");
            ev.initEvent("change", true, true);
          }
          select.dispatchEvent(ev);
        });
        list.appendChild(item);
      })(opt, text);
    }
    if (!any) {
      var empty = document.createElement("div");
      empty.className = "ss-empty";
      empty.textContent = "Tidak ada hasil";
      list.appendChild(empty);
    }
    list.style.display = "block";
  }

  input.addEventListener("focus", function () {
    input.value = "";
    renderList("");
  });
  input.addEventListener("input", function () {
    renderList(input.value);
  });
  input.addEventListener("blur", function () {
    setTimeout(function () {
      list.style.display = "none";
      input.value = currentLabel();
    }, 150);
  });

  // Supaya kode lain yang set "select.value = ..." langsung dari luar
  // (misal setelah reload data) tetap bikin tampilan input ini ikut update.
  var nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  Object.defineProperty(select, "value", {
    get: function () {
      return nativeDescriptor.get.call(select);
    },
    set: function (v) {
      nativeDescriptor.set.call(select, v);
      input.value = currentLabel();
    },
    configurable: true,
  });

  // Banyak halaman ngisi <option> belakangan (setelah fetch API selesai),
  // jadi label yang ditampilkan perlu ikut di-refresh begitu itu terjadi.
  var mo = new MutationObserver(function () {
    input.value = currentLabel();
  });
  mo.observe(select, { childList: true });

  input.value = currentLabel();
}