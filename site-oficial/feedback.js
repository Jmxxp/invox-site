(() => {
  "use strict";
  const form = document.getElementById("feedback-form");
  if (!form) return;
  const name = document.getElementById("feedback-name");
  const contact = document.getElementById("feedback-contact");
  const message = document.getElementById("feedback-message");
  const button = document.getElementById("feedback-submit");
  const status = document.getElementById("feedback-status");
  const count = document.getElementById("feedback-count");
  if (!name || !contact || !message || !button || !status) return;

  const rules = [
    [name, 2, "Informe seu nome com pelo menos 2 caracteres."],
    [contact, 3, "Informe um e-mail ou WhatsApp para contato."],
    [message, 10, "Descreva seu feedback com pelo menos 10 caracteres."],
  ];
  function updateCount() {
    if (count) count.textContent = `${message.value.length} / 2000`;
  }
  rules.forEach(([field]) => field.addEventListener("input", () => {
    field.setCustomValidity("");
    status.textContent = "";
    updateCount();
  }));
  form.addEventListener("submit", event => {
    event.preventDefault();
    rules.forEach(([field, minimum, error]) => {
      field.value = field.value.trim();
      field.setCustomValidity(field.value.length < minimum ? error : "");
    });
    updateCount();
    if (!form.reportValidity()) return;
    status.textContent = "Feedback preparado. O envio ainda não está disponível; nenhuma mensagem foi enviada.";
    status.focus({ preventScroll: true });
  });
  button.disabled = false;
  updateCount();
})();
