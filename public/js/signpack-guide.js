/**
 * Traffic Control signpack guidance (summarized from official wiki).
 * @see https://github.com/CSX8600/trafficcontrol/wiki/Making-a-Custom-Sign-Pack
 */
window.TC_SIGNPACK_WIKI =
  "https://github.com/CSX8600/trafficcontrol/wiki/Making-a-Custom-Sign-Pack";

window.TC_DEFAULT_SIGN_FOLDERS = [
  "circle",
  "diamond",
  "misc",
  "rectangle",
  "square",
  "triangle",
];

(function () {
  var WARN_ID = "guideValidationBanner";

  function el(id) {
    return document.getElementById(id);
  }

  function showWarnings(messages) {
    var box = el(WARN_ID);
    if (!box) return;
    if (!messages.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML =
      "<strong><i class=\"fa fa-triangle-exclamation me-1\"></i> Tips (won't block save)</strong><ul class=\"mb-0 mt-2 ps-3\">" +
      messages.map(function (m) {
        return "<li>" + m + "</li>";
      }).join("") +
      "</ul>";
  }

  function isPngFile(file) {
    if (!file) return true;
    var n = (file.name || "").toLowerCase();
    return n.endsWith(".png");
  }

  function isZipFile(file) {
    if (!file) return true;
    return (file.name || "").toLowerCase().endsWith(".zip");
  }

  function collectWarnings() {
    var msgs = [];
    var folder = (el("signtype_folder") && el("signtype_folder").value.trim().toLowerCase()) || "";
    if (folder && window.TC_DEFAULT_SIGN_FOLDERS.indexOf(folder) === -1) {
      msgs.push(
        "Sign folder <code>" +
          folder +
          "</code> is custom. Default TC folders are: " +
          window.TC_DEFAULT_SIGN_FOLDERS.join(", ") +
          "."
      );
    }

    var front = el("frontImageInput");
    if (front && front.files && front.files[0] && !isPngFile(front.files[0])) {
      msgs.push("Front texture should be a <strong>PNG</strong> file per Traffic Control.");
    }
    var back = el("backImageInput");
    if (back && back.files && back.files[0] && !isPngFile(back.files[0])) {
      msgs.push("Back texture should be a <strong>PNG</strong> file per Traffic Control.");
    }

    var upload = el("signpackFile");
    if (upload && upload.files && upload.files[0] && !isZipFile(upload.files[0])) {
      msgs.push("Imported signpacks must be a <strong>ZIP</strong> containing <code>signs.json</code>.");
    }

    document.querySelectorAll("#textlinesContainer .editor-textline-card").forEach(function (card, i) {
      ["x", "y", "width"].forEach(function (field) {
        var input = card.querySelector('[name$="[' + field + ']"]');
        if (!input || input.value === "") return;
        var n = parseFloat(input.value);
        if (isNaN(n) || n < 0 || n > 16) {
          msgs.push(
            "Textline #" +
              (i + 1) +
              ": <code>" +
              field +
              "</code> should be within the 16×16 grid (0–16)."
          );
        }
      });
    });

    return msgs;
  }

  function bindValidation() {
    var form = el("signpackForm");
    if (!form) return;

    function refresh() {
      showWarnings(collectWarnings());
    }

    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);

    var uploadForm = document.querySelector('form[action="/signpack/upload"]');
    if (uploadForm) {
      uploadForm.addEventListener("change", function () {
        var f = el("signpackFile");
        if (f && f.files && f.files[0] && !isZipFile(f.files[0])) {
          showWarnings(["Imported signpacks must be a ZIP file with signs.json at the root."]);
        }
      });
    }

    refresh();
  }

  function init() {
    bindValidation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
