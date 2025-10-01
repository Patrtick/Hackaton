// index.js
// Backend: загрузка файла и серверный парсинг terraform JSONL / tf logs
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const app = express();
app.use(cors());
app.use(express.json());

// Timestamp regexes
const tsRegexes = [
  /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})?)\b/, // ISO
  /\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\b/,
  /\b(\d{2}\/\d{2}\/\d{4}[ T]\d{2}:\d{2}:\d{2})\b/
];

function extractTimestamp(text) {
  if (!text) return null;
  for (const r of tsRegexes) {
    const m = text.match(r);
    if (m) {
      const s = m[1];
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString();
      return s;
    }
  }
  return null;
}

function determineLevel(text) {
  if (!text) return 'normal';
  const low = text.toLowerCase();
  if (/\bpanic\b|\bfatal\b|\berror\b|exception|failed/i.test(text)) return 'error';
  if (/\bwarn(ing)?\b/.test(low)) return 'warning';
  if (/\bdebug\b/.test(low)) return 'debug';
  if (/\btrace\b/.test(low)) return 'trace';
  if (/\binfo\b/.test(low)) return 'info';
  return 'normal';
}

// extract tf_http bodies or json substrings
function extractJsonFields(line) {
  const fields = {};
  const keyPattern = /(tf_http_(req|res)_body)\s*[:=]\s*(\{[\s\S]*\})/i;
  const m = line.match(keyPattern);
  if (m) {
    try {
      const parsed = JSON.parse(m[3]);
      fields[m[1]] = { collapsed: true, preview: JSON.stringify(parsed).slice(0, 200) + (JSON.stringify(parsed).length>200 ? '...':''), full: JSON.stringify(parsed, null, 2) };
    } catch(e) {
      fields[m[1]] = { collapsed: true, preview: m[3].slice(0,200) + '...', full: m[3] };
    }
  }
  const jsonMatch = line.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/);
  if (jsonMatch && Object.keys(fields).length === 0) {
    try {
      const p = JSON.parse(jsonMatch[0]);
      fields._json = { collapsed: true, preview: JSON.stringify(p).slice(0,200)+(JSON.stringify(p).length>200?'...':''), full: JSON.stringify(p, null, 2) };
    } catch(e){
      // ignore
    }
  }
  return fields;
}

