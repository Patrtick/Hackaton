const express = require('express');
const cors = require('cors');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});
const app = express();
app.use(cors());
app.use(express.json());

function parseTerraform(text) {
  try {
    // пробуем как JSONL (каждая строка отдельный JSON)
    const objects = text.trim().split(/\r?\n/).map(l => JSON.parse(l));
    const lines = [];
    const summary = { adds: 0, changes: 0, destroys: 0 };

    for (const obj of objects) {
      let cls = 'normal';
      const level = (obj['@level'] || '').toLowerCase();
      if (/(error|failed|panic)/.test(level)) cls = 'error';
      else if (level === 'warning') cls = 'warning';
      else if (level === 'info') cls = 'info';
      else if (level === 'debug') cls = 'debug';
      else if (level === 'trace') cls = 'trace';

      lines.push({ text: obj['@message'] || JSON.stringify(obj), cls });
    }
    return { lines, summary };
  } catch (e) {
    // fallback: обычный текстовый парсер
    return parseTerraformText(text);
  }
}

function parseTerraformText(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const summary = { adds: 0, changes: 0, destroys: 0 };

  for (let line of lines) {
    let cls = 'normal';
    if (/\berror\b|failed|panic|traceback/i.test(line)) cls = 'error';
    else if (/warning/i.test(line)) cls = 'warning';
    else if (/apply complete/i.test(line)) cls = 'success';
    else if (/created:/i.test(line) || /created\./i.test(line)) cls = 'created';
    else if (/destroyed:/i.test(line) || /destroyed\./i.test(line)) cls = 'destroyed';

    const planMatch = line.match(/Plan:\s*(\d+)\s*to add,\s*(\d+)\s*to change,\s*(\d+)\s*to destroy/i);
    if (planMatch) {
      summary.adds = parseInt(planMatch[1], 10);
      summary.changes = parseInt(planMatch[2], 10);
      summary.destroys = parseInt(planMatch[3], 10);
      cls = 'plan';
    }

    out.push({ text: line, cls });
  }

  return { lines: out, summary };
}

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'file required' });
  const text = req.file.buffer.toString('utf8');
  const parsed = parseTerraform(text);
  res.json({ ok: true, parsed, raw: text });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log('backend listening on', port));
