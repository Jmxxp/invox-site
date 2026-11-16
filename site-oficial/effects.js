(() => {
  "use strict";
  const root = document.documentElement;
  const body = document.body;
  const chrome = document.querySelector(".site-chrome");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let scrollFrame = 0;
  motion.addEventListener("change", () => {
    if (motion.matches) resetPointerTargets();
  });
  const links = [...document.querySelectorAll("[data-section]")];
  const sections = links.map(link => ({
    key: link.dataset.section,
    element: link.dataset.section === "inicio" ? document.querySelector(".hero") : document.getElementById(link.dataset.section),
  })).filter(item => item.element);
  function updateScroll() {
    scrollFrame = 0;
    const headerHeight = chrome?.getBoundingClientRect().height || 78;
    chrome?.classList.toggle("is-scrolled", window.scrollY > 18);
    const total = Math.max(1, root.scrollHeight - window.innerHeight);
    root.style.setProperty("--scroll-progress", String(Math.max(0, Math.min(1, window.scrollY / total))));
    let selected = "inicio";
    let lastTop = -Infinity;
    for (const section of sections) {
      const top = section.element.getBoundingClientRect().top;
      if (top <= headerHeight + 100 && top > lastTop) {
        selected = section.key;
        lastTop = top;
      }
    }
    for (const link of links) {
      const active = link.dataset.section === selected;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
  function requestScrollUpdate() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  }
  window.addEventListener("scroll", requestScrollUpdate, { passive: true });
  window.addEventListener("resize", requestScrollUpdate, { passive: true });
  const revealItems = document.querySelectorAll(".game-intro, .game-pillars, .game-chapter, .game-early, .game-outro, .lobby-section, .feedback-section");
  if ("IntersectionObserver" in window) {
    revealItems.forEach(element => element.setAttribute("data-reveal", ""));
    root.classList.add("reveal-ready");
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -24px 0px" });
    revealItems.forEach(element => observer.observe(element));
  }

  // Follow the pointer locally, keeping layout reads outside the move loop.
  const pointerTargets = [...document.querySelectorAll(".download-card, .game-panel, .game-cta")]
    .map(element => ({ element, bounds: null, frame: 0, x: 0, y: 0 }));
  function resetPointer(state) {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.bounds = null;
    state.element.classList.remove("is-pointer-active");
    state.element.style.setProperty("--tilt-x", "0deg");
    state.element.style.setProperty("--tilt-y", "0deg");
    state.element.style.removeProperty("--pointer-x");
    state.element.style.removeProperty("--pointer-y");
  }
  function resetPointerTargets() { pointerTargets.forEach(resetPointer); }
  function canReact() { return finePointer.matches && !motion.matches; }
  function drawPointer(state) {
    state.frame = 0;
    if (!state.bounds || !canReact()) { resetPointer(state); return; }
    const x = Math.max(0, Math.min(1, (state.x - state.bounds.left) / Math.max(1, state.bounds.width)));
    const y = Math.max(0, Math.min(1, (state.y - state.bounds.top) / Math.max(1, state.bounds.height)));
    state.element.style.setProperty("--pointer-x", `${x * 100}%`);
    state.element.style.setProperty("--pointer-y", `${y * 100}%`);
    state.element.style.setProperty("--tilt-x", `${(0.5 - y) * 3}deg`);
    state.element.style.setProperty("--tilt-y", `${(x - 0.5) * 3}deg`);
  }
  for (const state of pointerTargets) {
    state.element.addEventListener("pointerenter", event => {
      if (!canReact() || event.pointerType === "touch") return;
      state.bounds = state.element.getBoundingClientRect();
      state.x = event.clientX;
      state.y = event.clientY;
      const x = Math.max(0, Math.min(1, (state.x - state.bounds.left) / Math.max(1, state.bounds.width)));
      const y = Math.max(0, Math.min(1, (state.y - state.bounds.top) / Math.max(1, state.bounds.height)));
      state.element.style.setProperty("--entry-x", `${x * 100}%`);
      state.element.style.setProperty("--entry-y", `${y * 100}%`);
      state.element.classList.add("is-pointer-active");
      drawPointer(state);
    }, { passive: true });
    state.element.addEventListener("pointermove", event => {
      if (!state.bounds || !canReact() || event.pointerType === "touch") return;
      state.x = event.clientX;
      state.y = event.clientY;
      if (!state.frame) state.frame = requestAnimationFrame(() => drawPointer(state));
    }, { passive: true });
    state.element.addEventListener("pointerleave", () => resetPointer(state), { passive: true });
    state.element.addEventListener("pointercancel", () => resetPointer(state), { passive: true });
  }
  finePointer.addEventListener("change", () => { if (!finePointer.matches) resetPointerTargets(); });
  window.addEventListener("blur", resetPointerTargets);
  window.addEventListener("resize", resetPointerTargets, { passive: true });
  body.classList.add("fx-enabled");
  body.classList.remove("fx-disabled");
  try { localStorage.removeItem("invox.visualEffects"); } catch {}
  updateScroll();
})();
