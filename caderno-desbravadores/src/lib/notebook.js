import { getEvidenceFile } from './storage';

const esc = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

const slug = (value) => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase() || 'desbravador';

const blobData = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

function createChecklistSvg(classes, submissions) {
  const width = 1000;
  const height = 1280;
  const cardWidth = 470;
  const cardHeight = 340;
  const columns = 10;
  const cellWidth = 43;
  const cardMarkup = classes.map((classData, classIndex) => {
    const x = 20 + (classIndex % 2) * 490;
    const y = 160 + Math.floor(classIndex / 2) * 360;
    const requirements = classData.requirements.flatMap(([section, items]) =>
      items.map((item) => ({ ...item, section }))
    );
    const completed = requirements.filter((item) => {
      const submission = submissions[`${classData.slug}:${item.id}`];
      return ['adminApproved', 'regionalApproved'].includes(submission?.status);
    }).length;
    const percent = requirements.length ? Math.round((completed / requirements.length) * 100) : 0;
    const rows = Math.ceil(requirements.length / columns);
    const cellHeight = Math.min(34, (cardHeight - 115) / Math.max(rows, 1));
    const checks = requirements.map((item, index) => {
      const isComplete = ['adminApproved', 'regionalApproved'].includes(
        submissions[`${classData.slug}:${item.id}`]?.status
      );
      const cellX = x + 20 + (index % columns) * cellWidth;
      const cellY = y + 102 + Math.floor(index / columns) * cellHeight;
      const color = esc(classData.color);
      const mark = isComplete
        ? `<rect x="${cellX}" y="${cellY}" width="15" height="15" rx="3" fill="${color}"/><path d="M${cellX + 3} ${cellY + 8}l3 3 6-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<rect x="${cellX}" y="${cellY}" width="15" height="15" rx="3" fill="#fff" stroke="#aab6c2" stroke-width="1.5"/>`;
      return `${mark}<text x="${cellX + 20}" y="${cellY + 12}" class="item-label">${esc(item.sectionCode)}-${esc(item.number)}</text>`;
    }).join('');

    return `<g>
      <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="16" fill="#fff" stroke="${esc(classData.color)}" stroke-width="3"/>
      <rect x="${x}" y="${y}" width="${cardWidth}" height="58" rx="14" fill="${esc(classData.color)}"/>
      <path d="M${x} ${y + 44}h${cardWidth}v14h-${cardWidth}z" fill="${esc(classData.color)}"/>
      <text x="${x + 18}" y="${y + 37}" class="class-name">${esc(classData.name)}</text>
      <text x="${x + cardWidth - 18}" y="${y + 36}" class="count" text-anchor="end">${completed}/${requirements.length}</text>
      <text x="${x + 20}" y="${y + 82}" class="percent">${percent}% aprovado pela diretoria</text>
      <rect x="${x + 20}" y="${y + 88}" width="${cardWidth - 40}" height="7" rx="4" fill="#e7edf3"/>
      <rect x="${x + 20}" y="${y + 88}" width="${(cardWidth - 40) * percent / 100}" height="7" rx="4" fill="${esc(classData.color)}"/>
      ${checks}
    </g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Checklist de progresso das seis classes">
    <style>
      text{font-family:Arial,Helvetica,sans-serif;fill:#243342}
      .title{font-size:27px;font-weight:700;fill:#173f73}
      .subtitle{font-size:15px;fill:#617386}
      .class-name{font-size:23px;font-weight:700;fill:#fff}
      .count{font-size:20px;font-weight:700;fill:#fff}
      .percent{font-size:15px;fill:#53677a}
      .item-label{font-size:11px;fill:#405367}
    </style>
    <rect width="100%" height="100%" fill="#f4f6f8"/>
    <text x="20" y="54" class="title">Progresso das classes</text>
    <text x="20" y="78" class="subtitle">Itens marcados foram aprovados pela diretoria.</text>
    ${cardMarkup}
    <g transform="translate(21 1248)">
      <rect width="15" height="15" rx="3" fill="#14509a"/>
      <path d="M3 8l3 3 6-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="23" y="12" class="subtitle">Aprovado</text>
      <rect x="132" width="15" height="15" rx="3" fill="#fff" stroke="#aab6c2" stroke-width="1.5"/>
      <text x="155" y="12" class="subtitle">Pendente ou em análise</text>
    </g>
  </svg>`;
}

export async function generateDigitalNotebook({ scout, classes, submissions }) {
  const checklistImage = await blobData(
    new Blob([createChecklistSvg(classes, submissions)], { type: 'image/svg+xml;charset=utf-8' })
  );
  const sections = [];

  for (const classData of classes) {
    const requirementSections = [];

    for (const [section, items] of classData.requirements) {
      const itemHtml = [];

      for (const item of items) {
        const submission = submissions[`${classData.slug}:${item.id}`];
        if (!submission || !['adminApproved', 'regionalApproved'].includes(submission.status)) continue;

        let media = '';
        for (const file of submission.files || []) {
          const full = await getEvidenceFile(file.id);
          if (!full) continue;
          const data = await blobData(full.blob);
          if (file.type?.startsWith('image/')) {
            media += `<img class="photo" src="${data}" alt="${esc(file.name)}">`;
          } else if (file.type?.startsWith('video/')) {
            media += `<video class="video" controls preload="metadata" src="${data}"></video>`;
          } else if (file.type === 'application/pdf') {
            media += `<a class="pdf" href="${data}" download="${esc(file.name)}">📄 Abrir PDF: ${esc(file.name)}</a>`;
          } else {
            media += `<a class="pdf" href="${data}" download="${esc(file.name)}">📎 ${esc(file.name)}</a>`;
          }
        }

        if (submission.youtube) {
          const match = String(submission.youtube).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/i);
          if (match) media += `<div class="youtube"><iframe src="https://www.youtube.com/embed/${match[1]}" allowfullscreen></iframe></div>`;
        }

        itemHtml.push(`<article class="req">
          <div class="num">${esc(item.number)}</div>
          <div>
            <div class="rid">${esc(item.sectionCode)} · requisito ${esc(item.number)}</div>
            <h3>${esc(item.text)}</h3>
            ${item.sub?.length ? `<ul>${item.sub.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}
            <div class="meta">📅 ${esc(submission.date || '—')} · ✓ ${submission.status === 'regionalApproved' ? 'Confirmado pelo regional' : 'Aprovado pela liderança'}</div>
            ${submission.text ? `<div class="answer"><b>Resposta / relatório</b><p>${esc(submission.text).replace(/\n/g, '<br>')}</p></div>` : ''}
            ${media ? `<div class="media">${media}</div>` : ''}
          </div>
        </article>`);
      }

      if (itemHtml.length) requirementSections.push(`<section><h2>${esc(section)}</h2>${itemHtml.join('')}</section>`);
    }

    sections.push(`<div class="class">
      <div class="class-title"><span>Classe de</span><strong>${esc(classData.name)}</strong><small>${esc(classData.advancedName || '')}</small></div>
      ${requirementSections.join('') || '<p class="empty">Nenhum requisito confirmado para esta classe.</p>'}
    </div>`);
  }

  const html = `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Caderno de ${esc(scout.name)}</title>
      <style>
        body{font-family:Arial,sans-serif;background:#f4f6f8;color:#243342;margin:0}
        .wrap{max-width:1000px;margin:auto;background:#fff;min-height:100vh}
        .cover{padding:70px 60px;text-align:center;background:linear-gradient(135deg,#eef5fb,#fff);border-bottom:1px solid #dbe4ec}
        .cover h1{font-size:38px;margin:8px}.cover p{color:#667}
        .identity{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;text-align:left;max-width:650px;margin:35px auto 0}
        .identity div{padding:12px;border:1px solid #e1e8ef;border-radius:10px}
        .checklist-overview{padding:28px 35px;page-break-before:always;page-break-after:always}
        .checklist-overview h2{margin:0 0 14px;color:#173f73;font-size:25px}
        .checklist-overview img{display:block;width:100%;height:auto;max-height:980px;object-fit:contain}
        .class{padding:35px 55px;page-break-before:always}
        .class-title{padding:20px;border-radius:16px;background:#eaf2f8}
        .class-title span,.class-title small{display:block;color:#607487}
        .class-title strong{font-size:30px;display:block;margin:3px 0 5px}
        .class section{margin-top:28px}.class section>h2{font-size:21px;border-bottom:2px solid #dce5ed;padding-bottom:8px}
        .req{display:grid;grid-template-columns:42px 1fr;gap:15px;padding:20px 0;border-bottom:1px solid #e5ebf0}
        .num{font-weight:700;font-size:18px;background:#eef3f7;border-radius:10px;width:42px;height:42px;display:grid;place-items:center}
        .rid{font-size:12px;color:#758797;text-transform:uppercase}.req h3{margin:5px 0 10px}
        .meta{font-size:13px;color:#5f7384;margin:10px 0}
        .answer{background:#fafbfd;border:1px solid #e1e8ef;border-radius:10px;padding:12px}
        .photo{display:block;max-width:100%;max-height:650px;margin:10px 0;border-radius:10px}
        .video{display:block;width:100%;max-height:650px;margin:10px 0;border-radius:10px;background:#000}
        .youtube iframe{width:100%;height:420px;border:0;border-radius:10px}
        .pdf{display:block;padding:12px;background:#f2f6f9;border-radius:8px;margin:8px 0;color:#245b82;text-decoration:none}
        .empty{text-align:center;color:#778896;padding:30px}
        @media print{body{background:#fff}.wrap{max-width:none}.checklist-overview{padding:10mm 8mm}.checklist-overview img{max-height:260mm}.class{padding:25px 35px}}
        @media(max-width:600px){.cover{padding:40px 20px}.checklist-overview{padding:18px 12px}.class{padding:25px 20px}}
      </style>
    </head>
    <body><div class="wrap">
      <header class="cover">
        <div>CLUBE DE DESBRAVADORES</div><h1>CADERNO DE CLASSES</h1><p>Caderno digital individual</p>
        <div class="identity">
          <div><b>Nome:</b><br>${esc(scout.name)}</div>
          <div><b>Nascimento:</b><br>${esc(scout.birth || '—')}</div>
          <div><b>Clube:</b><br>${esc(scout.club || '—')}</div>
          <div><b>Unidade:</b><br>${esc(scout.unit || '—')}</div>
        </div>
      </header>
      <section class="checklist-overview">
        <h2>Checklist das classes</h2>
        <img src="${checklistImage}" alt="Imagem estática do progresso dos requisitos nas seis classes">
      </section>
      ${sections.join('')}
    </div></body>
  </html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `caderno-${slug(scout.name)}.html`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
