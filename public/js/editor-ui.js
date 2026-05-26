(function () {
  function initEditorPickers() {
    document.querySelectorAll("[data-editor-picker]").forEach(function (root) {
      var select = root.querySelector("select.editor-picker-native");
      var btn = root.querySelector(".editor-picker-btn");
      var list = root.querySelector(".editor-picker-list");
      if (!select || !btn || !list) return;

      var labelEl = btn.querySelector(".editor-picker-value");

      function syncLabel() {
        var opt = select.options[select.selectedIndex];
        if (labelEl && opt) {
          labelEl.textContent = opt.textContent;
          labelEl.classList.toggle("is-create-new", opt.value === "new" || opt.value === "");
        }
      }

      function closeList() {
        list.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }

      function openList() {
        list.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        var active = list.querySelector('[aria-selected="true"]');
        if (active) active.focus();
      }

      function setActiveOption(optionEl) {
        list.querySelectorAll('[role="option"]').forEach(function (o) {
          o.setAttribute("aria-selected", "false");
          o.classList.remove("is-active");
        });
        if (optionEl) {
          optionEl.setAttribute("aria-selected", "true");
          optionEl.classList.add("is-active");
        }
      }

      function buildListFromSelect() {
        list.innerHTML = "";
        Array.prototype.forEach.call(select.options, function (opt) {
          var li = document.createElement("li");
          li.setAttribute("role", "option");
          li.setAttribute("data-value", opt.value);
          li.tabIndex = -1;
          li.textContent = opt.textContent;
          if (opt.selected) {
            li.setAttribute("aria-selected", "true");
            li.classList.add("is-active");
          }
          if (opt.value === "new" || opt.value === "") li.classList.add("is-create-new");
          li.addEventListener("click", function () {
            select.value = opt.value;
            syncLabel();
            setActiveOption(li);
            closeList();
            select.dispatchEvent(new Event("change", { bubbles: true }));
          });
          list.appendChild(li);
        });
      }

      buildListFromSelect();
      syncLabel();

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (list.hidden) openList();
        else closeList();
      });

      btn.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openList();
        }
      });

      list.addEventListener("keydown", function (e) {
        var items = Array.prototype.slice.call(list.querySelectorAll('[role="option"]'));
        var idx = items.indexOf(document.activeElement);
        if (e.key === "Escape") {
          closeList();
          btn.focus();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          (items[Math.min(idx + 1, items.length - 1)] || items[0]).focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          (items[Math.max(idx - 1, 0)] || items[items.length - 1]).focus();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (document.activeElement && document.activeElement.getAttribute("role") === "option") {
            document.activeElement.click();
          }
        }
      });

      document.addEventListener("click", function (e) {
        if (!root.contains(e.target)) closeList();
      });
    });
  }

  function initDropzones() {
    document.querySelectorAll("[data-editor-dropzone]").forEach(function (zone) {
      var input = zone.querySelector('input[type="file"]');
      var nameEl = zone.querySelector("[data-dropzone-name]");
      var browseBtn = zone.querySelector("[data-dropzone-browse]");
      if (!input) return;

      function showName(file) {
        if (nameEl) nameEl.textContent = file ? file.name : "";
      }

      function pickFile() {
        input.click();
      }

      zone.addEventListener("click", function (e) {
        if (e.target.closest("[data-dropzone-browse]") || e.target === zone || e.target.closest(".editor-dropzone-title")) {
          if (!e.target.closest("a")) pickFile();
        }
      });

      if (browseBtn) {
        browseBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          pickFile();
        });
      }

      input.addEventListener("change", function () {
        showName(input.files && input.files[0]);
      });

      ["dragenter", "dragover"].forEach(function (ev) {
        zone.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add("is-dragover");
        });
      });

      ["dragleave", "drop"].forEach(function (ev) {
        zone.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove("is-dragover");
        });
      });

      zone.addEventListener("drop", function (e) {
        if (!e.dataTransfer.files.length) return;
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        showName(e.dataTransfer.files[0]);
      });
    });
  }

  function initSidebar() {
    var sidebar = document.getElementById("editorSidebar");
    var overlay = document.getElementById("editorSidebarOverlay");
    var toggle = document.getElementById("editorSidebarToggle");
    if (!sidebar) return;

    function closeSidebar() {
      sidebar.classList.remove("is-open");
      if (overlay) overlay.classList.remove("is-visible");
    }

    function openSidebar() {
      sidebar.classList.add("is-open");
      if (overlay) overlay.classList.add("is-visible");
    }

    if (toggle) {
      toggle.addEventListener("click", function () {
        if (sidebar.classList.contains("is-open")) closeSidebar();
        else openSidebar();
      });
    }

    if (overlay) overlay.addEventListener("click", closeSidebar);

    document.querySelectorAll("[data-editor-scroll]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        var sel = link.getAttribute("data-editor-scroll");
        if (!sel || sel.charAt(0) !== "#") return;
        var el = document.querySelector(sel);
        if (!el) return;
        e.preventDefault();
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelectorAll(".editor-sidebar-link").forEach(function (l) {
          l.classList.remove("is-active");
        });
        link.classList.add("is-active");
        closeSidebar();
      });
    });

    document.querySelectorAll("[data-editor-nav-href]").forEach(function (link) {
      link.addEventListener("click", function () {
        closeSidebar();
      });
    });

    document.querySelectorAll("[data-export-pack]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var packId = link.getAttribute("data-export-pack");
        if (packId && typeof downloadAndReload === "function") {
          downloadAndReload(packId);
        }
        closeSidebar();
      });
    });
  }

  function initSiteLinks() {
    if (!window.SIGNPACK_SITE) return;
    document.querySelectorAll("[data-signpack-github]").forEach(function (el) {
      el.href = window.SIGNPACK_SITE.github;
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    });
  }

  function initTooltips() {
    if (typeof bootstrap === "undefined") return;
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
      new bootstrap.Tooltip(el);
    });
  }

  function initUserMenu() {
    var menu = document.getElementById("editorUserMenu");
    var toggle = document.getElementById("editorUserMenuToggle");
    var panel = document.getElementById("editorUserMenuPanel");
    if (!menu || !toggle || !panel) return;

    function closeMenu() {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    function openMenu() {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    }

    toggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (panel.hidden) openMenu();
      else closeMenu();
    });

    document.addEventListener("click", function (e) {
      if (!menu.contains(e.target)) closeMenu();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  function init() {
    initEditorPickers();
    initDropzones();
    initSidebar();
    initSiteLinks();
    initTooltips();
    initUserMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
