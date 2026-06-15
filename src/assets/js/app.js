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
  var outputExt = form.dataset.ext || "pdf";
  var acceptRe = new RegExp("\\.(" + (form.dataset.acceptExt || "pdf") + ")$", "i");
  var multiple = fileInput.multiple;
  var paramInput = document.getElementById("paramInput");
  var selectedFiles = [];

  function setStatus(text, isError) {
    statusMsg.textContent = text || "";
    statusMsg.classList.toggle("error", !!isError);
  }

  function isAccepted(file) {
    return acceptRe.test(file.name);
  }

  function chooseFiles(list) {
    var arr = Array.prototype.slice.call(list || []).filter(isAccepted);
    if (!arr.length) {
      setStatus(msg.fileType, true);
      return;
    }
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].size > MAX_BYTES) {
        setStatus(msg.tooLarge, true);
        return;
      }
    }
    if (!multiple) arr = arr.slice(0, 1);
    selectedFiles = arr;
    fileNameEl.textContent = arr.length === 1 ? arr[0].name : arr.length + " files";
    fileNameEl.hidden = false;
    convertBtn.disabled = false;
    setStatus("");
    downloadLink.hidden = true;
  }

  fileInput.addEventListener("change", function () {
    chooseFiles(this.files);
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
    if (e.dataTransfer.files.length) chooseFiles(e.dataTransfer.files);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selectedFiles.length) return;
    if (multiple && selectedFiles.length < 2) {
      setStatus(form.dataset.msgMin || msg.error, true);
      return;
    }
    var paramVal = "";
    if (paramInput) {
      paramVal = paramInput.value.trim();
      if (!paramVal) {
        setStatus(paramInput.placeholder, true);
        return;
      }
    }

    // GA4: file(s) uploaded for processing.
    track(
      "pdf_upload",
      multiple
        ? { language: lang, file_count: selectedFiles.length }
        : { language: lang, file_size_mb: Math.round((selectedFiles[0].size / 1048576) * 100) / 100 }
    );

    convertBtn.disabled = true;
    downloadLink.hidden = true;
    setStatus(msg.converting);

    var request;
    if (multiple) {
      var fd = new FormData();
      selectedFiles.forEach(function (f) {
        fd.append("files", f);
      });
      request = fetch(endpoint, { method: "POST", body: fd });
    } else {
      var url = endpoint;
      if (paramVal) {
        url +=
          (url.indexOf("?") >= 0 ? "&" : "?") +
          encodeURIComponent(paramInput.dataset.param) +
          "=" +
          encodeURIComponent(paramVal);
      }
      request = fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": selectedFiles[0].type || "application/octet-stream",
          "X-Filename": encodeURIComponent(selectedFiles[0].name)
        },
        body: selectedFiles[0]
      });
    }

    request
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var url2 = URL.createObjectURL(blob);
        downloadLink.href = url2;
        var base = multiple ? "merged" : selectedFiles[0].name.replace(/\.[^.]+$/, "");
        downloadLink.download = base + "." + outputExt;
        downloadLink.hidden = false;
        setStatus(msg.ready);
        convertBtn.disabled = false;
      })
      .catch(function () {
        setStatus(msg.error, true);
        convertBtn.disabled = false;
      });
  });

  // GA4: the user clicked to download the converted file. The event name is
  // per-tool (e.g. excel_download, download_word) via data-download-event.
  downloadLink.addEventListener("click", function () {
    track(form.dataset.downloadEvent || "file_download", { language: lang });
  });
})();