function parseFileText(text) {
  const linesRaw = text.split(/\r?\n/);
  const parsedLines = [];
  const stats = { levels: {}, total: 0 };
  const sections = [];
  let currentSection = null;
  const errors = [];
  const groups = {}; // tf_req_id => [indices]
  const resourceCounts = {};
  const providerCounts = {};
  const timeline = {};
  const timelineErrors = {}; // timeline bucket => error count
  const timestampIndex = []; // list of timestamps for range queries

  for (let i = 0; i < linesRaw.length; i++) {
    const raw = linesRaw[i];
    if (raw === undefined || raw === null) continue;
    // keep even empty lines as possible separators but skip completely empty to reduce noise
    if (raw.trim() === '') continue;

    let obj = null;
    try { obj = JSON.parse(raw); } catch(e) { obj = null; }

    let textLine = raw;
    let timestamp = null;
    let level = null;
    let jsonFields = null;
    let tfReqId = null;
    let resourceType = null;

    if (obj && typeof obj === 'object') {
      // get message, timestamp, level
      textLine = obj['@message'] || obj.message || obj.msg || JSON.stringify(obj);
      timestamp = obj['@timestamp'] || extractTimestamp(JSON.stringify(obj)) || null;
      level = (obj['@level'] || obj.level || determineLevel(textLine)).toString().toLowerCase();
      jsonFields = {};
      if (obj.tf_http_req_body) {
        try {
          const p = typeof obj.tf_http_req_body === 'string' ? JSON.parse(obj.tf_http_req_body) : obj.tf_http_req_body;
          jsonFields['tf_http_req_body'] = { collapsed:true, preview: JSON.stringify(p).slice(0,200)+(JSON.stringify(p).length>200?'...':''), full: JSON.stringify(p,null,2) };
        } catch(e){
          jsonFields['tf_http_req_body'] = { collapsed:true, preview: String(obj.tf_http_req_body).slice(0,200), full: String(obj.tf_http_req_body) };
        }
      }
      if (obj.tf_http_res_body) {
        try {
          const p = typeof obj.tf_http_res_body === 'string' ? JSON.parse(obj.tf_http_res_body) : obj.tf_http_res_body;
          jsonFields['tf_http_res_body'] = { collapsed:true, preview: JSON.stringify(p).slice(0,200)+(JSON.stringify(p).length>200?'...':''), full: JSON.stringify(p,null,2) };
        } catch(e){
          jsonFields['tf_http_res_body'] = { collapsed:true, preview: String(obj.tf_http_res_body).slice(0,200), full: String(obj.tf_http_res_body) };
        }
      }
      if (obj.tf_req_id) tfReqId = String(obj.tf_req_id);
      if (obj.tf_resource_type) resourceType = String(obj.tf_resource_type);
      if (Object.keys(jsonFields).length === 0) jsonFields = null;
    } else {
      textLine = raw;
      timestamp = extractTimestamp(raw);
      level = determineLevel(raw);
      const extracted = extractJsonFields(raw);
      jsonFields = Object.keys(extracted).length ? extracted : null;
      // try to find tf_req_id or tf_resource_type in plain text
      const mreq = raw.match(/tf_req_id["']?\s*[:=]\s*["']?([A-Za-z0-9_\-:.]+)["']?/i);
      if (mreq) tfReqId = mreq[1];
      const mres = raw.match(/tf_resource_type["']?\s*[:=]\s*["']?([A-Za-z0-9_:\-\.]+)["']?/i);
      if (mres) resourceType = mres[1];
    }

    // detect plan/apply sections heuristics
    const tl = (textLine || '').toLowerCase();
    if (/an execution plan has been generated|terraform will perform the following actions|^#\s+resource/i.test(tl) || /planning to/i.test(tl) || /^plan: .* to add/i.test(tl)) {
      currentSection = { type: 'plan', start: i };
      sections.push(currentSection);
    }
    if (/applying the following plan|^running apply/i.test(tl) || /\bterraform apply\b/i.test(tl)) {
      currentSection = { type: 'apply', start: i };
      sections.push(currentSection);
    }
    if (/apply complete/i.test(tl) || /no changes. infrastructure is up-to-date/i.test(tl) || /^plan: .* to add, .* to change, .* to destroy/i.test(tl)) {
      if (currentSection) { currentSection.end = i; currentSection = null; }
    }

    const cls = (level === 'error' ? 'error' : level === 'warning' ? 'warning' : level === 'info' ? 'info' : (level === 'debug' ? 'debug' : 'normal'));

    const parsed = { text: textLine, raw, cls, level, timestamp, jsonFields, tf_req_id: tfReqId, tf_resource_type: resourceType };
    parsedLines.push(parsed);

    // stats
    stats.levels[cls] = (stats.levels[cls] || 0) + 1;
    stats.total++;

    // errors
    if (cls === 'error') {
      errors.push({ idx: parsedLines.length - 1, text: textLine, timestamp, raw });
    }

    // groups
    if (tfReqId) {
      groups[tfReqId] = groups[tfReqId] || [];
      groups[tfReqId].push(parsedLines.length - 1);
    }

    // resource/provider frequency
    const resourceRegex1 = /#\s*(?:module\.)?([^\s.]+)\.([^\s\[]+)/; // "# module.mod_name.resource_type"
    const resourceRegex2 = /resource\s+"([^"]+)"/i; // resource "aws_instance"
    const providerRegex = /provider\["?([^"\]]+)"?\]/i;
    let m1 = textLine.match(resourceRegex1);
    if (m1) {
      const r = m1[2];
      resourceCounts[r] = (resourceCounts[r] || 0) + 1;
    }
    let m2 = textLine.match(resourceRegex2);
    if (m2) {
      const r = m2[1];
      resourceCounts[r] = (resourceCounts[r] || 0) + 1;
    }
    let mp = textLine.match(providerRegex);
    if (mp) {
      const p = mp[1];
      providerCounts[p] = (providerCounts[p] || 0) + 1;
    }
    if (resourceType) {
      resourceCounts[resourceType] = (resourceCounts[resourceType] || 0) + 1;
    }

    // timeline buckets by minute for plotting
    if (timestamp) {
      const d = new Date(timestamp);
      if (!isNaN(d.getTime())) {
        d.setSeconds(0,0);
        const key = d.toISOString();
        timeline[key] = (timeline[key] || 0) + 1;
        timestampIndex.push({ idx: parsedLines.length - 1, ts: key });
        if (cls === 'error') {
          timelineErrors[key] = (timelineErrors[key] || 0) + 1;
        }
      }
    }
  }

  // finalize sections: annotate lines with section
  for (const sec of sections) {
    const start = sec.start || 0;
    const end = sec.end != null ? sec.end : parsedLines.length - 1;
    for (let j = start; j <= end; j++) {
      if (parsedLines[j]) parsedLines[j].section = sec.type;
    }
  }

  // plan summary: search for "Plan: X to add, Y to change, Z to destroy" in any line
  const planSummary = { adds: 0, changes: 0, destroys: 0, found: false };
  for (const pl of parsedLines) {
    const m = (pl.text || '').match(/Plan:\s*(\d+)\s*to add,\s*(\d+)\s*to change,\s*(\d+)\s*to destroy/i);
    if (m) {
      planSummary.adds = parseInt(m[1],10);
      planSummary.changes = parseInt(m[2],10);
      planSummary.destroys = parseInt(m[3],10);
      planSummary.found = true;
      break;
    }
  }

  return {
    lines: parsedLines,
    stats,
    errors,
    planSummary,
    resourceCounts,
    providerCounts,
    timeline,
    timelineErrors,
    groups,
    timestampIndex
  };
}

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok:false, error:'file required' });
  const text = req.file.buffer.toString('utf8');
  try {
    const parsed = parseFileText(text);
    res.json({ ok:true, parsed, raw: text });
  } catch (e) {
    console.error('parse error', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

// New API for programmatic integration: parse text directly
app.post('/api/parse', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const parsed = parseFileText(text);
    res.json({ ok: true, parsed });
  } catch (e) {
    console.error('parse error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// New API to get summary (stats, errors, planSummary)
app.post('/api/summary', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const parsed = parseFileText(text);
    const summary = {
      stats: parsed.stats,
      errors: parsed.errors,
      planSummary: parsed.planSummary,
      resourceCounts: parsed.resourceCounts,
      providerCounts: parsed.providerCounts,
      timeline: parsed.timeline,
      timelineErrors: parsed.timelineErrors
    };
    res.json({ ok: true, summary });
  } catch (e) {
    console.error('parse error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// New API to get errors only
app.post('/api/errors', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const parsed = parseFileText(text);
    res.json({ ok: true, errors: parsed.errors });
  } catch (e) {
    console.error('parse error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ ok:true }));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log('listening on', port));