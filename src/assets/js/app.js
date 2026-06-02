// Frontend logic for the PDF → Excel converter.
(function () {
  "use strict";

  // Language switcher: navigate to the selected locale route.
  var langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.addEventListener("change", function () {
      if (this.value) window.location.href = this.value;
    });
  }

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
    return (
      file.type === "application/pdf" || /\.pdf$/i.test(file.name)
    );
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
})();
