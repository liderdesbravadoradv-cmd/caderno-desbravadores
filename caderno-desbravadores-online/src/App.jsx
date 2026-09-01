import { useEffect, useMemo, useState } from 'react';
import { classes, classMap, flattenRequirements } from './data/classes';
import {
  loadDB,
  saveDB,
  manageUser,
  saveEvidenceFiles,
  getEvidenceFile,
  authenticateUser
} from './lib/storage';
import { generateDigitalNotebook } from './lib/notebook';

const STATUS = {
  none: 'Não iniciado',
  submitted: 'Aguardando liderança',
  adminApproved: 'Aprovado pela liderança',
  adminRejected: 'Devolvido pela liderança',
  regionalApproved: 'Confirmado pelo regional',
  regionalRejected: 'Devolvido pelo regional'
};

const isYouTube = (url) =>
  /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)/i.test(url || '');

const youtubeId = (url) => {
  const match = (url || '').match(
    /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/i
  );
  return match?.[1] || '';
};

const formatBytes = (bytes) => {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(bytes > 1024 * 1024 ? 1 : 0)} MB`;
};

const isEvaluator = (role) =>
  role === 'ADMIN' || role === 'DIRECTOR' || role === 'REGIONAL';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();

    try {
      const db = await authenticateUser(username.trim(), password);
      const user = db.users.find(
        (item) => item.username.toLowerCase() === username.trim().toLowerCase()
      );

      if (!user) throw new Error('Usuário ou senha inválidos.');

      setError('');
      onLogin(user, db);
    } catch {
      setError('Usuário ou senha inválidos.');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mark">✦</div>
        <div className="eyebrow">CLUBE DE DESBRAVADORES</div>
        <h1>CADERNO DE CLASSES</h1>
        <p className="muted">Acesse com usuário e senha.</p>

        <form onSubmit={submit}>
          <label>
            Usuário
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <div className="alert error">{error}</div>}

          <button className="primary full" type="submit">
            ENTRAR
          </button>
        </form>

      </div>
    </div>
  );
}

function Topbar({ user, onLogout }) {
  const title =
    user.role === 'DESBRAVADOR'
      ? 'Área do Desbravador'
      : user.role === 'DIRECTOR'
        ? 'Painel do Diretor'
        : user.role === 'ADMIN'
          ? 'Painel da Liderança'
          : 'Painel do Regional';

  return (
    <header className="topbar">
      <div>
        <b>Caderno de Classes</b>
        <span>{title}</span>
      </div>

      <div className="top-actions">
        <span className="user-chip">{user.name}</span>
        <button className="outline" onClick={onLogout} type="button">
          Sair
        </button>
      </div>
    </header>
  );
}

function Cover({ scout }) {
  return (
    <section className="cover">
      <div className="cover-title">CLUBE DE DESBRAVADORES</div>
      <h1>CADERNO DE CLASSES</h1>

      <div className="identity">
        <div>
          <b>Nome:</b>
          <span>{scout.name}</span>
        </div>
        <div>
          <b>Nascimento:</b>
          <span>{scout.birth || '—'}</span>
        </div>
        <div>
          <b>Clube:</b>
          <span>{scout.club || '—'}</span>
        </div>
        <div>
          <b>Unidade:</b>
          <span>{scout.unit || '—'}</span>
        </div>
      </div>
    </section>
  );
}

function useProgress(scoutId, db) {
  return useMemo(() => {
    const result = {};

    for (const classData of classes) {
      let leadership = 0;
      let regional = 0;
      const completed = {};
      const regionalCompleted = {};

      for (const item of flattenRequirements(classData)) {
        const key = `${scoutId}:${classData.slug}:${item.id}`;
        const submission = db.submissions[key];

        if (
          submission?.status === 'adminApproved' ||
          submission?.status === 'regionalApproved'
        ) {
          leadership += 1;
          completed[item.id] = true;
        }

        if (submission?.status === 'regionalApproved') {
          regional += 1;
          regionalCompleted[item.id] = true;
        }
      }

      result[classData.slug] = {
        done: leadership,
        total: classData.total,
        regional,
        completed,
        regionalCompleted
      };
    }

    return result;
  }, [scoutId, db]);
}

function Checklist({ selected, setSelected, progress, role }) {
  const isRegional = role === 'REGIONAL';

  return (
    <section className="checklist-section">
      <div className="section-title">
        <div>
          <span className="small-label">ACOMPANHAMENTO</span>
          <h2>
            {isRegional
              ? 'Checklist de confirmação do Regional'
              : 'Checklist das Classes'}
          </h2>
        </div>

        <span className="legend">✓ liderança · ★ regional</span>
      </div>

      <div className="checklist-grid">
        {classes.map((classData) => {
          const item = progress[classData.slug] || {
            done: 0,
            total: classData.total,
            completed: {},
            regionalCompleted: {},
            regional: 0
          };

          const completed = isRegional
            ? item.regionalCompleted
            : item.completed;

          const done = isRegional ? item.regional : item.done;
          const percent = item.total
            ? Math.round((done / item.total) * 100)
            : 0;

          return (
            <button
              className={`class-button ${
                selected === classData.slug ? 'selected' : ''
              }`}
              key={classData.slug}
              onClick={() => setSelected(classData.slug)}
              type="button"
            >
              <div
                className="check-card"
                style={{ '--class-color': classData.color }}
              >
                <div className="check-head">
                  <span className="check-name">{classData.name}</span>
                  <span>
                    {done}/{item.total}
                  </span>
                </div>

                <span className="check-percent">
                  {percent}% {isRegional ? 'confirmado' : 'concluído'}
                </span>

                <div className="section-checklist">
                  {classData.requirements.map(([section, items]) => (
                    <div className="mini-section" key={section}>
                      <b>{section}</b>
                      <div className="mini-items">
                        {items.map((requirement) => {
                          const isDone = Boolean(completed[requirement.id]);

                          return (
                            <i
                              key={requirement.id}
                              className={isDone ? 'done' : ''}
                            >
                              {isDone ? '✓' : requirement.number}
                            </i>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="progress">
                  <span style={{ width: `${percent}%` }} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EvidencePreview({ file }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    let objectUrl = null;

    (async () => {
      const full = await getEvidenceFile(file.id);

      if (!full || !alive) return;

      objectUrl = URL.createObjectURL(full.blob);
      setUrl(objectUrl);
    })();

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);

  if (!url) {
    return (
      <div className="file-loading">
        Carregando {file.name}…
      </div>
    );
  }

  const stop = (event) => event.stopPropagation();

  if (file.type?.startsWith('image/')) {
    return (
      <div className="evidence-preview" onClick={stop}>
        <img src={url} alt={file.name} />
        <small>{file.name}</small>
      </div>
    );
  }

  if (file.type?.startsWith('video/')) {
    return (
      <div className="evidence-preview" onClick={stop}>
        <video controls preload="metadata" src={url} />
        <small>{file.name}</small>
      </div>
    );
  }

  if (file.type === 'application/pdf') {
    return (
      <div className="evidence-preview" onClick={stop}>
        <iframe title={file.name} src={url} />
        <small>{file.name}</small>
      </div>
    );
  }

  return (
    <a
      className="file-card"
      href={url}
      download={file.name}
      onClick={stop}
    >
      📎
      <span>
        <b>{file.name}</b>
        <small>
          {file.type || 'arquivo'} {formatBytes(file.size)}
        </small>
      </span>
    </a>
  );
}

function EvidenceGallery({ submission }) {
  if (!submission?.files?.length) return null;

  return (
    <div className="evidence-gallery">
      {submission.files.map((file) => (
        <EvidencePreview key={file.id} file={file} />
      ))}
    </div>
  );
}

function CommentNotice({ submission, messages = [] }) {
  const comments = [
    submission?.adminComment && {
      role: 'Liderança',
      text: submission.adminComment
    },
    submission?.regionalComment && {
      role: 'Regional',
      text: submission.regionalComment
    }
  ].filter(Boolean);

  if (!comments.length && !messages.length) return null;

  return (
    <div className="comment-notice" onClick={(event) => event.stopPropagation()}>
      {comments.length > 0 && <div className="comment-title">💬 Comentário da avaliação</div>}

      {messages.length > 0 && (
        <div className="message-notice">
          <div className="comment-title">✉ Mensagem da liderança</div>
          {messages.map((message, index) => (
            <p key={`message-${index}`}>{message.text}</p>
          ))}
        </div>
      )}

      {comments.map((comment, index) => (
        <p key={`${comment.role}-${index}`}>
          <b>{comment.role}:</b> {comment.text}
        </p>
      ))}

      {submission && (submission.status === 'adminRejected' ||
        submission.status === 'regionalRejected') && (
        <small>
          O aviso será ocultado quando você reenviar a atividade.
        </small>
      )}
    </div>
  );
}

function EvidenceForm({
  submission,
  onSubmit,
  submissionKey,
  onCancel
}) {
  const [date, setDate] = useState(submission?.date || '');
  const [text, setText] = useState(submission?.text || '');
  const [youtube, setYoutube] = useState(submission?.youtube || '');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const saved = await saveEvidenceFiles(files, submissionKey);

      await onSubmit({
        date,
        text,
        youtube,
        files: saved
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="evidence-form"
      onSubmit={save}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="form-row">
        <label>
          Data da realização*
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>

        <label>
          Adicionar arquivos
          <input
            type="file"
            accept="image/*,video/*,application/pdf"
            multiple
            onChange={(event) =>
              setFiles(Array.from(event.target.files || []))
            }
          />
          <small>Vários arquivos podem ser acrescentados.</small>
        </label>
      </div>

      <label>
        Texto / relatório / observações
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Escreva a resposta ou relatório."
        />
      </label>

      <label>
        Vídeo do YouTube (opcional)
        <input
          type="url"
          value={youtube}
          onChange={(event) => setYoutube(event.target.value)}
          placeholder="Cole o link do YouTube"
        />
      </label>

      <div className="edit-actions">
        <button
          type="submit"
          className="send-button"
          disabled={busy}
        >
          {busy ? 'Salvando…' : 'Enviar para aprovação'}
        </button>

        <button
          type="button"
          className="cancel-button"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ReviewBox({ role, submission, onReview }) {
  const [comment, setComment] = useState('');
  const isLeadership =
    role === 'ADMIN' || role === 'DIRECTOR';

  const pending = isLeadership
    ? submission.status === 'submitted' ||
      submission.status === 'regionalRejected'
    : submission.status === 'adminApproved';

  return (
    <div
      className="review-box"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="review-head">
        <b>
          {isLeadership
            ? 'Revisão da liderança'
            : 'Revisão do regional'}
        </b>

        {!pending && (
          <button
            type="button"
            className="review-link"
            onClick={() => onReview({ review: true })}
          >
            ↶ Revisar aprovação
          </button>
        )}
      </div>

      {submission.adminComment && (
        <p>
          <strong>Liderança:</strong> {submission.adminComment}
        </p>
      )}

      {submission.regionalComment && (
        <p>
          <strong>Regional:</strong> {submission.regionalComment}
        </p>
      )}

      {pending && (
        <>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Comentário do avaliador (opcional; explique a devolução)."
          />

          <div className="review-actions">
            <button
              type="button"
              className="approve"
              onClick={() =>
                onReview({
                  approved: true,
                  comment
                })
              }
            >
              ✓ Aprovar
            </button>

            <button
              type="button"
              className="reject"
              onClick={() => {
                if (!comment.trim()) {
                  alert(
                    'Informe um comentário para devolver o requisito.'
                  );
                  return;
                }

                onReview({
                  approved: false,
                  comment
                });
              }}
            >
              ↩ Devolver
            </button>
          </div>
        </>
      )}
    </div>
  );
}


function LeadershipMessageBox({ role, messages = [], onMessage }) {
  const [text, setText] = useState('');
  if (role !== 'ADMIN' && role !== 'DIRECTOR') return null;

  const send = () => {
    if (!text.trim()) return;
    onMessage(text.trim());
    setText('');
  };

  return (
    <div className="leadership-message-box" onClick={(event) => event.stopPropagation()}>
      <div className="review-head">
        <b>Mensagem para o desbravador</b>
        <span className="muted-inline">Pode ser enviada mesmo sem relatório.</span>
      </div>
      {messages.map((message, index) => (
        <div className="sent-message" key={`${message.at || ''}-${index}`}>
          <b>Mensagem atual:</b> {message.text}
        </div>
      ))}
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Ex.: Você está esquecendo de fazer o relatório desta atividade…" />
      <button type="button" className="send-button" onClick={send}>Enviar mensagem</button>
    </div>
  );
}

function Requirement({
  item,
  classData,
  submission,
  onSubmit,
  role,
  onReview,
  onMessage,
  scoutKey,
  messages,
  open,
  onToggle
}) {
  const editable = role === 'DESBRAVADOR';

  return (
    <article
      className={`requirement ${
        editable ? 'scout-requirement' : ''
      } ${editable && !open ? 'is-collapsed' : 'is-open'}`}
      onClick={() => {
        if (editable && !open) onToggle?.();
      }}
    >
      <div className="req-number">{item.number}</div>

      <div className="req-content">
        <div className="req-id">
          {item.sectionCode} · requisito {item.number}
        </div>

        <h3>{item.text}</h3>

        {item.sub?.length > 0 && (
          <ul>
            {item.sub.map((subitem, index) => (
              <li key={index}>{subitem}</li>
            ))}
          </ul>
        )}

        {submission && (
          <>
            <div className="status-row">
              <span
                className={`status status-${submission.status}`}
              >
                {STATUS[submission.status] || submission.status}
              </span>

              <span className="date-badge">
                📅 {submission.date}
              </span>

              <span className="date-badge">
                📎 {submission.files?.length || 0} arquivo(s)
              </span>
            </div>

            {editable && (
              <CommentNotice submission={submission} messages={messages} />
            )}

            <div
              className="visible-answer"
              onClick={(event) => event.stopPropagation()}
            >
              {submission.text && (
                <div className="answer-text">
                  <b>Resposta / relatório</b>
                  <p>{submission.text}</p>
                </div>
              )}

              {submission.youtube &&
                isYouTube(submission.youtube) && (
                  <div className="youtube-box">
                    <b>Vídeo do YouTube</b>
                    <iframe
                      src={`https://www.youtube.com/embed/${youtubeId(
                        submission.youtube
                      )}`}
                      title="Vídeo do YouTube"
                      allowFullScreen
                    />
                  </div>
                )}

              <EvidenceGallery submission={submission} />
            </div>
          </>
        )}

        {!submission && editable && (
          <div className="empty-preview">
            Ainda não há resposta para este requisito.
            <CommentNotice messages={messages} />
          </div>
        )}


        {editable && open && (
          <EvidenceForm
            submission={submission}
            submissionKey={`${scoutKey}:${classData.slug}:${item.id}`}
            onSubmit={(data) => onSubmit(item, data)}
            onCancel={onToggle}
          />
        )}

        {role === 'ADMIN' && (
          <LeadershipMessageBox role={role} messages={messages} onMessage={onMessage} />
        )}

        {isEvaluator(role) && submission && (
          <ReviewBox
            role={role}
            submission={submission}
            onReview={(decision) => onReview(item, decision)}
          />
        )}
      </div>
    </article>
  );
}

function ClassSelector({ selected, setSelected }) {
  return (
    <div className="class-selector">
      <span className="small-label">CLASSE</span>

      <div className="class-selector-grid">
        {classes.map((classData) => (
          <button
            type="button"
            key={classData.slug}
            className={`class-tab ${
              selected === classData.slug ? 'active' : ''
            }`}
            style={{
              '--class-color': classData.color,
              '--class-light': classData.light
            }}
            onClick={() => setSelected(classData.slug)}
          >
            {classData.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClassPage({
  user,
  scout,
  selected,
  db,
  setDb
}) {
  const classData = classMap[selected];
  const [openReq, setOpenReq] = useState(null);
  const canEdit = user.role === 'DESBRAVADOR';

  const handleSubmit = async (item, data) => {
    const next = {
      ...db,
      submissions: { ...db.submissions }
    };

    const key = `${scout.id}:${classData.slug}:${item.id}`;
    const old = next.submissions[key] || {};

    next.submissions[key] = {
      ...old,
      ...data,
      files: [...(old.files || []), ...(data.files || [])],
      status: 'submitted',
      submittedBy: scout.id,
      updatedAt: new Date().toISOString(),
      adminComment: '',
      regionalComment: ''
    };

    if (next.messages) delete next.messages[key];
    saveDB(next);
    setDb(next);
    setOpenReq(null);
  };

  const handleMessage = (item, text) => {
    const key = `${scout.id}:${classData.slug}:${item.id}`;
    const next = {
      ...db,
      messages: { ...(db.messages || {}) }
    };
    const current = next.messages[key] || [];
    next.messages[key] = [
      ...current,
      { text, at: new Date().toISOString(), role: user.role }
    ];
    saveDB(next);
    setDb(next);
  };

  const handleReview = (item, decision) => {
    const next = {
      ...db,
      submissions: { ...db.submissions }
    };

    const key = `${scout.id}:${classData.slug}:${item.id}`;
    const old = next.submissions[key];

    if (!old) return;

    if (decision.review) {
      let nextStatus = old.status;

      if (old.status === 'regionalApproved') {
        nextStatus = 'adminApproved';
      } else if (old.status === 'adminApproved') {
        nextStatus = 'submitted';
      }

      next.submissions[key] = {
        ...old,
        status: nextStatus,
        reviewedAt: new Date().toISOString()
      };
    } else if (
      user.role === 'ADMIN' ||
      user.role === 'DIRECTOR'
    ) {
      next.submissions[key] = {
        ...old,
        status: decision.approved
          ? 'adminApproved'
          : 'adminRejected',
        adminComment: decision.comment || '',
        adminAt: new Date().toISOString()
      };
    } else {
      next.submissions[key] = {
        ...old,
        status: decision.approved
          ? 'regionalApproved'
          : 'regionalRejected',
        regionalComment: decision.comment || '',
        regionalAt: new Date().toISOString()
      };
    }

    saveDB(next);
    setDb(next);
  };

  if (!classData) {
    return (
      <div className="panel">
        <h2>Classe não encontrada.</h2>
      </div>
    );
  }

  return (
    <section className="class-page">
      <div
        className="class-banner"
        style={{
          '--class-color': classData.color,
          '--class-light': classData.light
        }}
      >
        <div className="class-icon">◆</div>

        <div>
          <span>Cartão de</span>
          <h2>{classData.name}</h2>
          <p>{classData.advancedName}</p>
        </div>
      </div>

      <nav className="section-nav">
        {classData.requirements.map(([section], index) => (
          <button
            key={section}
            type="button"
            onClick={() =>
              document
                .getElementById(
                  `${classData.slug}-section-${index}`
                )
                ?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            {section}
          </button>
        ))}
      </nav>

      {classData.requirements.map(([section, requirements], index) => (
        <section
          className="requirement-section"
          id={`${classData.slug}-section-${index}`}
          key={section}
        >
          <div
            className="section-heading"
            style={{ '--class-color': classData.color }}
          >
            {section}
          </div>

          {requirements.map((item) => {
            const key = `${scout.id}:${classData.slug}:${item.id}`;

            return (
              <Requirement
                key={key}
                item={item}
                classData={classData}
                submission={db.submissions[key]}
                onSubmit={handleSubmit}
                role={user.role}
                onReview={handleReview}
                onMessage={(text) => handleMessage(item, text)}
                messages={db.messages?.[key] || []}
                scoutKey={scout.id}
                open={canEdit ? openReq === key : true}
                onToggle={() =>
                  setOpenReq(openReq === key ? null : key)
                }
              />
            );
          })}
        </section>
      ))}
    </section>
  );
}

function AccountManager({ db, setDb }) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(null);

  const emptyForm = {
    name: '',
    username: '',
    password: '',
    role: 'DESBRAVADOR',
    birth: '',
    club: 'Clube Manancial',
    unit: ''
  };

  const [form, setForm] = useState(emptyForm);

  const users = db.users
    .filter((user) =>
      ['DESBRAVADOR', 'ADMIN', 'REGIONAL'].includes(user.role)
    )
    .filter((user) =>
      `${user.name} ${user.username}`
        .toLowerCase()
        .includes(filter.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const saveUser = async (event) => {
    event.preventDefault();

    if (!form.name || !form.username || !form.password) return;

    const duplicate = db.users.some(
      (user) =>
        user.username.toLowerCase() === form.username.toLowerCase() &&
        user.id !== editing
    );

    if (duplicate) {
      alert('Este nome de usuário já está cadastrado.');
      return;
    }

    try {
      await manageUser(editing ? 'update' : 'create', {
        userId: editing || null,
        ...form
      });
      const refreshed = await loadDB();
      setDb(refreshed);
      setEditing(null);
      setForm(emptyForm);
    } catch (error) {
      alert(error.message || 'Não foi possível salvar o acesso.');
    }
  };

  const remove = async (id) => {
    const target = db.users.find((user) => user.id === id);
    if (!target) return;

    const isScout = target.role === 'DESBRAVADOR';
    const message = isScout
      ? 'Excluir este acesso de desbravador? A conta, as respostas, mensagens e arquivos desse acesso serão apagados permanentemente.'
      : 'Excluir este acesso?';

    if (!confirm(message)) return;

    try {
      await manageUser('delete', { userId: id });
      setDb(await loadDB());
    } catch (error) {
      alert(error.message || 'Não foi possível excluir o acesso.');
    }
  };

  const edit = (user) => {
    setEditing(user.id);
    setForm({
      name: user.name || '',
      username: user.username || '',
      password: user.password || '',
      role: user.role,
      birth: user.birth || '',
      club: user.club || 'Clube Manancial',
      unit: user.unit || ''
    });
  };

  return (
    <section className="account-manager">
      <div className="panel-head">
        <div>
          <span className="small-label">DIRETOR</span>
          <h2>Gerenciar acessos</h2>
          <p>
            Somente o Diretor pode criar, alterar, consultar ou
            excluir contas.
          </p>
        </div>
      </div>

      <input
        className="search"
        placeholder="Pesquisar por nome ou usuário…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="account-list">
        {users.map((user) => (
          <div className="account-row" key={user.id}>
            <div>
              <b>{user.name}</b>
              <span>
                {user.username} · {user.role}
              </span>
            </div>

            <div className="account-password">
              <code>{user.password}</code>

              <button
                className="outline"
                onClick={() => edit(user)}
                type="button"
              >
                Editar senha
              </button>

              {user.id !== 'director-1' && (
                <button
                  className="danger-link"
                  onClick={() => remove(user.id)}
                  type="button"
                >
                  Excluir
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <details className="new-scout" open={Boolean(editing)}>
        <summary>
          {editing ? 'Editar acesso' : '+ Criar novo acesso'}
        </summary>

        <form onSubmit={saveUser}>
          <div className="form-row">
            <input
              placeholder="Nome completo"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              required
            />

            <input
              placeholder="Usuário"
              value={form.username}
              onChange={(event) =>
                setForm({
                  ...form,
                  username: event.target.value
                })
              }
              required
            />

            <input
              placeholder="Senha"
              value={form.password}
              onChange={(event) =>
                setForm({
                  ...form,
                  password: event.target.value
                })
              }
              required
            />

            <select
              value={form.role}
              onChange={(event) =>
                setForm({
                  ...form,
                  role: event.target.value
                })
              }
            >
              <option value="DESBRAVADOR">Desbravador</option>
              <option value="ADMIN">Liderança</option>
              <option value="REGIONAL">Regional</option>
            </select>

            <input
              placeholder="Nascimento"
              value={form.birth}
              onChange={(event) =>
                setForm({
                  ...form,
                  birth: event.target.value
                })
              }
            />

            <input
              placeholder="Unidade"
              value={form.unit}
              onChange={(event) =>
                setForm({
                  ...form,
                  unit: event.target.value
                })
              }
            />
          </div>

          <button className="primary" type="submit">
            {editing ? 'Salvar alterações' : 'Criar acesso'}
          </button>

          {editing && (
            <button
              className="cancel-button"
              type="button"
              onClick={() => {
                setEditing(null);
                setForm(emptyForm);
              }}
            >
              Cancelar edição
            </button>
          )}
        </form>
      </details>
    </section>
  );
}

function ScoutPanel({ user, db, setDb }) {
  const [selected, setSelected] = useState('amigo');
  const progress = useProgress(user.id, db);

  return (
    <>
      <Cover scout={user} />

      <Checklist
        selected={selected}
        setSelected={setSelected}
        progress={progress}
        role={user.role}
      />

      <div className="toolbar">
        <div>
          <b>Seu caderno</b>
          <span>
            As respostas, fotos, vídeos, textos e datas aparecem
            diretamente nos requisitos.
          </span>
        </div>

        <button
          className="primary"
          type="button"
          onClick={() =>
            generateDigitalNotebook({
              scout: user,
              classes,
              submissions: mapScoutSubmissions(user.id, db)
            })
          }
        >
          📖 Gerar Caderno Digital
        </button>
      </div>

      <ClassPage
        user={user}
        scout={user}
        selected={selected}
        db={db}
        setDb={setDb}
      />
    </>
  );
}

function LeadershipPanel({ user, db, setDb }) {
  const scouts = db.users
    .filter((item) => item.role === 'DESBRAVADOR')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const [selectedId, setSelectedId] = useState(
    scouts[0]?.id || ''
  );
  const [selected, setSelected] = useState('amigo');
  const [search, setSearch] = useState('');

  const filtered = scouts.filter((scout) =>
    `${scout.name} ${scout.username}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const scout =
    scouts.find((item) => item.id === selectedId) ||
    filtered[0] ||
    scouts[0];

  const progress = useProgress(scout?.id, db);

  if (!scout) {
    return (
      <div className="panel">
        <h2>Nenhum desbravador cadastrado.</h2>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <span className="small-label">LIDERANÇA</span>
          <h2>Revisão das classes</h2>
          <p>Você pode alternar entre as seis classes.</p>
        </div>

        <div className="scout-picker">
          <input
            placeholder="Pesquisar desbravador…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {filtered.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="summary-grid">
        {classes.map((classData) => (
          <div
            key={classData.slug}
            className="summary-card"
            style={{ '--class-color': classData.color }}
          >
            <b>{classData.name}</b>
            <strong>{progress[classData.slug]?.done || 0}/{classData.total}</strong>
            <span>aprovados pela liderança</span>
          </div>
        ))}
      </div>

      {/* A Diretoria/Liderança vê a mesma checklist do Desbravador.
          Ela fica preenchida após a aprovação da liderança e perde
          a confirmação se o Regional reprovar o requisito. */}
      <Checklist
        selected={selected}
        setSelected={setSelected}
        progress={progress}
        role="ADMIN"
      />

      <ClassSelector
        selected={selected}
        setSelected={setSelected}
      />

      <ClassPage
        user={user}
        scout={scout}
        selected={selected}
        db={db}
        setDb={setDb}
      />
    </div>
  );
}


