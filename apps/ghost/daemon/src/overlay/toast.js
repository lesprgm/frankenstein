const { ipcRenderer } = require('electron');

const toastEl = document.getElementById('toast');
const titleEl = document.getElementById('toast-title');
const bodyEl = document.getElementById('toast-body');
let hideTimer = null;
let currentKey = null;

function showToast({ title, body, duration }) {
  titleEl.textContent = title || 'Ghost';
  bodyEl.textContent = body || '';
  toastEl.classList.remove('hidden');

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toastEl.classList.add('hidden');
    currentKey = null;
  }, duration || 4000);
}

ipcRenderer.on('ghost/toast', (_event, payload) => {
  if (payload.key && payload.key === currentKey) {
    // Same toast – refresh timer but don't animate flicker
    showToast(payload);
    return;
  }
  currentKey = payload.key || null;
  showToast(payload);
});
