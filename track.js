// Usage events for GoatCounter (docs/ANALYTICS-SEO.md): how far a page is scrolled, which parts of the landing are
// seen, which links are clicked and which files downloaded; photos.js adds the gallery's. Page views are counted by
// the service's script, which also sends these events. The build ships this file only when site.toml sets
// goatcounter. It changes nothing on a page: with the service's script blocked, every call does nothing.
(() => {
  const root = new URL(".", document.currentScript.src).pathname; // the site's path on its host
  const canonical = document.querySelector('link[rel="canonical"]');
  // A preview (localhost, the tailnet) is not the address its pages name as theirs: nothing is counted there.
  const live = !canonical || new URL(canonical.href).host === location.host;
  window.goatcounter = { no_onload: !live };
  // A page as events name it: its path without .html, an index as its folder, the landing as "landing"
  const name = (url) => url.pathname.slice(root.length).replace(/(^|\/)index\.html$/, "").replace(/\.html$|\/$/, "") || "landing";

  const sent = new Set(), waiting = []; // an event counts once per page view, and waits for the service's script
  function flush() {
    while (goatcounter.count && waiting.length) goatcounter.count({ path: waiting.shift(), event: true });
  }
  const track = window.track = (path) => {
    if (!live || sent.has(path)) return;
    sent.add(path);
    waiting.push(path);
    flush();
  };
  const page = track.page = name(new URL(canonical ? canonical.href : location.href));
  document.querySelector("script[data-goatcounter]").addEventListener("load", flush);

  // Scroll depth: the share of the page's height that has been in view, on pages at least two screens high
  const marks = [25, 50, 75, 100];
  let throttled;
  addEventListener("scroll", () => throttled ||= setTimeout(() => {
    throttled = 0;
    const height = document.documentElement.scrollHeight;
    if (height < 2 * innerHeight) return;
    while (marks.length && (scrollY + innerHeight + 1) / height * 100 >= marks[0]) track(`scroll/${page}/${marks.shift()}`);
  }, 200), { passive: true });

  // The landing's parts (about, photos, cv, writing): seen once half of one is in view
  const parts = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      parts.unobserve(target);
      track(`seen/${page}/${target.matches(".about") ? "about" : target.querySelector("h2").textContent.toLowerCase()}`);
    }
  }, { threshold: 0.5 });
  document.querySelectorAll(".home .about, .home .sections > *").forEach((part) => parts.observe(part));

  // Links: click/<where>/<what>, and download/<file> for a PDF. <what> is "email", "pdf-<name>", another site's
  // host or an own page's name; a link within the page (a gallery's thumbnails and arrows) is not counted.
  const AREAS = { header: ".site-header, .side", hero: ".hero, .about", card: ".sections", post: ".post", footer: ".site-footer" };
  function clicked(event) {
    const a = event.button < 2 && event.target.closest("a[href]"); // auxclick: the middle button opens a new tab
    if (!a || a.getAttribute("href").startsWith("#")) return;
    const url = new URL(a.href), file = url.pathname.split("/").pop();
    const what = url.protocol === "mailto:" ? "email" : file.endsWith(".pdf") ? "pdf-" + file.slice(0, -4)
      : url.host !== location.host ? url.host.replace(/^www\./, "") : name(url);
    track(`click/${Object.keys(AREAS).find((area) => a.closest(AREAS[area])) ?? "page"}/${what}`);
    if (file.endsWith(".pdf")) track(`download/${file}`);
  }
  addEventListener("click", clicked);
  addEventListener("auxclick", clicked);
})();
