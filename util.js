/* ============================================================
   Shared by every tool page.

   Only things that were genuinely identical in several places live
   here. A helper that differs between pages stays with its page —
   pulling those together produces a function with three flags and no
   clear owner, which is worse than the repetition it removed.
   ============================================================ */

const $ = (id) => document.getElementById(id);

/* ---------- status lines ---------- */
function say(el, message, kind) {
  if (!el) return;
  el.textContent = message;
  el.className = 'status' + (kind ? ' status-' + kind : '');
}

/* Buttons remember their resting label in data-label, set once at
   startup, so a busy state can put it back without the caller
   holding on to it. */
function busy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = isBusy ? label : button.dataset.label;
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    /* The scheme is noise in a confirmation, and stripping it does
       nothing to a hex code. */
    say(statusEl, '✓ Copied ' + String(text).replace(/^https?:\/\//, ''), 'ok');
    return true;
  } catch {
    /* Refused without a user gesture, or over plain http. Showing the
       value at least leaves it selectable. */
    say(statusEl, text, null);
    return false;
  }
}

/* ---------- colour ---------- */
const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/* Perceived brightness, for deciding whether text over a colour should
   be dark or light. Takes either [r,g,b] or '#rrggbb', since callers
   have one or the other and converting at each site was how two
   versions of this ended up disagreeing. */
function isLight(colour) {
  let r;
  let g;
  let b;
  if (Array.isArray(colour)) {
    [r, g, b] = colour;
  } else {
    const h = String(colour).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  }
  return (r * 299 + g * 587 + b * 114) / 1000 > 145;
}

/* ---------- files ---------- */
function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* Strip anything that would be awkward in a filename, and never
   return an empty one. */
function safeName(value, fallback) {
  return (
    String(value || '')
      .trim()
      .replace(/[^\w\- ]+/g, '')
      .replace(/\s+/g, '-') || fallback
  );
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/* Makes a label behave as a drop target as well as a picker. The
   dragover handler must preventDefault or the browser opens the file
   instead of handing it over. */
function wireDropZone(el, onFile) {
  ['dragenter', 'dragover'].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      el.classList.add('is-over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      el.classList.remove('is-over');
    })
  );
  el.addEventListener('drop', (e) => onFile(e.dataTransfer.files[0]));
}
