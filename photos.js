// Photo gallery enhancements (docs/PHOTO-VIEWER.md). Without JS the page already works: the strip
// scrolls and snaps, thumbnails and arrows are #anchor links. This adds the current-thumbnail marker,
// hash sync, ←/→ keys, preloading, the phone filmstrip and view mode (Fullscreen API, else the .viewing
// overlay).
(() => {
  const root = document.documentElement;
  const stage = document.querySelector(".stage");
  const strip = stage.querySelector(".strip");
  const slides = [...strip.querySelectorAll(".slide")];
  const imgs = slides.map((s) => s.querySelector("img"));
  const film = document.querySelector(".thumbs"); // thumbnail i shows slide i
  const thumbs = [...film.querySelectorAll("a")];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const phone = matchMedia(stage.dataset.phone); // the phone layout's media query (templates.PHONE)
  // Delays in ms
  const INTENT = 100; // a pointer on a thumbnail or arrow, or a thumbnail under the filmstrip's centre slot: its photo loads
  const DWELL = 250; // a thumbnail resting this long under the centre slot: its photo takes the stage
  const PASSING = 150; // a photo that is current this long is more than passed on the way: it loads
  const SETTLED = 200; // no scroll event for this long: the strip (or the filmstrip, without scrollend) has stopped
  const IDLE = 500; // view mode: no pointer movement for this long hides the controls
  const RETRY = 500; // a failed image is tried again after this, then after twice as long each time
  let current = -1, target = 0; // the photo on the stage, and where the strip is heading

  const indexOf = (id) => slides.findIndex((s) => s.id === id);
  const near = (i) => imgs.slice(Math.max(0, i - 1), i + 2); // the photo and its neighbours
  const viewing = () => root.classList.contains("viewing");
  const motion = () => (reduceMotion.matches ? "instant" : "smooth");
  // Smooth jumps come from here, not CSS scroll-behavior, which would also animate a #deep link on load.
  function go(i, behavior = motion()) {
    target = Math.max(0, Math.min(i, slides.length - 1));
    strip.scrollTo({ left: target * strip.clientWidth, behavior });
  }

  function mark(i) {
    thumbs.forEach((a, j) => (j === i ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
  }

  function select(i) {
    if (i === current || !slides[i]) return;
    centre(i, current < 0 ? "instant" : motion());
    current = i;
    mark(i);
    arrows(i);
    clearTimeout(warmTimer);
    if (i === target) warm(); else warmTimer = setTimeout(warm, PASSING);
    if (viewing()) { upgrade(); poke(); }
  }

  function arrows(i) { // only the current photo's arrows are tabbable, and a focused arrow follows the photo
    const focused = document.activeElement.closest(".arrow");
    slides.forEach((s, j) => s.querySelectorAll(".arrow").forEach((a) => (a.tabIndex = j === i ? 0 : -1)));
    if (focused && !slides[i].contains(focused)) {
      (slides[i].querySelector(focused.matches(".next") ? ".next" : ".prev") || strip).focus({ preventScroll: true });
    }
  }

  function settle() { // scrolling has stopped: record the photo in the URL (replaceState: Back leaves the gallery)
    target = current;
    history.replaceState(null, "", "#" + slides[current].id);
  }

  // --- loading: the current photo first, then both neighbours, then the rest of the folder nearest first,
  // one at a time so background loads never compete with the photo on screen. A photo the user reaches for
  // (hover, filmstrip dwell) loads at once. Slides are loading="lazy" only for the no-JS page.
  // Until a photo is in, its slide shows the thumbnail (style.css), gently pulsing.
  // The browser's own lazy loading (for the no-JS page) would start photos several slides away the moment
  // they come near, in parallel with the one asked for. So every photo but the first to show and its neighbours
  // waits with its srcset/src parked in data-* until the queue below reaches it (unpark).
  let warming = 0; // bumped on every new current photo, which stops the previous queue
  let warmTimer; // a photo only passed on the way (a glide, a trackpad fling) is not loaded
  const start = Math.max(0, indexOf(decodeURIComponent(location.hash.slice(1))));
  imgs.forEach((img, j) => {
    img.dataset.sizes = img.sizes; // view mode changes sizes; exit() restores it
    if (Math.abs(j - start) < 2 || img.complete) return;
    img.dataset.srcset = img.getAttribute("srcset");
    img.dataset.src = img.getAttribute("src");
    img.removeAttribute("srcset");
    img.removeAttribute("src");
  });
  function unpark(img) {
    if (img.dataset.src === undefined) return;
    img.srcset = img.dataset.srcset; // srcset first: the browser picks from it, not from src
    img.src = img.dataset.src;
    delete img.dataset.srcset;
    delete img.dataset.src;
  }
  for (const img of imgs) {
    if (img.complete && img.dataset.src === undefined) continue;
    img.parentNode.classList.add("loading");
    img.onload = img.onerror = () => img.parentNode.classList.remove("loading");
  }
  // A photo or thumbnail that fails (a refused connection, a file mid-rebuild) is retried after 0.5, 1, 2 and
  // 4 s instead of staying blank for good: browsers never retry a failed <img> on their own.
  function retry(img, n = 0) {
    const again = () => {
      if (n >= 4) return;
      setTimeout(() => {
        const bust = (urls) => urls.replace(/\.webp(\?retry=\d+)?/g, `.webp?retry=${n + 1}`); // not the failed cache entry
        if (img.srcset) img.srcset = bust(img.srcset);
        img.src = bust(img.src);
        retry(img, n + 1);
      }, RETRY * 2 ** n);
    };
    if (img.complete && img.src && !img.naturalWidth) again(); // failed before this script ran
    else img.addEventListener("error", again, { once: true });
  }
  document.querySelectorAll(".thumbs img, .slide img").forEach((img) => retry(img));
  function fetchNow(img, urgent) { // resolves once the photo is decoded, ready to paint in one go
    unpark(img);
    img.loading = "eager";
    if (urgent) img.fetchPriority = "high";
    return img.decode().catch(() => {});
  }
  async function warm() {
    const run = ++warming, i = current;
    await fetchNow(imgs[i], true);
    if (run !== warming) return; // moved on meanwhile: the new photo's queue takes over
    await Promise.all(near(i).map((img) => fetchNow(img)));
    if (navigator.connection && navigator.connection.saveData) return; // Data Saver: no background loading
    const rest = imgs.map((img, j) => [Math.abs(j - i), img]).filter(([d]) => d > 1).sort((a, b) => a[0] - b[0]);
    for (const [, img] of rest) {
      if (run !== warming) return;
      await fetchNow(img);
    }
  }
  // In view mode the photo fills the screen: let the browser pick a larger file (3072 px on big screens).
  const upgrade = () => near(current).forEach((img) => (img.sizes = `min(100vw, ${img.getAttribute("width") / img.getAttribute("height") * 100}vh)`));

  // --- phone filmstrip: the thumbnail in the centre slot is the photo on the stage ---
  // The stage leads: select() centres its thumbnail. A drag or fling of the filmstrip leads only once it
  // has settled, and only if it was the user's (a touch or wheel), so code-driven scrolls are never read back.
  let held = false, dragged = false, filmTimer; // finger on the filmstrip; its motion is the user's
  let dwelling = -1, dwellTimer; // the thumbnail under the centre slot during a drag, and its timer
  const middle = (li) => li.offsetLeft + li.offsetWidth / 2;

  function centre(i, behavior) {
    if (held || dragged || !phone.matches) return; // never pull the strip against the user; desktop has a grid
    film.scrollTo({ left: middle(film.children[i]) - film.clientWidth / 2, behavior });
  }

  function under() { // the thumbnail nearest the centre slot
    const mid = film.scrollLeft + film.clientWidth / 2;
    const gaps = [...film.children].map((li) => Math.abs(middle(li) - mid));
    return gaps.indexOf(Math.min(...gaps));
  }

  function filmSettled() { // jump, not scroll, so the photos passed on the way are not loaded
    clearTimeout(filmTimer);
    if (!dragged || held) return; // a finger resting on the strip: its dwell timer keeps running
    clearTimeout(dwellTimer);
    dwelling = -1;
    dragged = false;
    if (under() !== current) go(under(), "instant");
  }
  // Fallback where scrollend is missing (Safari): no scroll event for 0.2 s and no finger down.
  const filmWait = () => { clearTimeout(filmTimer); filmTimer = setTimeout(filmSettled, SETTLED); };

  film.addEventListener("touchstart", () => (held = true), { passive: true });
  for (const type of ["touchend", "touchcancel"]) {
    film.addEventListener(type, () => { held = false; if (dragged) filmWait(); }, { passive: true });
  }
  // A wheel that scrolls nothing (vertical, or at an end) must still settle, or centre() would stay blocked.
  film.addEventListener("wheel", () => { dragged = true; filmWait(); }, { passive: true });
  film.addEventListener("scroll", () => {
    if (held) dragged = true;
    if (!dragged) return;
    const i = under();
    mark(i); // live highlight while moving
    if (i !== dwelling) { // a thumbnail resting under the centre slot: its photo loads from 0.1 s, takes the stage at 0.25 s
      dwelling = i;
      clearTimeout(dwellTimer);
      dwellTimer = setTimeout(() => {
        fetchNow(imgs[i], true);
        dwellTimer = setTimeout(() => dragged && i !== current && go(i, "instant"), DWELL - INTENT);
      }, INTENT);
    }
    filmWait();
  }, { passive: true });
  film.addEventListener("scrollend", filmSettled);

  // --- view mode ---
  let idleTimer;
  function poke() { // show the view-mode controls, hide them again after 0.5 s without movement
    root.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add("idle"), IDLE);
  }

  function setViewing(on) {
    const flip = () => root.classList.toggle("viewing", on);
    if (document.fullscreenEnabled || reduceMotion.matches || !document.startViewTransition) flip();
    else document.startViewTransition(flip); // overlay only: a short cross-fade
  }

  function enter() {
    if (viewing()) return;
    upgrade();
    setViewing(true);
    poke();
    if (document.fullscreenEnabled) stage.requestFullscreen().catch(() => {}); // on failure the overlay stays
  }

  function exit() {
    if (document.fullscreenElement) return document.exitFullscreen(); // fullscreenchange calls exit again
    if (!viewing()) return;
    setViewing(false);
    clearTimeout(idleTimer);
    root.classList.remove("idle");
    imgs.forEach((img) => (img.sizes = img.dataset.sizes)); // back to the browse-mode sizes
    quietFocus(); // focus back where it was
  }

  // Swipe up or down in view mode goes back to browse mode; sideways swipes stay with the strip.
  let touchStart = null;
  stage.addEventListener("touchstart", (event) => {
    const t = event.touches[0];
    touchStart = viewing() && event.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  stage.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const t = event.changedTouches[0], dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dy) > 60 && Math.abs(dy) > 2 * Math.abs(dx)) exit();
  }, { passive: true });

  document.addEventListener("fullscreenchange", () => document.fullscreenElement || exit());
  stage.addEventListener("pointermove", () => viewing() && poke());

  let settleTimer;
  strip.addEventListener("scroll", () => {
    select(Math.round(strip.scrollLeft / strip.clientWidth));
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLED); // also keeps replaceState below Safari's rate limit
  }, { passive: true });

  // --- intent: a pointer resting 0.1 s on a thumbnail or arrow loads its photo; on another folder, that folder's
  // page and first photo. Pressing a folder link does the same at once, ahead of the navigation.
  const prefetched = new Map(); // folder page → the Image warming its first photo, held so the load is not collected
  function intent(a) {
    const i = a.matches(".thumbs a, .arrow") ? indexOf(a.hash.slice(1)) : -1;
    if (i >= 0) return fetchNow(imgs[i], true);
    if (!a.closest(".folders") || a.hasAttribute("aria-current") || prefetched.has(a.href)) return;
    prefetched.set(a.href, null);
    fetch(a.href).then((r) => r.text()).then((html) => {
      const first = new DOMParser().parseFromString(html, "text/html").querySelector(".slide img");
      const img = new Image(); // that page's srcset and sizes (same directory), so its <img> finds it cached
      img.sizes = first.getAttribute("sizes");
      img.srcset = first.getAttribute("srcset");
      prefetched.set(a.href, img);
    }).catch(() => {});
  }
  let hovered, hoverTimer, pressed; // pressed: the link under the last pointerdown (null once a key is used)
  document.addEventListener("pointerover", (event) => {
    const a = event.pointerType === "touch" ? null : event.target.closest("a");
    if (a === hovered) return;
    hovered = a;
    clearTimeout(hoverTimer);
    if (a) hoverTimer = setTimeout(() => intent(a), INTENT);
  });
  document.addEventListener("pointerdown", (event) => {
    pressed = event.target.closest("a");
    const a = event.target.closest(".folders a");
    if (a) intent(a);
  });

  // Keep the photo (and its thumbnail) in place when the stage changes size (view mode, rotation, window
  // resize), also mid-jump: the instant scroll replaces a smooth one whose pixel target is now wrong.
  let width = 0;
  new ResizeObserver(() => {
    if (strip.clientWidth === width) return;
    width = strip.clientWidth;
    go(target, "instant");
    centre(target, "instant");
  }).observe(strip);

  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    const i = link ? indexOf(link.hash.slice(1)) : -1;
    if (i >= 0) { // thumbnails and arrows: scroll, no history entry
      event.preventDefault();
      // A thumbnail more than one photo away (any on the phone filmstrip) makes the stage jump: gliding past
      // the photos in between would load each of them first. The filmstrip still glides.
      const jump = film.contains(link) && (phone.matches || Math.abs(i - current) > 1);
      go(i, jump ? "instant" : undefined);
      if (pressed === link) quietFocus(); // a click or tap; after Enter the focus stays on the link
    } else if (event.target.closest(".exit")) exit();
    else if (!link && strip.contains(event.target)) viewing() ? exit() : event.target.matches("img") && enter();
  });

  addEventListener("keydown", (event) => {
    pressed = null;
    if (event.altKey || event.ctrlKey || event.metaKey) return; // the page has no text inputs
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step) { event.preventDefault(); go(target + step); } // target: repeated presses queue up
    else if (event.key.toLowerCase() === "f" || (event.key === "Enter" && event.target === strip)) {
      viewing() ? exit() : enter();
    } else if (event.key === "Escape") exit();
  });

  // Focus the strip got from a click or tap (or from leaving view mode) draws no ring when arrow keys follow;
  // focus from Tab keeps it (style.css). Chromium and Safari would otherwise frame the whole stage, or the
  // arrow band or thumbnail that was clicked, at the first key press.
  function quietFocus() {
    strip.classList.add("pointer-focus");
    strip.focus({ preventScroll: true });
  }
  strip.addEventListener("pointerdown", () => strip.classList.add("pointer-focus"));
  strip.addEventListener("blur", () => strip.classList.remove("pointer-focus"));
  // Touch: the arrow hint (style.css) plays once; without this, leaving view mode would restart it.
  stage.addEventListener("animationend", (event) => event.animationName === "hint" && root.classList.add("hinted"));

  go(start, "instant");
  select(start);
})();
