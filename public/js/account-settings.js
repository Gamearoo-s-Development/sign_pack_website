(function () {
  var cfg = window.ACCOUNT_SETTINGS || {};
  var toastEl = document.getElementById("accountToast");
  var previewEl = document.getElementById("accountAvatarPreview");
  var pickBtn = document.getElementById("accountAvatarPickBtn");
  var fileInput = document.getElementById("accountAvatarInput");
  var removeBtn = document.getElementById("accountAvatarRemoveBtn");
  var profileForm = document.getElementById("accountProfileForm");
  var passkeysListEl = document.getElementById("passkeysList");
  var addPasskeyBtn = document.getElementById("addPasskeyBtn");
  var passkeys = Array.isArray(cfg.passkeys) ? cfg.passkeys.slice() : [];

  function showToast(message, type) {
    if (!toastEl || !message) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.className = "account-toast show" + (type ? " is-" + type : "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toastEl.classList.remove("show");
      toastEl.hidden = true;
    }, 4200);
  }

  function setPreviewFromUrl(url) {
    var current = document.getElementById("accountAvatarPreview");
    if (!current) return;
    if (url) {
      var img = document.createElement("img");
      img.id = "accountAvatarPreview";
      img.className = "account-avatar-preview";
      img.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
      img.alt = "Profile picture";
      current.replaceWith(img);
      if (removeBtn) removeBtn.hidden = false;
    } else {
      var div = document.createElement("div");
      div.id = "accountAvatarPreview";
      div.className = "account-avatar-preview is-initials";
      div.textContent = cfg.initials || "?";
      current.replaceWith(div);
      if (removeBtn) removeBtn.hidden = true;
    }
  }

  function setPreviewFromFile(file) {
    var current = document.getElementById("accountAvatarPreview");
    if (!file || !current) return;
    var reader = new FileReader();
    reader.onload = function () {
      if (current.tagName === "IMG") {
        current.src = reader.result;
      } else {
        var img = document.createElement("img");
        img.id = "accountAvatarPreview";
        img.className = "account-avatar-preview";
        img.src = reader.result;
        img.alt = "Preview";
        current.replaceWith(img);
      }
    };
    reader.readAsDataURL(file);
  }

  function fmtDate(raw) {
    if (!raw) return "Never";
    var d = new Date(raw);
    if (isNaN(d.getTime())) return "Unknown";
    return d.toLocaleString();
  }

  function renderPasskeys() {
    if (!passkeysListEl) return;
    if (!passkeys.length) {
      passkeysListEl.innerHTML =
        '<p class="small text-secondary mb-0" id="passkeysEmptyState">No passkeys added yet.</p>';
      return;
    }
    passkeysListEl.innerHTML = passkeys
      .map(function (p) {
        var warn =
          p.needsReregister
            ? '<div class="small text-warning mt-1">Needs re-register — remove and add again.</div>'
            : "";
        return (
          '<div class="account-passkey-item" data-credential-id="' +
          String(p.credentialID || "") +
          '">' +
          "<div>" +
          "<strong>" +
          String(p.name || "Passkey") +
          "</strong>" +
          '<div class="small text-secondary">Created: ' +
          fmtDate(p.createdAt) +
          "</div>" +
          '<div class="small text-secondary">Last used: ' +
          fmtDate(p.lastUsedAt) +
          "</div>" +
          warn +
          "</div>" +
          '<button type="button" class="btn editor-btn editor-btn-ghost btn-sm account-remove-passkey-btn">' +
          '<i class="fa fa-trash"></i> Remove</button></div>'
        );
      })
      .join("");
  }

  async function addPasskey() {
    if (!cfg.webauthnEnabled) {
      throw new Error("Passkeys are not enabled on this server.");
    }
    if (typeof window.startPasskeyRegistration !== "function") {
      throw new Error("Passkey setup is not available in this browser.");
    }

    var optionsRes = await fetch("/account/passkeys/register/options", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    var optionsData = await optionsRes.json();
    if (!optionsRes.ok || !optionsData.ok || !optionsData.options) {
      throw new Error(optionsData.error || "Could not start passkey setup.");
    }

    var registration;
    try {
      registration = await window.startPasskeyRegistration(optionsData.options);
    } catch (err) {
      throw new Error(err && err.message ? err.message : "Passkey registration cancelled.");
    }

    var label = prompt("Passkey label (optional)", "My device") || "Passkey";
    registration.passkeyName = label.slice(0, 80);

    var verifyRes = await fetch("/account/passkeys/register/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registration),
    });
    var verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.ok) {
      throw new Error(verifyData.error || "Could not verify passkey setup.");
    }
    passkeys = Array.isArray(verifyData.passkeys) ? verifyData.passkeys : passkeys;
    renderPasskeys();
    showToast(verifyData.message || "Passkey added.", "success");
  }

  async function removePasskey(credentialID) {
    var res = await fetch("/account/passkeys/delete", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentialID: credentialID }),
    });
    var data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Could not remove passkey.");
    }
    passkeys = Array.isArray(data.passkeys) ? data.passkeys : passkeys;
    renderPasskeys();
    showToast(data.message || "Passkey removed.", "success");
  }

  async function uploadAvatar(file) {
    var fd = new FormData();
    fd.append("avatar", file);
    var res = await fetch("/account/avatar", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    var data = await res.json().catch(function () {
      return { ok: false, message: "Upload failed." };
    });
    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Upload failed.");
    }
    cfg.avatarUrl = data.avatarUrl;
    setPreviewFromUrl(data.avatarUrl);
    showToast(data.message || "Profile picture updated.", "success");
  }

  async function removeAvatar() {
    var res = await fetch("/account/avatar/delete", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    var data = await res.json().catch(function () {
      return { ok: false, message: "Could not remove photo." };
    });
    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Could not remove photo.");
    }
    cfg.avatarUrl = null;
    setPreviewFromUrl(null);
    showToast(data.message || "Profile picture removed.", "success");
  }

  if (pickBtn && fileInput) {
    pickBtn.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      setPreviewFromFile(file);
      uploadAvatar(file).catch(function (err) {
        showToast(err.message || "Upload failed.", "error");
        setPreviewFromUrl(cfg.avatarUrl);
      });
      fileInput.value = "";
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener("click", function () {
      if (!confirm("Remove your profile picture?")) return;
      removeAvatar().catch(function (err) {
        showToast(err.message || "Could not remove photo.", "error");
      });
    });
  }

  if (profileForm) {
    profileForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var displayName = document.getElementById("displayName");
      var body = new URLSearchParams();
      body.set("displayName", displayName ? displayName.value : "");
      var saveBtn = document.getElementById("accountProfileSaveBtn");
      if (saveBtn) saveBtn.disabled = true;
      try {
        var res = await fetch("/account/profile", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });
        var data = await res.json().catch(function () {
          return { ok: false, message: "Save failed." };
        });
        if (!res.ok || !data.ok) {
          throw new Error(data.message || "Save failed.");
        }
        showToast(data.message || "Profile saved.", "success");
      } catch (err) {
        showToast(err.message || "Save failed.", "error");
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  if (addPasskeyBtn) {
    addPasskeyBtn.addEventListener("click", function () {
      addPasskey().catch(function (err) {
        showToast(err.message || "Could not add passkey.", "error");
      });
    });
  }

  if (passkeysListEl) {
    passkeysListEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".account-remove-passkey-btn");
      if (!btn) return;
      var parent = btn.closest("[data-credential-id]");
      if (!parent) return;
      var id = parent.getAttribute("data-credential-id");
      if (!id) return;
      if (!confirm("Remove this passkey?")) return;
      removePasskey(id).catch(function (err) {
        showToast(err.message || "Could not remove passkey.", "error");
      });
    });
  }

  renderPasskeys();

  if (cfg.flash === "saved") {
    showToast("Changes saved.", "success");
  } else if (cfg.flash === "error" && cfg.flashMessage) {
    showToast(cfg.flashMessage, "error");
  }
})();
