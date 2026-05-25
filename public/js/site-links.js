(function () {
  function applySiteLinks() {
    var site = window.SIGNPACK_SITE;
    if (!site) return;

    document.querySelectorAll("[data-signpack-github]").forEach(function (el) {
      el.href = site.github;
      if (!el.getAttribute("target")) el.setAttribute("target", "_blank");
      if (!el.getAttribute("rel")) el.setAttribute("rel", "noopener noreferrer");
    });

    document.querySelectorAll("[data-signpack-live]").forEach(function (el) {
      el.href = site.live;
      if (!el.getAttribute("target")) el.setAttribute("target", "_blank");
      if (!el.getAttribute("rel")) el.setAttribute("rel", "noopener noreferrer");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applySiteLinks);
  } else {
    applySiteLinks();
  }
})();
