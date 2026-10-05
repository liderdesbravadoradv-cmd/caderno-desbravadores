const DATABASE_NAME = 'caderno-desbravadores-local';
const DATABASE_VERSION = 1;
const STATE_STORE = 'app-state';
const EVIDENCE_STORE = 'evidence-files';
const SESSION_KEY = 'caderno-desbravadores.local-session';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

const emptyState = () => ({
  users: [],
  submissions: {},
  regionalReviews: {},
  adminReviews: {},
  messages: {}
});

let databasePromise;

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Este navegador não oferece armazenamento local.'));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STATE_STORE)) {
          database.createObjectStore(STATE_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(EVIDENCE_STORE)) {
          database.createObjectStore(EVIDENCE_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Feche outras abas do Caderno e tente novamente.'));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readState() {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, 'readonly');
  const record = await requestResult(transaction.objectStore(STATE_STORE).get('main'));
  return record?.value || null;
}

async function writeState(state) {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, 'readwrite');
  transaction.objectStore(STATE_STORE).put({ id: 'main', value: state });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Não foi possível salvar os dados locais.'));
  });
}

async function ensureState() {
  const existing = await readState();
  if (existing) return existing;

  const passwordHash = await hashPassword('1234');
  const firstRun = {
    ...emptyState(),
    users: [{
      id: 'director-1',
      username: 'diretor',
      role: 'DIRECTOR',
      name: 'Diretor do Clube',
      birth: '',
      club: 'Clube Manancial',
      unit: '',
      passwordHash
    }]
  };

  await writeState(firstRun);
  return firstRun;
}

async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, key, 256);
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value) {
  return new Uint8Array(value.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
}

async function passwordMatches(password, savedHash) {
  if (!savedHash) return false;
  const [salt, expected] = savedHash.split(':');
  const actual = await hashPassword(password, salt);
  return actual.split(':')[1] === expected;
}

function publicState(state) {
  return {
    ...state,
    users: (state.users || []).map(({ passwordHash, ...user }) => user)
  };
}

function sessionData() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase().replace(/\s+/g, '');
}

export async function authenticateUser(username, password) {
  const state = await ensureState();
  const normalized = normalizeUsername(username);
  const user = state.users.find((item) => normalizeUsername(item.username) === normalized);

  if (!user || !(await passwordMatches(password, user.passwordHash))) {
    throw new Error('Usuário ou senha inválidos.');
  }

  const expiresAt = Date.now() + SESSION_DURATION_MS;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, expiresAt }));
  return publicState(state);
}

export async function restoreAuthenticatedUser() {
  const session = sessionData();
  if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  const state = await ensureState();
  const user = state.users.find((item) => item.id === session.userId);
  if (!user) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  return { db: publicState(state), user: publicState({ users: [user] }).users[0], expiresAt: session.expiresAt };
}

export function getSessionExpiresAt() {
  return Number(sessionData()?.expiresAt);
}

export async function signOutUser() {
  localStorage.removeItem(SESSION_KEY);
}

export async function loadDB() {
  return publicState(await ensureState());
}

export async function saveDB(db) {
  const current = await ensureState();
  const passwordById = new Map(current.users.map((user) => [user.id, user.passwordHash]));
  const nextUsers = (db.users || []).map((user) => ({
    ...user,
    passwordHash: passwordById.get(user.id)
  }));
  await writeState({ ...emptyState(), ...db, users: nextUsers });
}

async function currentUser() {
  const session = sessionData();
  if (!session || session.expiresAt <= Date.now()) throw new Error('Sessão expirada. Entre novamente.');
  const state = await ensureState();
  const user = state.users.find((item) => item.id === session.userId);
  if (!user) throw new Error('Sessão não encontrada.');
  return { state, user };
}

