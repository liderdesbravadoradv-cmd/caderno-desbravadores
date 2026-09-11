import { supabase } from './supabase';

const SESSION_EXPIRES_AT_KEY = 'caderno-desbravadores.session-expires-at';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

const seed = {
  users: [],
  submissions: {},
  regionalReviews: {},
  adminReviews: {},
  messages: {}
};

// ✔ Padroniza username
const usernameEmail = (username) =>
  `${String(username || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')}@login.clube.local`;

const normalizeProfile = (row) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  name: row.name,
  birth: row.birth_date ? String(row.birth_date).split('-').reverse().join('/') : '',
  club: row.club || '',
  unit: row.unit || ''
});

export async function authenticateUser(username, password) {
  if (!supabase) throw new Error('Supabase não configurado.');

  const email = usernameEmail(username);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error || !data?.user) {
    throw new Error('Usuário ou senha inválidos.');
  }

  localStorage.setItem(
    SESSION_EXPIRES_AT_KEY,
    String(Date.now() + SESSION_DURATION_MS)
  );

  return loadDB();
}

export async function restoreAuthenticatedUser() {
  if (!supabase) return null;

  const expiresAt = Number(localStorage.getItem(SESSION_EXPIRES_AT_KEY));

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
    await supabase.auth.signOut();
    return null;
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.user) {
    localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
    return null;
  }

  let db;
  try {
    db = await loadDB();
  } catch (err) {
    console.error('Erro loadDB:', err);
    return null;
  }

  const user = db?.users?.find((item) => item.id === session.user.id);

  if (!user) {
    localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
    await supabase.auth.signOut();
    return null;
  }

  return { db, user, expiresAt };
}

export function getSessionExpiresAt() {
  return Number(localStorage.getItem(SESSION_EXPIRES_AT_KEY));
}

export async function signOutUser() {
  localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  if (supabase) await supabase.auth.signOut();
}

async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão não encontrada.');

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data;
}

async function getVisibleProfiles(current) {
  let query = supabase.from('profiles').select('*').order('name');
  if (current.role === 'DESBRAVADOR') query = query.eq('id', current.id);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getVisibleStates(current) {
  let query = supabase.from('club_state').select('profile_id,submissions,messages');
  if (current.role === 'DESBRAVADOR') query = query.eq('profile_id', current.id);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function loadDB() {
  if (!supabase) return structuredClone(seed);

  const current = await getCurrentProfile();

  const [profiles, states] = await Promise.all([
    getVisibleProfiles(current),
    getVisibleStates(current)
  ]);

  const submissions = {};
  const messages = {};

  for (const state of states) {
    Object.assign(submissions, state.submissions || {});
    Object.assign(messages, state.messages || {});
  }

  return {
    ...seed,
    users: profiles.map(normalizeProfile),
    submissions,
    messages
  };
}

export async function saveDB(db) {
  if (!supabase) return;

  const current = await getCurrentProfile();
  const profileIds = db.users.map((user) => user.id);

  for (const profileId of profileIds) {
    if (current.role === 'DESBRAVADOR' && profileId !== current.id) continue;

    const prefix = `${profileId}:`;

    const submissions = Object.fromEntries(
      Object.entries(db.submissions || {}).filter(([key]) => key.startsWith(prefix))
    );

    const messages = Object.fromEntries(
      Object.entries(db.messages || {}).filter(([key]) => key.startsWith(prefix))
    );

    const { error } = await supabase.from('club_state').upsert({
      profile_id: profileId,
      submissions,
      messages,
      updated_at: new Date().toISOString()
    });

    if (error) throw error;
  }
}

export async function manageUser(action, payload) {
  if (!supabase) throw new Error('Supabase não configurado.');

  const { data, error } = await supabase.functions.invoke('manage-user', {
    body: { action, ...payload }
  });

  if (error) throw new Error(error.message || 'Erro na função.');
  if (data?.error) throw new Error(data.error);

  return data;
}

const safeName = (name) =>
  String(name || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'arquivo';

export async function saveEvidenceFiles(files, key) {
  if (!files?.length) return [];
  if (!supabase) throw new Error('Supabase não configurado.');

  const [scoutId, classSlug, itemId] = String(key).split(':');
  const saved = [];

  for (const file of files) {
    const id = crypto.randomUUID();
    const path = `${scoutId}/${classSlug}/${itemId}/${id}-${safeName(file.name)}`;

    const { error } = await supabase.storage
      .from('evidence')
      .upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false
      });

    if (error) throw error;

    saved.push({
      id: path,
      path,
      name: file.name,
      type: file.type,
      size: file.size,
      createdAt: new Date().toISOString()
    });
  }

  return saved;
}

// ✅ FUNÇÃO QUE ESTAVA FALTANDO (CORREÇÃO DO ERRO)
export async function getEvidenceFile(path) {
  if (!supabase) throw new Error('Supabase não configurado.');

  const filePath = String(path || '').trim();
  if (!filePath) throw new Error('Arquivo inválido.');

  const { data, error } = await supabase.storage
    .from('evidence')
    .createSignedUrl(filePath, 60 * 60); // 1h

  if (error) throw error;

  return data?.signedUrl || null;
}

export async function deleteEvidenceFile(id) {
  if (!supabase) return;

  const path = String(id || '').trim();
  if (!path) throw new Error('Arquivo inválido.');

  const { data, error } = await supabase.functions.invoke('manage-user', {
    body: { action: 'delete-evidence', path }
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.ok) throw new Error('Arquivo não excluído.');
}