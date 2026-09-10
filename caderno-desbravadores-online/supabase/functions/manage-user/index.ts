import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });

const usernameEmail = (username: string) =>
  `${encodeURIComponent(
    String(username || '').trim().toLowerCase()
  )}@login.clube.local`;

function normalizeBirth(value: string) {
  const m = value.match(
    /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/
  );

  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  return null;
}

function getSecretKey() {
  const direct = Deno.env.get('SUPABASE_SECRET_KEY');

  if (direct) {
    return direct;
  }

  const legacy = Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY'
  );

  if (legacy) {
    return legacy;
  }

  const collection = Deno.env.get(
    'SUPABASE_SECRET_KEYS'
  );

  if (collection) {
    try {
      const parsed = JSON.parse(collection);

      return (
        parsed.default ||
        Object.values(parsed)[0] ||
        ''
      );
    } catch {
      return '';
    }
  }

  return '';
}

Deno.serve(async (req: Request) => {
  // ============================================================
  // CORS / PREFLIGHT
  // ============================================================

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return json(
      { error: 'Método não permitido.' },
      405
    );
  }

  // ============================================================
  // CONFIGURAÇÃO
  // ============================================================

  const supabaseUrl = Deno.env.get(
    'SUPABASE_URL'
  );

  const secretKey = getSecretKey();

  if (!supabaseUrl) {
    return json(
      {
        error:
          'SUPABASE_URL não configurada.',
      },
      500
    );
  }

  if (!secretKey) {
    return json(
      {
        error:
          'Chave secreta do Supabase não configurada.',
      },
      500
    );
  }

  // ============================================================
  // AUTENTICAÇÃO
  // ============================================================

  const authHeader =
    req.headers.get('Authorization');

  if (!authHeader) {
    return json(
      { error: 'Não autenticado.' },
      401
    );
  }

  const callerClient = createClient(
    supabaseUrl,
    secretKey,
    {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    }
  );

  const admin = createClient(
    supabaseUrl,
    secretKey
  );

  const {
    data: callerData,
    error: callerError,
  } = await callerClient.auth.getUser();

  if (
    callerError ||
    !callerData.user
  ) {
    return json(
      { error: 'Sessão inválida.' },
      401
    );
  }

  // ============================================================
  // LEITURA DO BODY
  // ============================================================

  let body: any;

  try {
    body = await req.json();
  } catch {
    return json(
      { error: 'Dados inválidos.' },
      400
    );
  }

  const action = body?.action;

  if (
    ![
      'create',
      'update',
      'delete',
      'delete-evidence',
    ].includes(action)
  ) {
    return json(
      { error: 'Ação inválida.' },
      400
    );
  }

  // ============================================================
  // EXCLUSÃO DE EVIDÊNCIA
  // ============================================================

  if (action === 'delete-evidence') {
    const path = String(
      body.path || ''
    ).trim();

    if (!path) {
      return json(
        {
          error:
            'Arquivo não informado.',
        },
        400
      );
    }

    const ownerId =
      path.split('/')[0] || '';

    if (!ownerId) {
      return json(
        {
          error:
            'Caminho do arquivo inválido.',
        },
        400
      );
    }

    const {
      data: ownerProfile,
      error: ownerError,
    } = await admin
      .from('profiles')
      .select('id, role')
      .eq(
        'id',
        callerData.user.id
      )
      .single();

    if (
      ownerError ||
      !ownerProfile
    ) {
      return json(
        {
          error:
            'Perfil não encontrado.',
        },
        403
      );
    }

    // O próprio dono pode excluir seu arquivo.
    // O Diretor também pode excluir qualquer arquivo.
    const allowed =
      ownerProfile.role ===
        'DIRECTOR' ||
      ownerId ===
        callerData.user.id;

    if (!allowed) {
      return json(
        {
          error:
            'Você não pode excluir este arquivo.',
        },
        403
      );
    }

    const {
      data: removed,
      error: removeError,
    } = await admin.storage
      .from('evidence')
      .remove([path]);

    if (removeError) {
      return json(
        {
          error:
            removeError.message,
        },
        400
      );
    }

    if (
      !removed ||
      removed.length === 0
    ) {
      return json(
        {
          error:
            'O arquivo não foi encontrado ou não pôde ser excluído.',
        },
        404
      );
    }

    return json({
      ok: true,
      removed: removed.length,
    });
  }

  // ============================================================
  // A PARTIR DAQUI, SOMENTE O DIRETOR
  // ============================================================

  const {
    data: callerProfile,
    error: profileError,
  } = await admin
    .from('profiles')
    .select('id, role')
    .eq(
      'id',
      callerData.user.id
    )
    .single();

  if (
    profileError ||
    callerProfile?.role !==
      'DIRECTOR'
  ) {
    return json(
      {
        error:
          'Somente o Diretor pode gerenciar acessos.',
      },
      403
    );
  }

  // ============================================================
  // EXCLUSÃO DE USUÁRIO
  // ============================================================

  if (action === 'delete') {
    if (
      !body.userId ||
      body.userId ===
        callerData.user.id
    ) {
      return json(
        {
          error:
            'O Diretor não pode excluir o próprio acesso.',
        },
        400
      );
    }

    const {
      data: target,
      error: targetError,
    } = await admin
      .from('profiles')
      .select('id, role')
      .eq(
        'id',
        body.userId
      )
      .maybeSingle();

    if (
      targetError ||
      !target
    ) {
      return json(
        {
          error:
            'Usuário não encontrado.',
        },
        404
      );
    }

    const {
      data: state,
    } = await admin
      .from('club_state')
      .select('submissions')
      .eq(
        'profile_id',
        target.id
      )
      .maybeSingle();

    const paths: string[] = [];

    for (const submission of Object.values(
      state?.submissions || {}
    )) {
      for (const file of (
        submission as any
      )?.files || []) {
        const path =
          (file as any)?.path ||
          (file as any)?.id;

        if (path) {
          paths.push(path);
        }
      }
    }

    if (paths.length > 0) {
      await admin.storage
        .from('evidence')
        .remove(paths);
    }

    const {
      error: deleteError,
    } = await admin.auth.admin.deleteUser(
      target.id
    );

    if (deleteError) {
      return json(
        {
          error:
            deleteError.message,
        },
        400
      );
    }

    return json({
      ok: true,
    });
  }

  // ============================================================
  // DADOS PARA CRIAÇÃO / ATUALIZAÇÃO
  // ============================================================

  const username = String(
    body.username || ''
  ).trim();

  const password = String(
    body.password || ''
  );

  const role = String(
    body.role ||
      'DESBRAVADOR'
  );

  const name = String(
    body.name || ''
  ).trim();

  const birth = String(
    body.birth || ''
  ).trim();

  const club = String(
    body.club || ''
  ).trim();

  const unit = String(
    body.unit || ''
  ).trim();

  if (
    !username ||
    !password ||
    !name
  ) {
    return json(
      {
        error:
          'Nome, usuário e senha são obrigatórios.',
      },
      400
    );
  }

  if (
    ![
      'DESBRAVADOR',
      'ADMIN',
      'REGIONAL',
    ].includes(role)
  ) {
    return json(
      {
        error:
          'Função inválida.',
      },
      400
    );
  }

  const email =
    usernameEmail(username);

  // ============================================================
  // CRIAÇÃO DE USUÁRIO
  // ============================================================

  if (action === 'create') {
    const {
      data: existing,
      error: existingError,
    } = await admin
      .from('profiles')
      .select('id')
      .ilike(
        'username',
        username
      )
      .maybeSingle();

    if (existingError) {
      return json(
        {
          error:
            existingError.message,
        },
        400
      );
    }

    if (existing) {
      return json(
        {
          error:
            'Este nome de usuário já está cadastrado.',
        },
        409
      );
    }

    const {
      data: created,
      error: createError,
    } = await admin.auth.admin.createUser(
      {
        email,
        password,
        email_confirm: true,
      }
    );

    if (
      createError ||
      !created?.user
    ) {
      return json(
        {
          error:
            createError?.message ||
            'Não foi possível criar o usuário.',
        },
        400
      );
    }

    const {
      error: insertError,
    } = await admin
      .from('profiles')
      .insert({
        id: created.user.id,
        username,
        role,
        name,
        birth_date:
          normalizeBirth(birth),
        club,
        unit,
      });

    if (insertError) {
      await admin.auth.admin.deleteUser(
        created.user.id
      );

      return json(
        {
          error:
            insertError.message,
        },
        400
      );
    }

    const {
      error: credentialError,
    } = await admin
      .from('director_credentials')
      .insert({
        profile_id:
          created.user.id,
        password_plain:
          password,
      });

    if (credentialError) {
      await admin
        .from('profiles')
        .delete()
        .eq(
          'id',
          created.user.id
        );

      await admin.auth.admin.deleteUser(
        created.user.id
      );

      return json(
        {
          error:
            credentialError.message,
        },
        400
      );
    }

    return json({
      ok: true,
      id: created.user.id,
    });
  }

  // ============================================================
  // ATUALIZAÇÃO DE USUÁRIO
  // ============================================================

  if (action === 'update') {
    const userId = String(
      body.userId || ''
    );

    if (!userId) {
      return json(
        {
          error:
            'Usuário não informado.',
        },
        400
      );
    }

    const {
      data: target,
      error: targetError,
    } = await admin
      .from('profiles')
      .select(
        'id, username, role, name, birth_date, club, unit'
      )
      .eq(
        'id',
        userId
      )
      .single();

    if (
      targetError ||
      !target
    ) {
      return json(
        {
          error:
            'Usuário não encontrado.',
        },
        404
      );
    }

    const {
      data: duplicate,
    } = await admin
      .from('profiles')
      .select('id')
      .ilike(
        'username',
        username
      )
      .neq(
        'id',
        userId
      )
      .maybeSingle();

    if (duplicate) {
      return json(
        {
          error:
            'Este nome de usuário já está cadastrado.',
        },
        409
      );
    }

    const {
      error: authUpdateError,
    } = await admin.auth.admin.updateUserById(
      userId,
      {
        email,
        password,
        email_confirm: true,
      }
    );

    if (authUpdateError) {
      return json(
        {
          error:
            authUpdateError.message,
        },
        400
      );
    }

    const {
      error: updateError,
    } = await admin
      .from('profiles')
      .update({
        username,
        role,
        name,
        birth_date:
          normalizeBirth(birth),
        club,
        unit,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        'id',
        userId
      );

    if (updateError) {
      return json(
        {
          error:
            updateError.message,
        },
        400
      );
    }

    const {
      error: credentialError,
    } = await admin
      .from('director_credentials')
      .upsert({
        profile_id:
          userId,
        password_plain:
          password,
      });

    if (credentialError) {
      return json(
        {
          error:
            credentialError.message,
        },
        400
      );
    }

    return json({
      ok: true,
      id: userId,
    });
  }

  return json(
    {
      error:
        'Ação não processada.',
    },
    400
  );
});
