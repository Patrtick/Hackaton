const BACKEND_URL = 'http://localhost:5000'; // поменяй если backend на другом хосте/порту

const dropzone = document.getElementById('dropzone');
const input = document.getElementById('fileInput');
const status = document.getElementById('status');
const result = document.getElementById('result');

function setStatus(text) {
    status.innerHTML = text;
}

// НО: не вызываем input.click() при клике по label — иначе будет два диалога.
// Если клик пришёл "из" label (или внутри неё), позволяем browser открыть файл сам.
dropzone.addEventListener('click', (e) => {
    if (e.target.closest('label[for="fileInput"], .big-btn')) {
        // кликнули по метке — ничего не делаем, label откроет диалог
        return;
    }
    input.click();
});

input.addEventListener('change', () => {
    if (!input.files.length) return; // если файл не выбран — выходим
    uploadFile(input.files[0]);
});

// drag & drop
dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-hover');
});
dropzone.addEventListener('dragleave', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-hover');
});
dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-hover');
    const f = e.dataTransfer.files[0];
    if (f) uploadFile(f);
});

async function uploadFile(file) {
    setStatus(`Загружаю ${file.name}...`);

    const fd = new FormData();
    fd.append('file', file);

    try {
        const res = await fetch(BACKEND_URL + '/upload', { method: 'POST', body: fd });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || 'upload failed');

        renderParsed(j.parsed, j.raw);
        setStatus('Файл успешно загружен и обработан ✅');
    } catch (e) {
        setStatus('Ошибка: ' + e.message);
    } finally {
        // очищаем input чтобы повторно можно было выбрать тот же файл
        input.value = '';
    }
}

function renderParsed(parsed, raw) {
    result.innerHTML = '';

    const sum = parsed.summary || {};
    const summaryEl = document.createElement('div');
    summaryEl.className = 'summary';
    summaryEl.innerHTML = `
    <div class="chip">➕ add: ${sum.adds || 0}</div>
    <div class="chip">🔁 change: ${sum.changes || 0}</div>
    <div class="chip">🗑️ destroy: ${sum.destroys || 0}</div>
  `;
    result.appendChild(summaryEl);

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const btnRaw = document.createElement('div');
    btnRaw.className = 'button';
    btnRaw.innerText = 'Скачать raw';
    btnRaw.onclick = () => downloadText(raw || '', 'terraform.log');
    const btnJson = document.createElement('div');
    btnJson.className = 'button';
    btnJson.innerText = 'Копировать JSON';
    btnJson.onclick = () => navigator.clipboard.writeText(JSON.stringify(parsed, null, 2));
    buttons.appendChild(btnRaw);
    buttons.appendChild(btnJson);
    result.appendChild(buttons);

    for (const l of parsed.lines) {
        const el = document.createElement('div');
        el.className = 'line ' + (l.cls || 'normal');
        el.innerText = l.text || '';
        result.appendChild(el);
    }
}

function downloadText(text, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}
