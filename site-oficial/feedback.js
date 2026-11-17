(() => {
  "use strict";
  const form = document.getElementById("feedback-form");
  if (!form) return;
  const name = document.getElementById("feedback-name");
  const kind = document.getElementById("feedback-kind");
  const message = document.getElementById("feedback-message");
  const button = document.getElementById("feedback-submit");
  const status = document.getElementById("feedback-status");
  const count = document.getElementById("feedback-count");
  const website = document.getElementById('feedback-website');
  let submitting = false;
  if (!name || !kind || !message || !button || !status) return;

  const rules = [
    [name, 2, 80, "Informe seu nome com pelo menos 2 caracteres."],
    [message, 10, 2000, "Descreva seu feedback com pelo menos 10 caracteres."],
  ];
  function updateCount() {
    if (count) count.textContent = `${Array.from(message.value).length} / 2000`;
  }
  rules.forEach(([field]) => field.addEventListener("input", () => {
    field.setCustomValidity("");
    status.textContent = "";
    updateCount();
  }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting) return;
    rules.forEach(([field, minimum, maximum, error]) => {
      field.value = field.value.trim();
      const length = Array.from(field.value).length;
      field.setCustomValidity(length < minimum ? error : length > maximum ? `Use no máximo ${maximum} caracteres.` : "");
    });
    updateCount();
    if (!form.reportValidity()) return;
    if (!['feedback', 'suggestion'].includes(kind.value)) return;
    const payload = { name: name.value, message: message.value, kind: kind.value, source: 'site', website: website?.value || '' };
    submitting = true;
    button.disabled = true;
    button.textContent = 'ENVIANDO MENSAGEM...';
    form.setAttribute('aria-busy', 'true');
    [name, kind, message, website].filter(Boolean).forEach(field => { field.disabled = true; });
    status.dataset.tone = 'normal';
    status.textContent = 'Enviando seu feedback...';
    try {
      if (!window.InvoxBackend) throw Object.assign(new Error(), { code: 'offline' });
      const result = await window.InvoxBackend.sendFeedback(payload);
      if (!result?.id) throw new Error('No feedback receipt');
      form.reset();
      updateCount();
      status.dataset.tone = 'success';
      status.textContent = (payload.kind === 'suggestion' ? 'Sugestão enviada!' : 'Feedback enviado!') + ' Obrigado por ajudar a construir o INVOX.';
    } catch (error) {
      status.dataset.tone = 'error';
      status.textContent = error?.code === 'rate_limited'
        ? 'Você enviou vários feedbacks em pouco tempo. Aguarde alguns minutos e tente novamente.'
        : 'Não foi possível enviar seu feedback. Seu texto continua aqui; tente novamente em instantes.';
    } finally {
      submitting = false;
      [name, kind, message, website].filter(Boolean).forEach(field => { field.disabled = false; });
      button.disabled = false;
      button.textContent = 'ENVIAR MENSAGEM';
      form.setAttribute('aria-busy', 'false');
      status.focus({ preventScroll: true });
    }
  });
  button.disabled = false;
  updateCount();
})();
