import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

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
