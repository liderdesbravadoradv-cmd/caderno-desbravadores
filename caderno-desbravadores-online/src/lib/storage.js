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

const usernameEmail = (username) =>
  `${encodeURIComponent(String(username || '').trim().toLowerCase())}@login.clube.local`;

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

  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameEmail(username),
    password
  });

  if (error || !data.user) throw new Error('Usuário ou senha inválidos.');

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

  const db = await loadDB();
  const user = db.users.find((item) => item.id === session.user.id);

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

  if (error) throw new Error(error.message || 'Não foi possível atualizar o acesso.');
  if (data?.error) throw new Error(data.error);
  return data;
}

const safeName = (name) => String(name || 'arquivo')
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

export async function deleteEvidenceFile(id) {
  if (!supabase) return;

  const path = String(id || '').trim();
  if (!path) throw new Error('Arquivo inválido.');

  // A exclusão passa pela Edge Function para usar a chave administrativa
  // somente no servidor e não depender da política DELETE do Storage no cliente.
  const { data, error } = await supabase.functions.invoke('manage-user', {
    body: { action: 'delete-evidence', path }
  });

  if (error) throw new Error(error.message || 'Não foi possível excluir o arquivo.');
  if (data?.error) throw new Error(data.error);
  if (!data?.ok) throw new Error('O arquivo não foi excluído do armazenamento.');
}

export async function getEvidenceFile(id) {
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from('evidence')
    .download(id);

  if (error) throw error;
  return { id, blob: data };
}

export async function deleteEvidenceFilesForKey(key) {
  if (!supabase) return;
  const [scoutId, classSlug, itemId] = String(key).split(':');
  const folder = `${scoutId}/${classSlug}/${itemId}`;
  const { data, error } = await supabase.storage.from('evidence').list(folder, { limit: 100 });
  if (error) throw error;
  const paths = (data || []).map((item) => `${folder}/${item.name}`);
  if (paths.length) await supabase.storage.from('evidence').remove(paths);
}

export async function deleteEvidenceFilesForScout(scoutId) {
  if (!supabase) return;

  const { data: state, error } = await supabase
    .from('club_state')
    .select('submissions')
    .eq('profile_id', scoutId)
    .maybeSingle();

  if (error) throw error;

  const paths = [];
  for (const submission of Object.values(state?.submissions || {})) {
    for (const file of submission?.files || []) {
      if (file.path || file.id) paths.push(file.path || file.id);
    }
  }

  if (paths.length) await supabase.storage.from('evidence').remove(paths);
}
