// Frontend logic for the PDF → Excel converter.
(function () {
  "use strict";

  var lang = document.documentElement.lang || "en";

  // Push a custom event to the GTM dataLayer (for GA4 tracking).
  function track(event, params) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: event };
    if (params) for (var k in params) payload[k] = params[k];
    window.dataLayer.push(payload);
  }

  function formatCount(n) {
    try {
      return new Intl.NumberFormat(lang).format(n);
    } catch (e) {
      return String(n);
    }
  }

  // ----- Footer download counter (runs on every page) -----
  var counterWrap = document.querySelector(".footer-counter");
  var countEl = document.getElementById("dl-count");

  function showCount(n) {
    if (!counterWrap || !countEl || typeof n !== "number") return;
    countEl.textContent = formatCount(n);
    counterWrap.hidden = false;
  }

  if (counterWrap && countEl) {
    fetch("/api/counter")
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && typeof d.count === "number") showCount(d.count); })
      .catch(function () { /* leave counter hidden */ });
  }

  function bumpCounter() {
    fetch("/api/counter", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && typeof d.count === "number") showCount(d.count); })
      .catch(function () {});
  }

  // Language switcher: navigate to the selected locale route.
  var langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.addEventListener("change", function () {
      if (this.value) window.location.href = this.value;
    });
  }

  // ----- Converter (home page only) -----
  var form = document.getElementById("convertForm");
  if (!form) return;

  var fileInput = document.getElementById("fileInput");
  var dropZone = document.getElementById("dropZone");
  var fileNameEl = document.getElementById("fileName");
  var convertBtn = document.getElementById("convertBtn");
  var statusMsg = document.getElementById("statusMsg");
  var downloadLink = document.getElementById("downloadLink");

  var MAX_BYTES = 20 * 1024 * 1024; // 20 MB
  var msg = {
    converting: form.dataset.msgConverting,
    ready: form.dataset.msgReady,
    error: form.dataset.msgError,
    fileType: form.dataset.msgFiletype,
    tooLarge: form.dataset.msgToolarge
  };
  var endpoint = form.dataset.endpoint || "/api/convert";
  var selectedFile = null;

  function setStatus(text, isError) {
    statusMsg.textContent = text || "";
    statusMsg.classList.toggle("error", !!isError);
  }

  function isPdf(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function chooseFile(file) {
    if (!file) return;
    if (!isPdf(file)) {
      setStatus(msg.fileType, true);
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus(msg.tooLarge, true);
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = file.name;
    fileNameEl.hidden = false;
    convertBtn.disabled = false;
    setStatus("");
    downloadLink.hidden = true;
  }

  fileInput.addEventListener("change", function () {
    chooseFile(this.files[0]);
  });

  // Drag & drop
  ["dragenter", "dragover"].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    });
  });
  dropZone.addEventListener("drop", function (e) {
    if (e.dataTransfer.files.length) chooseFile(e.dataTransfer.files[0]);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selectedFile) return;

    // GA4: a file was uploaded for conversion.
    track("pdf_upload", {
      language: lang,
      file_size_mb: Math.round((selectedFile.size / 1048576) * 100) / 100
    });

    convertBtn.disabled = true;
    downloadLink.hidden = true;
    setStatus(msg.converting);

    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Filename": encodeURIComponent(selectedFile.name)
      },
      body: selectedFile
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        downloadLink.href = url;
        downloadLink.download = selectedFile.name.replace(/\.pdf$/i, "") + ".xlsx";
        downloadLink.hidden = false;
        setStatus(msg.ready);
        convertBtn.disabled = false;
      })
      .catch(function () {
        setStatus(msg.error, true);
        convertBtn.disabled = false;
      });
  });

  // GA4 + counter: the user clicked to download the converted file.
  downloadLink.addEventListener("click", function () {
    track("excel_download", { language: lang });
    bumpCounter();
  });
})();
