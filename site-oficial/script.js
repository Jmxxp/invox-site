(() => {
  "use strict";

  const config = window.INVOX_CONFIG || {};
  const dialogTriggers = new WeakMap();
  const header = document.querySelector(".site-header");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const platformNames = {
    windows: "Windows",
    macos: "macOS",
    android: "Android",
  };
  const socialNames = { discord: "Discord", youtube: "YouTube", x: "X" };

  function openDialog(dialog, trigger) {
    if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
    dialogTriggers.set(dialog, trigger || document.activeElement);
    dialog.showModal();
  }

  function showNotice(title, copy, trigger) {
    const dialog = document.getElementById("notice-dialog");
    const titleElement = document.getElementById("notice-title");
    const copyElement = document.getElementById("notice-copy");
    if (!dialog || !titleElement || !copyElement) return;
    titleElement.textContent = title;
    copyElement.textContent = copy;
    openDialog(dialog, trigger);
  }

  function officialUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  document.querySelectorAll("[data-download], [data-social]").forEach((link) => {
    const isDownload = link.hasAttribute("data-download");
    const key = isDownload ? link.dataset.download : link.dataset.social;
    const values = isDownload ? config.downloads : config.social;
    const url = officialUrl(values?.[key]);

    if (url) {
      link.href = url;
      link.rel = "noopener noreferrer";
      if (!isDownload) link.target = "_blank";
      return;
    }

    link.href = "#";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const name = (isDownload ? platformNames : socialNames)[key] || "INVOX";
      showNotice(
        isDownload ? `${name}: download` : `INVOX no ${name}`,
        isDownload
          ? `O link oficial de download para ${name} ainda não está disponível nesta página.`
          : `O link oficial do INVOX no ${name} ainda não está disponível nesta página.`,
        link,
      );
    });
  });

  document.querySelectorAll("[data-open-dialog]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      openDialog(document.getElementById(trigger.dataset.openDialog), trigger);
    });
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.querySelectorAll("[data-close-dialog]").forEach((closeButton) => {
      closeButton.addEventListener("click", () => dialog.close());
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) dialog.close();
    });
    dialog.addEventListener("close", () => {
      const trigger = dialogTriggers.get(dialog);
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        const focusTarget = trigger.getClientRects().length > 0 ? trigger : menuToggle;
        focusTarget?.focus({ preventScroll: true });
      }
      dialogTriggers.delete(dialog);
    });
  });

  function closeMenu() {
    header?.classList.remove("is-menu-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Abrir menu");
    menuToggle?.querySelector("i")?.classList.replace("fa-xmark", "fa-bars");
  }

  menuToggle?.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(expanded));
    menuToggle.setAttribute("aria-label", expanded ? "Fechar menu" : "Abrir menu");
    const menuIcon = menuToggle.querySelector("i");
    menuIcon?.classList.toggle("fa-bars", !expanded);
    menuIcon?.classList.toggle("fa-xmark", expanded);
    header?.classList.toggle("is-menu-open", expanded);
  });

  header?.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("nav a, nav button")) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && header?.classList.contains("is-menu-open")) {
      closeMenu();
      menuToggle?.focus({ preventScroll: true });
    }
  });
})();
