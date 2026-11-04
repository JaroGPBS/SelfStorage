// Shared, accessible confirmation modal for irreversible PL actions.
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const dialog = el('plActionConfirmDialog');
  const cancel = el('plActionConfirmCancel');
  const approve = el('plActionConfirmApprove');
  let pending = null;

  function settle(accepted) {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    if (dialog.open) dialog.close();
    resolve(accepted);
  }

  cancel.addEventListener('click', () => settle(false));
  approve.addEventListener('click', () => settle(true));
  // Escape and other native dialog closures never approve.
  dialog.addEventListener('close', () => settle(false));
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    settle(false);
  });

  function ask({title, message, approveLabel = 'Potwierdź'} = {}) {
    if (pending || dialog.open) return Promise.resolve(false);
    el('plActionConfirmTitle').textContent = String(title || 'Czy na pewno?');
    el('plActionConfirmMessage').textContent = String(message || '');
    approve.textContent = String(approveLabel);
    return new Promise(resolve => {
      pending = resolve;
      try {
        dialog.showModal();
        cancel.focus({preventScroll: true});
      } catch {
        settle(false);
      }
    });
  }

  window.GPBSPlConfirm = {ask};
})();