function DirectorSettings({ user, db, setDb, onUserChange }) {
  const current = db.users.find((item) => item.id === user.id) || user;
  const [username, setUsername] = useState(current.username || '');
  const [password, setPassword] = useState(current.password || '');
  const [saved, setSaved] = useState('');

  const save = async (event) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    const duplicate = db.users.some((item) => item.username.toLowerCase() === username.trim().toLowerCase() && item.id !== user.id);
    if (duplicate) { alert('Este nome de usuário já está cadastrado.'); return; }

    try {
      await manageUser('update', {
        userId: user.id,
        username: username.trim(),
        password,
        name: current.name,
        role: current.role,
        birth: current.birth,
        club: current.club,
        unit: current.unit
      });
      const refreshed = await loadDB();
      setDb(refreshed);
      const updated = refreshed.users.find((item) => item.id === user.id);
      onUserChange?.(updated);
      setSaved('Seus dados de acesso foram atualizados.');
    } catch (error) {
      alert(error.message || 'Não foi possível atualizar o acesso.');
    }
  };

  return (
    <section className="director-settings">
      <div className="panel-head"><div><span className="small-label">SEGURANÇA DO DIRETOR</span><h2>Meu acesso</h2><p>O Diretor também pode alterar o próprio usuário e a própria senha.</p></div></div>
      <form onSubmit={save} className="director-settings-form">
        <label>Usuário<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>Senha<input value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button className="primary" type="submit">Salvar meu acesso</button>
        {saved && <div className="alert success">{saved}</div>}
      </form>
    </section>
  );
}

