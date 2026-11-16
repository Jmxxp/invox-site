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
  const website = document.getElementById('feedback-website');
  let submitting = false;
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
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting) return;
    rules.forEach(([field, minimum, error]) => {
      field.value = field.value.trim();
      field.setCustomValidity(field.value.length < minimum ? error : "");
    });
    updateCount();
    if (!form.reportValidity()) return;
    const payload = { name: name.value, contact: contact.value, message: message.value, website: website?.value || '' };
    submitting = true;
    button.disabled = true;
    button.textContent = 'ENVIANDO FEEDBACK...';
    form.setAttribute('aria-busy', 'true');
    [name, contact, message, website].filter(Boolean).forEach(field => { field.disabled = true; });
    status.dataset.tone = 'normal';
    status.textContent = 'Enviando seu feedback...';
    try {
      if (!window.InvoxBackend) throw Object.assign(new Error(), { code: 'offline' });
      const result = await window.InvoxBackend.sendFeedback(payload);
      if (!result?.id) throw new Error('No feedback receipt');
      form.reset();
      updateCount();
      status.dataset.tone = 'success';
      status.textContent = 'Feedback enviado! Obrigado por ajudar a construir o INVOX.';
    } catch (error) {
      status.dataset.tone = 'error';
      status.textContent = error?.code === 'rate_limited'
        ? 'Você enviou vários feedbacks em pouco tempo. Aguarde alguns minutos e tente novamente.'
        : 'Não foi possível enviar seu feedback. Seu texto continua aqui; tente novamente em instantes.';
    } finally {
      submitting = false;
      [name, contact, message, website].filter(Boolean).forEach(field => { field.disabled = false; });
      button.disabled = false;
      button.textContent = 'ENVIAR FEEDBACK';
      form.setAttribute('aria-busy', 'false');
      status.focus({ preventScroll: true });
    }
  });
  button.disabled = false;
  updateCount();
})();
