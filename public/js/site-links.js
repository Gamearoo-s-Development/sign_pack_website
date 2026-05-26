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

    var wiki = site.trafficControlWiki || window.TC_SIGNPACK_WIKI;
    var wikiTitle = "Open the official Traffic Control signpack guide";
    if (wiki) {
      document.querySelectorAll("[data-tc-wiki]").forEach(function (el) {
        el.href = wiki;
        if (!el.getAttribute("target")) el.setAttribute("target", "_blank");
        if (!el.getAttribute("rel")) el.setAttribute("rel", "noopener noreferrer");
        if (!el.getAttribute("title")) el.setAttribute("title", wikiTitle);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applySiteLinks);
  } else {
    applySiteLinks();
  }
})();
