import { supabase } from './supabase';

const seed = {
  users: [],
  submissions: {},
  regionalReviews: {},
  adminReviews: {},
  messages: {}
};

const usernameEmail = (username) =>
  `${encodeURIComponent(String(username || '').trim().toLowerCase())}@login.clube.local`;

const normalizeProfile = (row, password = '') => ({
  id: row.id,
  username: row.username,
  password,
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

  return loadDB();
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

async function getDirectorPasswords(current) {
  if (current.role !== 'DIRECTOR') return {};
  const { data, error } = await supabase
    .from('director_credentials')
    .select('profile_id,password_plain');
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.profile_id, row.password_plain]));
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
  const [profiles, states, passwords] = await Promise.all([
    getVisibleProfiles(current),
    getVisibleStates(current),
    getDirectorPasswords(current)
  ]);

  const submissions = {};
  const messages = {};

  for (const state of states) {
    Object.assign(submissions, state.submissions || {});
    Object.assign(messages, state.messages || {});
  }

  return {
    ...seed,
    users: profiles.map((row) => normalizeProfile(row, passwords[row.id] || '')),
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
