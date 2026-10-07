import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { classes, getClassChecklistLabel } from './src/data/classes.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = resolve(process.env.CADERNO_DATA_DIR || join(root, 'local-data'));
const filesDir = join(dataDir, 'files');
const distDir = join(root, 'dist');
const port = Number(process.env.PORT || 8787);
const maxUpload = 1024 * 1024 * 1024;
mkdirSync(filesDir, { recursive: true });
if (!existsSync(join(distDir, 'index.html'))) {
  console.error('A pasta dist não existe. Gere os arquivos do site antes de iniciar o servidor.');
  process.exit(1);
}

const db = new DatabaseSync(join(dataDir, 'caderno.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, disk_name TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL);
`);
const emptyState = { users: [], submissions: {}, regionalReviews: {}, adminReviews: {}, messages: {} };
const getState = db.prepare('SELECT value FROM app_state WHERE id=1');
const setState = db.prepare('INSERT INTO app_state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
const hasEvidence = db.prepare('SELECT 1 FROM evidence WHERE id=?');
const addEvidence = db.prepare('INSERT INTO evidence(id,disk_name,name,type,size,owner_id,created_at) VALUES(?,?,?,?,?,?,?)');
const getEvidence = db.prepare('SELECT * FROM evidence WHERE id=?');
const delEvidence = db.prepare('DELETE FROM evidence WHERE id=?');
const listEvidence = db.prepare('SELECT * FROM evidence');
const sessions = new Map();
const attempts = new Map();
const COOKIE = 'caderno_session';
const SESSION_MS = 24 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), 210000, 32, 'sha256').toString('hex')}`;
}
function matchesPassword(password, value) {
  if (!value || !value.includes(':')) return false;
  const [salt, expectedHex] = value.split(':');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), 210000, 32, 'sha256');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function publicState(state) {
  return { ...state, users: (state.users || []).map(({ passwordHash, ...user }) => user) };
}
if (!getState.get()) {
  const seed = { ...emptyState, users: [{ id: 'director-1', username: 'diretor', role: 'DIRECTOR', name: 'Diretor do Clube', birth: '', club: 'Clube Manancial', unit: '', passwordHash: hashPassword(process.env.CADERNO_INITIAL_PASSWORD || '1234') }] };
  setState.run(JSON.stringify(seed));
}
function state() { return JSON.parse(getState.get().value); }
function send(res, status, value, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(value === null ? '' : JSON.stringify(value));
}
function fail(res, status, error) { send(res, status, { error }); }
function escHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
async function writeDownloadChunk(res, chunk) {
  if (res.destroyed) throw new Error('A conexão do download foi encerrada.');
  if (!res.write(chunk)) {
    await new Promise((resolveDrain, rejectDrain) => {
      const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); };
      const onDrain = () => { cleanup(); resolveDrain(); };
      const onClose = () => { cleanup(); rejectDrain(new Error('A conexão do download foi encerrada.')); };
      res.once('drain', onDrain);
      res.once('close', onClose);
    });
  }
}
async function writeFileAsBase64(res, filePath) {
  let remainder = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    const bytes = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
    const completeLength = bytes.length - (bytes.length % 3);
    if (completeLength) await writeDownloadChunk(res, bytes.subarray(0, completeLength).toString('base64'));
    remainder = bytes.subarray(completeLength);
  }
  if (remainder.length) await writeDownloadChunk(res, remainder.toString('base64'));
}
function checklistSvg(submissions) {
  const cards = classes.map((classData) => {
    const requirements = classData.requirements.flatMap(([section, items]) => items.map((item) => ({ ...item, section })));
    const completed = requirements.filter((item) => ['adminApproved', 'regionalApproved'].includes(submissions[`${classData.slug}:${item.id}`]?.status)).length;
    return { classData, requirements, completed, percent: requirements.length ? Math.round(completed / requirements.length * 100) : 0, rows: Math.ceil(requirements.length / 10) };
  });
  let nextY = 86;
  const rowYs = [];
  for (let index = 0; index < cards.length; index += 2) {
    rowYs.push(nextY);
    nextY += Math.max(cards[index].rows, cards[index + 1]?.rows || 0) * 22 + 107;
  }
  const cardMarkup = cards.map((card, index) => {
    const x = 20 + (index % 2) * 490;
    const y = rowYs[Math.floor(index / 2)];
    const checks = card.requirements.map((item, itemIndex) => {
      const done = ['adminApproved', 'regionalApproved'].includes(submissions[`${card.classData.slug}:${item.id}`]?.status);
      const cx = x + 20 + (itemIndex % 10) * 43;
      const cy = y + 86 + Math.floor(itemIndex / 10) * 22;
      const mark = done ? `<rect x="${cx}" y="${cy}" width="14" height="14" rx="3" fill="${escHtml(card.classData.color)}"/><path d="M${cx + 3} ${cy + 7}l3 3 5-6" fill="none" stroke="#fff" stroke-width="1.8"/>` : `<rect x="${cx}" y="${cy}" width="14" height="14" rx="3" fill="#fff" stroke="#aab6c2"/>`;
      return `${mark}<text x="${cx + 18}" y="${cy + 11}" class="item-label">${escHtml(item.sectionCode)}-${escHtml(item.number)}</text>`;
    }).join('');
    const height = Math.max(95 + card.rows * 22, 95 + (cards[index + (index % 2 === 0 ? 1 : -1)]?.rows || 0) * 22);
    return `<g><rect x="${x}" y="${y}" width="470" height="${height}" rx="16" fill="#fff" stroke="${escHtml(card.classData.color)}" stroke-width="3"/><rect x="${x}" y="${y}" width="470" height="46" rx="14" fill="${escHtml(card.classData.color)}"/><text x="${x + 18}" y="${y + 30}" class="class-name">${escHtml(getClassChecklistLabel(card.classData))}</text><text x="${x + 452}" y="${y + 29}" class="count" text-anchor="end">${card.completed}/${card.requirements.length}</text><text x="${x + 20}" y="${y + 64}" class="percent">${card.percent}% aprovado pela diretoria</text><rect x="${x + 20}" y="${y + 70}" width="430" height="6" rx="3" fill="#e7edf3"/><rect x="${x + 20}" y="${y + 70}" width="${430 * card.percent / 100}" height="6" rx="3" fill="${escHtml(card.classData.color)}"/>${checks}</g>`;
  }).join('');
  const height = rowYs[2] + Math.max(95 + cards[4].rows * 22, 95 + cards[5].rows * 22) + 46;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}"><style>text{font-family:Arial,Helvetica,sans-serif;fill:#243342}.class-name{font-size:20px;font-weight:700;fill:#fff}.count{font-size:18px;font-weight:700;fill:#fff}.percent{font-size:13px;fill:#53677a}.item-label{font-size:10px;fill:#405367}</style><rect width="100%" height="100%" fill="#f4f6f8"/><text x="20" y="36" style="font-size:24px;font-weight:700;fill:#173f73">Progresso das classes</text><text x="20" y="57" style="font-size:13px;fill:#617386">Itens marcados foram aprovados pela diretoria.</text>${cardMarkup}</svg>`;
}
async function streamNotebook(req, res, user) {
  if (user.role !== 'DESBRAVADOR') return fail(res, 403, 'Somente o acesso do desbravador pode gerar este caderno.');
  const current = state();
  const scout = current.users.find((candidate) => candidate.id === user.id);
  if (!scout) return fail(res, 404, 'O acesso do desbravador não foi encontrado.');
  const submissions = {};
  for (const classData of classes) {
    for (const [, items] of classData.requirements) {
      for (const item of items) {
        const submission = current.submissions?.[`${user.id}:${classData.slug}:${item.id}`];
        if (submission && ['adminApproved', 'regionalApproved'].includes(submission.status)) submissions[`${classData.slug}:${item.id}`] = submission;
      }
    }
  }
  const filePaths = new Map();
  for (const submission of Object.values(submissions)) {
    for (const file of submission.files || []) {
      const evidence = getEvidence.get(file.id);
      if (!evidence || evidence.owner_id !== user.id) return fail(res, 404, 'Um anexo aprovado não foi encontrado no computador.');
      const filePath = join(filesDir, evidence.disk_name);
      try { statSync(filePath); } catch { return fail(res, 404, 'Um anexo aprovado não foi encontrado no computador.'); }
      filePaths.set(file.id, { filePath, type: evidence.type, name: evidence.name });
    }
  }

  const slug = String(scout.name || 'desbravador').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'desbravador';
  const filename = `caderno-${slug}.html`;
  const disposition = `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': disposition, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const write = (value) => writeDownloadChunk(res, value);
  const svgData = Buffer.from(checklistSvg(submissions)).toString('base64');
  const styles = 'body{font-family:Arial,sans-serif;background:#f4f6f8;color:#243342;margin:0}.wrap{max-width:1000px;margin:auto;background:#fff;min-height:100vh}.cover{padding:42px 44px;text-align:center;background:linear-gradient(135deg,#eef5fb,#fff);border-bottom:1px solid #dbe4ec}.cover h1{font-size:38px;margin:5px 0 18px}.cover p{color:#667;margin:4px 0}.identity{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;text-align:left;max-width:650px;margin:20px auto 0}.identity div{padding:8px;border:1px solid #e1e8ef;border-radius:10px}.checklist-overview{padding:18px 24px;page-break-before:always;page-break-after:always}.checklist-overview h2{margin:0 0 9px;color:#173f73;font-size:25px}.checklist-overview img{display:block;width:100%;height:auto;max-height:980px;object-fit:contain}.class{padding:24px 40px;page-break-before:always}.class-title{padding:14px;border-radius:16px;background:#eaf2f8}.class-title span,.class-title small{display:block;color:#607487}.class-title strong{font-size:28px;display:block;margin:2px 0 3px}.class section{margin-top:17px}.class section>h2{font-size:20px;border-bottom:2px solid #dce5ed;padding-bottom:5px;margin:0 0 6px}.req{display:grid;grid-template-columns:42px 1fr;gap:11px;padding:13px 0;border-bottom:1px solid #e5ebf0}.num{font-weight:700;font-size:18px;background:#eef3f7;border-radius:10px;width:42px;height:42px;display:grid;place-items:center}.rid{font-size:12px;color:#758797;text-transform:uppercase}.req h3{margin:3px 0 7px}.meta{font-size:13px;color:#5f7384;margin:6px 0}.answer{background:#fafbfd;border:1px solid #e1e8ef;border-radius:10px;padding:9px}.answer p{margin:5px 0}.photo{display:block;max-width:100%;max-height:650px;margin:6px 0;border-radius:10px}.video{display:block;width:100%;max-height:650px;margin:6px 0;border-radius:10px;background:#000}.youtube-preview{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:640px;aspect-ratio:16/9;margin:8px 0;overflow:hidden;border-radius:10px;background:#111;color:#fff;text-decoration:none}.youtube-preview img{width:100%;height:100%;object-fit:cover;opacity:.78}.youtube-preview>span{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);padding:8px 22px;border-radius:12px;background:#f00;color:#fff;font-size:24px}.youtube-preview>strong{position:absolute;bottom:0;left:0;right:0;padding:12px;background:linear-gradient(transparent,#000c);text-align:center}.pdf{display:block;padding:9px;background:#f2f6f9;border-radius:8px;margin:5px 0;color:#245b82;text-decoration:none}.empty{text-align:center;color:#778896;padding:18px}@media print{body{background:#fff}.wrap{max-width:none}.checklist-overview{padding:8mm 6mm}.checklist-overview img{max-height:260mm}.class{padding:18px 28px}}@media(max-width:600px){.cover{padding:30px 16px}.checklist-overview{padding:14px 10px}.class{padding:18px 14px}}';
  await write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Caderno de ${escHtml(scout.name)}</title><style>${styles}</style></head><body><div class="wrap"><header class="cover"><div>CLUBE DE DESBRAVADORES</div><h1>CADERNO DE CLASSES</h1><p>Caderno digital individual</p><div class="identity"><div><b>Nome:</b><br>${escHtml(scout.name)}</div><div><b>Nascimento:</b><br>${escHtml(scout.birth || '—')}</div><div><b>Clube:</b><br>${escHtml(scout.club || '—')}</div><div><b>Unidade:</b><br>${escHtml(scout.unit || '—')}</div></div></header><section class="checklist-overview"><h2>Checklist das classes</h2><img src="data:image/svg+xml;base64,${svgData}" alt="Imagem estática do progresso dos requisitos nas seis classes"></section>`);

  for (const classData of classes) {
    await write(`<div class="class"><div class="class-title"><span>Classe de</span><strong>${escHtml(classData.name)}</strong><small>${escHtml(classData.advancedName || '')}</small></div>`);
    let hasItems = false;
    for (const [sectionName, items] of classData.requirements) {
      const approvedItems = items.map((item) => ({ item, submission: submissions[`${classData.slug}:${item.id}`] })).filter(({ submission }) => submission);
      if (!approvedItems.length) continue;
      hasItems = true;
      await write(`<section><h2>${escHtml(sectionName)}</h2>`);
      for (const { item, submission } of approvedItems) {
        await write(`<article class="req"><div class="num">${escHtml(item.number)}</div><div><div class="rid">${escHtml(item.sectionCode)} · requisito ${escHtml(item.number)}</div><h3>${escHtml(item.text)}</h3>${item.sub?.length ? `<ul>${item.sub.map((text) => `<li>${escHtml(text)}</li>`).join('')}</ul>` : ''}<div class="meta">📅 ${escHtml(submission.date || '—')} · ✓ ${submission.status === 'regionalApproved' ? 'Confirmado pelo regional' : 'Aprovado pela liderança'}</div>${submission.text ? `<div class="answer"><b>Resposta / relatório</b><p>${escHtml(submission.text).replace(/\n/g, '<br>')}</p></div>` : ''}<div class="media">`);
        for (const file of submission.files || []) {
          const evidence = filePaths.get(file.id);
          const mime = escHtml(evidence.type || file.type || 'application/octet-stream');
          const name = escHtml(evidence.name || file.name);
          if (mime.startsWith('image/')) {
            await write(`<img class="photo" loading="lazy" src="data:${mime};base64,`);
            await writeFileAsBase64(res, evidence.filePath);
            await write(`" alt="${name}">`);
          } else if (mime.startsWith('video/')) {
            await write(`<video class="video" controls preload="none" src="data:${mime};base64,`);
            await writeFileAsBase64(res, evidence.filePath);
            await write(`"></video>`);
          } else {
            const label = mime === 'application/pdf' ? '📄 Abrir PDF: ' : '📎 ';
            await write(`<a class="pdf" href="data:${mime};base64,`);
            await writeFileAsBase64(res, evidence.filePath);
            await write(`" download="${name}">${label}${name}</a>`);
          }
        }
        if (submission.youtube) {
          const match = String(submission.youtube).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/i);
          if (match) await write(`<div class="youtube"><a class="youtube-preview" href="https://www.youtube.com/watch?v=${match[1]}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg" alt="Miniatura do vídeo no YouTube"><span aria-hidden="true">▶</span><strong>Assistir vídeo no YouTube</strong></a></div>`);
        }
        await write('</div></div></article>');
      }
      await write('</section>');
    }
    if (!hasItems) await write('<p class="empty">Nenhum requisito confirmado para esta classe.</p>');
    await write('</div>');
  }
  await write('</div></body></html>');
  res.end();
}
async function jsonBody(req, limit = 8 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('O arquivo enviado excede o limite permitido.'), { status: 413 }); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter(([key]) => key)); }
function userFor(req) {
  const id = cookies(req)[COOKIE]; const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) { if (id) sessions.delete(id); return null; }
  const user = state().users.find((candidate) => candidate.id === session.userId);
  return user ? { user, expiresAt: session.expiresAt } : null;
}
function requireUser(req, res) {
  const session = userFor(req);
  if (!session) { fail(res, 401, 'Entre novamente para continuar.'); return null; }
  return session;
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function safeKey(raw) {
  const key = decodeURIComponent(raw);
  if (!key || key.length > 1000 || key.includes('\0') || key.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return key;
}
function fileNameFromHeader(value) {
  try { return decodeURIComponent(value || 'arquivo').replace(/[\\/\0]/g, '_').slice(0, 240) || 'arquivo'; }
  catch { return 'arquivo'; }
}
function replaceAllowed(current, incoming, allowed, predicate = () => true) {
  const next = { ...current };
  for (const key of new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})])) {
    if (!predicate(key)) continue;
    if (Object.hasOwn(incoming || {}, key)) next[key] = incoming[key]; else delete next[key];
  }
  return next;
}
function saveByRole(actor, incoming) {
  const current = state();
  if (!incoming || typeof incoming !== 'object' || !incoming.submissions) throw new Error('Dados inválidos.');
  let next = { ...current };
  if (actor.role === 'DIRECTOR') {
    const passwords = new Map(current.users.map((user) => [user.id, user.passwordHash]));
    next = { ...emptyState, ...incoming, users: (incoming.users || []).map((user) => ({ ...user, passwordHash: passwords.get(user.id) })).filter((user) => user.passwordHash) };
  } else if (actor.role === 'ADMIN') {
    next.submissions = replaceAllowed(current.submissions, incoming.submissions, true);
    next.adminReviews = replaceAllowed(current.adminReviews, incoming.adminReviews, true);
    next.messages = replaceAllowed(current.messages, incoming.messages, true);
  } else if (actor.role === 'REGIONAL') {
    next.regionalReviews = replaceAllowed(current.regionalReviews, incoming.regionalReviews, true);
  } else if (actor.role === 'DESBRAVADOR') {
    const prefix = `${actor.id}:`;
    next.submissions = replaceAllowed(current.submissions, incoming.submissions, true, (key) => key.startsWith(prefix));
    next.messages = replaceAllowed(current.messages, incoming.messages, true, (key) => key.startsWith(prefix));
  } else throw new Error('Perfil sem permissão para salvar.');
  setState.run(JSON.stringify(next));
}
function mimeFor(path) {
  const ext = extname(path).toLowerCase();
  return ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.ico':'image/x-icon' })[ext] || 'application/octet-stream';
}
async function staticFile(pathname, res) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return fail(res, 400, 'Endereço inválido.'); }
  const relative = normalize(decoded.replace(/^\/+/, ''));
  let target = resolve(distDir, relative || 'index.html');
  if (target !== distDir && !target.startsWith(distDir + sep)) return fail(res, 403, 'Acesso negado.');
  try { await readFile(target); } catch { target = join(distDir, 'index.html'); }
  res.writeHead(200, { 'Content-Type': mimeFor(target), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  createReadStream(target).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  if (path.startsWith('/api/') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && !originAllowed(req)) return fail(res, 403, 'Origem não autorizada.');
  try {
    if (path === '/api/status' && req.method === 'GET') return send(res, 200, { sharedDatabase: true });
    if (path === '/api/migration/status' && req.method === 'GET') {
      const session = requireUser(req, res); if (!session) return;
      if (session.user.role !== 'DIRECTOR') return fail(res, 403, 'Somente o Diretor pode importar a cópia.');
      const current = state(); const pristine = current.users.length === 1 && current.users[0].id === 'director-1' && current.users[0].username === 'diretor' && Object.keys(current.submissions || {}).length === 0 && Object.keys(current.adminReviews || {}).length === 0 && Object.keys(current.regionalReviews || {}).length === 0 && Object.keys(current.messages || {}).length === 0 && listEvidence.all().length === 0;
      return send(res, 200, { ready: pristine });
    }
    if (path === '/api/migration/import' && req.method === 'POST') {
      const session = requireUser(req, res); if (!session) return;
      if (session.user.role !== 'DIRECTOR') return fail(res, 403, 'Somente o Diretor pode importar a cópia.');
      const current = state(); const pristine = current.users.length === 1 && current.users[0].id === 'director-1' && current.users[0].username === 'diretor' && Object.keys(current.submissions || {}).length === 0 && Object.keys(current.adminReviews || {}).length === 0 && Object.keys(current.regionalReviews || {}).length === 0 && Object.keys(current.messages || {}).length === 0 && listEvidence.all().length === 0;
      if (!pristine) return fail(res, 409, 'O servidor já tem dados. A importação só é permitida na primeira configuração.');
      const backup = await jsonBody(req, maxUpload + 16 * 1024 * 1024);
      if (backup.format !== 'caderno-desbravadores-backup-v1' || !Array.isArray(backup.files) || !Array.isArray(backup.state?.users) || !backup.state.users.some((user) => user.id === 'director-1' && user.role === 'DIRECTOR' && user.passwordHash)) return fail(res, 400, 'Arquivo de cópia incompatível ou sem acesso principal do Diretor.');
      let total = 0; const staged = [];
      try {
        for (const entry of backup.files) {
          const id = safeKey(encodeURIComponent(String(entry.id || ''))); const ownerId = String(entry.ownerId || '');
          if (!id || !id.startsWith(`${ownerId}/`) || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data || '')) throw new Error('Um arquivo da cópia está inválido.');
          const bytes = Buffer.from(entry.data, 'base64'); total += bytes.length;
          if (total > maxUpload) throw new Error('A cópia tem mais de 1 GB em arquivos.');
          const diskName = randomUUID(); const diskPath = join(filesDir, `${diskName}.part`); await writeFile(diskPath, bytes); staged.push({ id, diskName, diskPath, bytes, entry, ownerId });
        }
        const imported = { ...emptyState, ...backup.state };
        if (!imported.users.every((user) => user.passwordHash && user.id && user.role)) throw new Error('A cópia contém um usuário sem credenciais válidas.');
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const item of staged) {
            await rename(item.diskPath, join(filesDir, item.diskName));
            addEvidence.run(item.id, item.diskName, fileNameFromHeader(encodeURIComponent(item.entry.name || 'arquivo')), String(item.entry.type || 'application/octet-stream').slice(0, 160), item.bytes.length, item.ownerId, item.entry.createdAt || new Date().toISOString());
          }
          setState.run(JSON.stringify(imported)); db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { ok: true, users: imported.users.length, files: staged.length });
      } catch (error) {
        for (const item of staged) { await unlink(item.diskPath).catch(() => {}); await unlink(join(filesDir, item.diskName)).catch(() => {}); }
        throw error;
      }
    }
    if (path === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown'; const recent = (attempts.get(ip) || []).filter((time) => time > Date.now() - 60000);
      if (recent.length >= 10) return fail(res, 429, 'Muitas tentativas. Aguarde um minuto.');
      const body = await jsonBody(req, 16 * 1024);
      const account = state().users.find((user) => user.username.toLowerCase() === String(body.username || '').trim().toLowerCase());
      if (!account || !matchesPassword(body.password, account.passwordHash)) { recent.push(Date.now()); attempts.set(ip, recent); return fail(res, 401, 'Usuário ou senha inválidos.'); }
      attempts.delete(ip);
      const id = randomBytes(32).toString('hex'); const expiresAt = Date.now() + SESSION_MS;
      sessions.set(id, { userId: account.id, expiresAt });
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { db: publicState(state()), expiresAt }, { 'Set-Cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure}` });
    }
    if (path === '/api/session' && req.method === 'GET') {
      const session = userFor(req);
      return session ? send(res, 200, { user: publicState({ users: [session.user] }).users[0], db: publicState(state()), expiresAt: session.expiresAt }) : fail(res, 401, 'Sessão não encontrada.');
    }
    if (path === '/api/logout' && req.method === 'POST') {
      const id = cookies(req)[COOKIE]; if (id) sessions.delete(id);
      return send(res, 204, null, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    if (path === '/api/state' && req.method === 'GET') {
      if (!requireUser(req, res)) return;
      return send(res, 200, { db: publicState(state()) });
    }
    if (path === '/api/notebook' && req.method === 'GET') {
      const session = requireUser(req, res); if (!session) return;
      return await streamNotebook(req, res, session.user);
    }
    if (path === '/api/state' && req.method === 'PUT') {
      const session = requireUser(req, res); if (!session) return;
      saveByRole(session.user, await jsonBody(req)); return send(res, 200, { ok: true });
    }
    if (path === '/api/users' && req.method === 'POST') {
      const session = requireUser(req, res); if (!session) return;
      if (session.user.role !== 'DIRECTOR') return fail(res, 403, 'Somente o Diretor pode gerenciar acessos.');
      const { action, payload = {} } = await jsonBody(req, 64 * 1024); const current = state();
      const normalizeUsername = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
      if (action === 'create') {
        const username = normalizeUsername(payload.username); if (!username || !payload.password) return fail(res, 400, 'Informe usuário e senha.');
        if (current.users.some((item) => normalizeUsername(item.username) === username)) return fail(res, 409, 'Este nome de usuário já está cadastrado.');
        const user = { id: randomUUID(), username, role: payload.role, name: payload.name, birth: payload.birth || '', club: payload.club || '', unit: payload.unit || '', passwordHash: hashPassword(payload.password) };
        setState.run(JSON.stringify({ ...current, users: [...current.users, user] }));
      } else {
        const target = current.users.find((item) => item.id === payload.userId); if (!target) return fail(res, 404, 'O acesso não foi encontrado.');
        if (action === 'delete') {
          if (target.id === 'director-1') return fail(res, 400, 'O acesso principal do Diretor não pode ser excluído.');
          const prefix = `${target.id}:`; const submissions = Object.fromEntries(Object.entries(current.submissions || {}).filter(([key]) => !key.startsWith(prefix))); const messages = Object.fromEntries(Object.entries(current.messages || {}).filter(([key]) => !key.startsWith(prefix)));
          for (const file of listEvidence.all()) if (file.owner_id === target.id) { await unlink(join(filesDir, file.disk_name)).catch(() => {}); delEvidence.run(file.id); }
          setState.run(JSON.stringify({ ...current, users: current.users.filter((item) => item.id !== target.id), submissions, messages }));
        } else if (action === 'update') {
          const username = normalizeUsername(payload.username ?? target.username);
          if (!username || current.users.some((item) => item.id !== target.id && normalizeUsername(item.username) === username)) return fail(res, 409, 'Nome de usuário inválido ou já usado.');
          const updated = { ...target, username, name: payload.name ?? target.name, role: payload.role ?? target.role, birth: payload.birth ?? target.birth, club: payload.club ?? target.club, unit: payload.unit ?? target.unit, passwordHash: payload.password ? hashPassword(payload.password) : target.passwordHash };
          setState.run(JSON.stringify({ ...current, users: current.users.map((item) => item.id === target.id ? updated : item) }));
        } else return fail(res, 400, 'Ação de acesso não reconhecida.');
      }
      return send(res, 200, { ok: true });
    }
    if (path.startsWith('/api/evidence/')) {
      const session = requireUser(req, res); if (!session) return;
      const id = safeKey(path.slice('/api/evidence/'.length)); if (!id) return fail(res, 400, 'Identificador de arquivo inválido.');
      const existing = getEvidence.get(id);
      if (req.method === 'PUT') {
        const [ownerId] = id.split('/');
        if (session.user.role === 'DESBRAVADOR' && ownerId !== session.user.id) return fail(res, 403, 'Você só pode enviar arquivos para sua própria conta.');
        if (existing) return fail(res, 409, 'Arquivo já existe.');
        const diskName = randomUUID(); const temp = join(filesDir, `${diskName}.part`); const final = join(filesDir, diskName);
        let size = 0; req.on('data', (chunk) => { size += chunk.length; if (size > maxUpload) req.destroy(Object.assign(new Error('Arquivo maior que 1 GB.'), { status: 413 })); });
        try { await pipeline(req, createWriteStream(temp, { flags: 'wx' })); }
        catch (error) { await unlink(temp).catch(() => {}); throw error; }
        if (size > maxUpload) { await unlink(temp).catch(() => {}); return fail(res, 413, 'Arquivo maior que 1 GB.'); }
        await rename(temp, final);
        const name = fileNameFromHeader(req.headers['x-file-name']); const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 160); const createdAt = new Date().toISOString();
        addEvidence.run(id, diskName, name, type, size, ownerId, createdAt);
        return send(res, 200, { file: { id, path: id, name, type, size, createdAt } });
      }
      if (req.method === 'GET') {
        if (!existing) return fail(res, 404, 'Arquivo não encontrado.');
        if (session.user.role === 'DESBRAVADOR' && existing.owner_id !== session.user.id) return fail(res, 403, 'Este arquivo pertence a outro usuário.');
        const filePath = join(filesDir, existing.disk_name); const size = statSync(filePath).size; const range = req.headers.range;
        const headers = { 'Content-Type': existing.type, 'Content-Length': size, 'Content-Disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(existing.name), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range); if (!match) return res.writeHead(416).end();
          const start = Number(match[1] || 0); const end = Math.min(Number(match[2] || size - 1), size - 1); if (start > end || start >= size) return res.writeHead(416).end();
          res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` }); return createReadStream(filePath, { start, end }).pipe(res);
        }
        res.writeHead(200, headers); return createReadStream(filePath).pipe(res);
      }
      if (req.method === 'DELETE') {
        if (!existing) return send(res, 204, null);
        if (session.user.role === 'DESBRAVADOR' && existing.owner_id !== session.user.id) return fail(res, 403, 'Você só pode excluir arquivos da sua própria conta.');
        await unlink(join(filesDir, existing.disk_name)).catch(() => {}); delEvidence.run(id); return send(res, 204, null);
      }
    }
    if (req.method === 'GET' || req.method === 'HEAD') return staticFile(path, res);
    return fail(res, 404, 'Endereço não encontrado.');
  } catch (error) {
    console.error('Falha na solicitação:', error);
    if (!res.headersSent) fail(res, error.status || 500, error.status ? error.message : 'Erro interno ao processar a solicitação.');
    else res.destroy();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Caderno compartilhado ativo na porta ${port}. Dados: ${dataDir}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); });
