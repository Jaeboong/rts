import { generateExportSnippet } from './export';
import { buildForm, collectOverrides } from './form';
import { clearOverrides, loadOverrides, saveOverrides } from './storage';

function makeButton(label: string, className?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  if (className) btn.className = className;
  return btn;
}

function buildButtonRow(): {
  row: HTMLDivElement;
  apply: HTMLButtonElement;
  reset: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
} {
  const row = document.createElement('div');
  row.className = 'btnrow';
  const apply = makeButton('Apply & Reload Game');
  const reset = makeButton('Reset (Clear Overrides)', 'danger');
  const exportBtn = makeButton('Export Snippet');
  row.appendChild(apply);
  row.appendChild(reset);
  row.appendChild(exportBtn);
  return { row, apply, reset, exportBtn };
}

function buildExportModal(): {
  bg: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  copy: HTMLButtonElement;
  close: HTMLButtonElement;
} {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const textarea = document.createElement('textarea');
  textarea.readOnly = true;
  modal.appendChild(textarea);
  const copyRow = document.createElement('div');
  copyRow.className = 'btnrow';
  const copy = makeButton('Copy to Clipboard');
  const close = makeButton('Close');
  copyRow.appendChild(copy);
  copyRow.appendChild(close);
  modal.appendChild(copyRow);
  bg.appendChild(modal);
  return { bg, textarea, copy, close };
}

export function mountAdmin(root: HTMLElement): void {
  root.replaceChildren();
  const overrides = loadOverrides();
  const form = buildForm(overrides);
  root.appendChild(form);

  const { row, apply, reset, exportBtn } = buildButtonRow();
  root.appendChild(row);

  const modal = buildExportModal();
  document.body.appendChild(modal.bg);

  apply.addEventListener('click', () => {
    const collected = collectOverrides(root);
    saveOverrides(collected);
    // Redirect back to main game so the override applies on next startup.
    window.location.href = '/';
  });

  reset.addEventListener('click', () => {
    clearOverrides();
    window.location.href = '/';
  });

  exportBtn.addEventListener('click', () => {
    const collected = collectOverrides(root);
    modal.textarea.value = generateExportSnippet(collected);
    modal.bg.classList.add('open');
    modal.textarea.select();
  });

  modal.copy.addEventListener('click', () => {
    const text = modal.textarea.value;
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      clip.writeText(text).catch(() => {
        modal.textarea.select();
        document.execCommand('copy');
      });
    } else {
      modal.textarea.select();
      document.execCommand('copy');
    }
  });

  modal.close.addEventListener('click', () => {
    modal.bg.classList.remove('open');
  });

  modal.bg.addEventListener('click', (ev) => {
    if (ev.target === modal.bg) modal.bg.classList.remove('open');
  });
}

const root = document.getElementById('admin-root');
if (root) mountAdmin(root);
