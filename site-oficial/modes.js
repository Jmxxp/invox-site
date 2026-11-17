(() => {
  "use strict";

  const videos = [...document.querySelectorAll(".game-mode-video")];
  if (!videos.length || typeof IntersectionObserver !== "function") return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const states = videos.map(video => ({
    video,
    figure: video.closest(".game-mode-visual"),
    visible: false,
    failed: false,
    requested: false,
    attempt: 0,
  })).filter(state => state.figure);
  const byFigure = new Map(states.map(state => [state.figure, state]));
  let pageActive = true;

  function canPlay(state) {
    return pageActive && state.visible && !state.failed && !document.hidden && !motion.matches;
  }

  function pause(state) {
    state.attempt += 1;
    state.requested = false;
    state.video.pause();
    state.figure.classList.remove("is-playing");
  }

  function sync(state) {
    if (!canPlay(state)) { pause(state); return; }
    if (state.requested && !state.video.paused) return;
    state.requested = true;
    const attempt = ++state.attempt;
    let playback;
    try { playback = state.video.play(); }
    catch { pause(state); return; }
    Promise.resolve(playback).then(() => {
      if (attempt !== state.attempt) return;
      if (!canPlay(state)) { pause(state); return; }
      if (!state.video.paused && state.video.readyState >= 2) state.figure.classList.add("is-playing");
    }).catch(() => {
      if (attempt !== state.attempt) return;
      pause(state);
    });
  }

  for (const state of states) {
    state.video.muted = true;
    state.video.defaultMuted = true;
    state.video.playsInline = true;
    state.video.preload = "none";
    state.video.addEventListener("playing", () => {
      if (state.requested && canPlay(state)) state.figure.classList.add("is-playing");
      else pause(state);
    });
    state.video.addEventListener("pause", () => state.figure.classList.remove("is-playing"));
    state.video.addEventListener("error", () => {
      state.failed = true;
      pause(state);
    });
  }

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = byFigure.get(entry.target);
      if (!state) continue;
      state.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      sync(state);
    }
  }, { threshold: [0, .08], rootMargin: "0px" });
  states.forEach(state => observer.observe(state.figure));

  const syncAll = () => states.forEach(sync);
  document.addEventListener("visibilitychange", syncAll);
  motion.addEventListener("change", syncAll);
  window.addEventListener("pagehide", () => { pageActive = false; states.forEach(pause); });
  window.addEventListener("pageshow", () => { pageActive = true; syncAll(); });
})();