export async function manageUser(action, payload = {}) {
  const { state, user: actor } = await currentUser();
  if (actor.role !== 'DIRECTOR') throw new Error('Somente o Diretor pode gerenciar acessos.');

  const userId = payload.userId || null;
  const target = state.users.find((item) => item.id === userId);

  if (action === 'create') {
    const username = normalizeUsername(payload.username);
    if (!username || !payload.password) throw new Error('Informe usuário e senha.');
    if (state.users.some((item) => normalizeUsername(item.username) === username)) {
      throw new Error('Este nome de usuário já está cadastrado.');
    }

    const newUser = {
      id: crypto.randomUUID(),
      username,
      role: payload.role,
      name: payload.name,
      birth: payload.birth || '',
      club: payload.club || '',
      unit: payload.unit || '',
      passwordHash: await hashPassword(payload.password)
    };
    await writeState({ ...state, users: [...state.users, newUser] });
    return { ok: true };
  }

  if (!target) throw new Error('O acesso não foi encontrado.');

  if (action === 'update') {
    const username = normalizeUsername(payload.username ?? target.username);
    if (!username) throw new Error('Informe um nome de usuário.');
    if (state.users.some((item) => item.id !== target.id && normalizeUsername(item.username) === username)) {
      throw new Error('Este nome de usuário já está cadastrado.');
    }
    const updated = {
      ...target,
      username,
      name: payload.name ?? target.name,
      role: payload.role ?? target.role,
      birth: payload.birth ?? target.birth,
      club: payload.club ?? target.club,
      unit: payload.unit ?? target.unit,
      passwordHash: payload.password ? await hashPassword(payload.password) : target.passwordHash
    };
    await writeState({ ...state, users: state.users.map((item) => item.id === target.id ? updated : item) });
    return { ok: true };
  }

  if (action === 'delete') {
    if (target.id === 'director-1') throw new Error('O acesso principal do Diretor não pode ser excluído.');
    const prefix = `${target.id}:`;
    const submissions = Object.fromEntries(Object.entries(state.submissions || {}).filter(([key]) => !key.startsWith(prefix)));
    const messages = Object.fromEntries(Object.entries(state.messages || {}).filter(([key]) => !key.startsWith(prefix)));
    const files = (await listEvidenceFiles()).filter((file) => file.ownerId === target.id);
    await Promise.all(files.map((file) => deleteEvidenceFile(file.id)));
    await writeState({
      ...state,
      users: state.users.filter((item) => item.id !== target.id),
      submissions,
      messages
    });
    return { ok: true };
  }

  throw new Error('Ação de acesso não reconhecida.');
}

function safeName(name) {
  return String(name || 'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo';
}

async function listEvidenceFiles() {
  const database = await openDatabase();
  const transaction = database.transaction(EVIDENCE_STORE, 'readonly');
  return requestResult(transaction.objectStore(EVIDENCE_STORE).getAll());
}

export async function getEvidenceFile(id) {
  const database = await openDatabase();
  const transaction = database.transaction(EVIDENCE_STORE, 'readonly');
  const file = await requestResult(transaction.objectStore(EVIDENCE_STORE).get(String(id || '')));
  if (!file?.blob) throw new Error('O arquivo não foi encontrado neste dispositivo.');
  return { blob: file.blob };
}

export async function getEvidencePreviewUrl(id) {
  const { blob } = await getEvidenceFile(id);
  return URL.createObjectURL(blob);
}

export async function saveEvidenceFiles(files, key) {
  if (!files?.length) return [];
  const [ownerId, classSlug, itemId] = String(key).split(':');
  if (!ownerId || !classSlug || !itemId) throw new Error('Identificador do requisito inválido.');
  const database = await openDatabase();
  const saved = [];

  try {
    for (const file of files) {
      const id = `${ownerId}/${classSlug}/${itemId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const transaction = database.transaction(EVIDENCE_STORE, 'readwrite');
      transaction.objectStore(EVIDENCE_STORE).put({ id, ownerId, blob: file });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Não foi possível salvar o arquivo neste dispositivo.'));
      });
      saved.push({ id, path: id, name: file.name, type: file.type, size: file.size, createdAt: new Date().toISOString() });
    }
    return saved;
  } catch (error) {
    await Promise.allSettled(saved.map((file) => deleteEvidenceFile(file.id)));
    throw error;
  }
}

export async function deleteEvidenceFile(id) {
  const path = String(id || '').trim();
  if (!path) return;
  const database = await openDatabase();
  const transaction = database.transaction(EVIDENCE_STORE, 'readwrite');
  transaction.objectStore(EVIDENCE_STORE).delete(path);
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Não foi possível excluir o arquivo local.'));
  });
}