function DirectorPanel({ user, db, setDb, onUserChange }) {
  return (
    <div className="panel">
      <DirectorSettings user={user} db={db} setDb={setDb} onUserChange={onUserChange} />
      <AccountManager db={db} setDb={setDb} />
    </div>
  );
}

function RegionalPanel({ user, db, setDb }) {
  const scouts = db.users
    .filter((item) => item.role === 'DESBRAVADOR')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const [selectedId, setSelectedId] = useState(
    scouts[0]?.id || ''
  );
  const [selected, setSelected] = useState('amigo');
  const [search, setSearch] = useState('');

  const filtered = scouts.filter((scout) =>
    `${scout.name} ${scout.username}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const scout =
    scouts.find((item) => item.id === selectedId) ||
    filtered[0] ||
    scouts[0];

  const progress = useProgress(scout?.id, db);

  if (!scout) {
    return (
      <div className="panel">
        <h2>Nenhum desbravador cadastrado.</h2>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <span className="small-label">REGIONAL</span>
          <h2>Visualização e aprovação final</h2>
          <p>
            A checklist regional só confirma requisitos aprovados
            pelo próprio Regional.
          </p>
        </div>

        <div className="scout-picker">
          <input
            placeholder="Pesquisar desbravador…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {filtered.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="regional-note">
        A Liderança precisa aprovar antes do Regional. A aprovação
        do Regional é a confirmação final; uma devolução desfaz a
        confirmação.
      </div>

      <Checklist
        selected={selected}
        setSelected={setSelected}
        progress={progress}
        role="REGIONAL"
      />

      <ClassSelector
        selected={selected}
        setSelected={setSelected}
      />

      <ClassPage
        user={user}
        scout={scout}
        selected={selected}
        db={db}
        setDb={setDb}
      />
    </div>
  );
}

function mapScoutSubmissions(id, db) {
  const output = {};

  for (const classData of classes) {
    for (const item of flattenRequirements(classData)) {
      output[`${classData.slug}:${item.id}`] =
        db.submissions[`${id}:${classData.slug}:${item.id}`];
    }
  }

  return output;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [db, setDb] = useState(null);

  const handleLogin = (loggedUser, loadedDB) => {
    setUser(loggedUser);
    setDb(loadedDB);
  };

  if (!user || !db) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <>
      <Topbar user={user} onLogout={() => setUser(null)} />

      <main className="page">
        {user.role === 'DESBRAVADOR' ? (
          <ScoutPanel
            user={user}
            db={db}
            setDb={setDb}
          />
        ) : user.role === 'DIRECTOR' ? (
          <DirectorPanel
            user={user}
            db={db}
            setDb={setDb}
            onUserChange={setUser}
          />
        ) : user.role === 'ADMIN' ? (
          <LeadershipPanel
            user={user}
            db={db}
            setDb={setDb}
          />
        ) : (
          <RegionalPanel
            user={user}
            db={db}
            setDb={setDb}
          />
        )}

        <footer>
          Protótipo local · dados salvos neste navegador.
        </footer>
      </main>
    </>
  );
}
