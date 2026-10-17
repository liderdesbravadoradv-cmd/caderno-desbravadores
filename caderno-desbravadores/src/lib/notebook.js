import { getEvidenceFile } from './storage';
import { getClassChecklistLabel } from '../data/classes';

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

export function createChecklistSvg(classes, submissions) {
  const width = 1000;
  const cardWidth = 470;
  const columns = 10;
  const cellWidth = 43;
  const cellHeight = 22;
  const cards = classes.map((classData) => {
    const requirements = classData.requirements.flatMap(([section, items]) =>
      items.map((item) => ({ ...item, section }))
    );
    const completed = requirements.filter((item) => {
      const submission = submissions[`${classData.slug}:${item.id}`];
      return ['adminApproved', 'regionalApproved'].includes(submission?.status);
    }).length;
    const percent = requirements.length ? Math.round((completed / requirements.length) * 100) : 0;
    const rows = Math.ceil(requirements.length / columns);
    return {
      classData,
      requirements,
      completed,
      percent,
      rows,
      cardHeight: 95 + rows * cellHeight
    };
  });

  const rowPositions = [];
  let nextCardY = 86;
  for (let index = 0; index < cards.length; index += 2) {
    const rowHeight = Math.max(cards[index].cardHeight, cards[index + 1]?.cardHeight || 0);
    rowPositions.push({ y: nextCardY, height: rowHeight });
    nextCardY += rowHeight + 12;
  }
  const legendY = nextCardY - 12 + 12;
  const height = legendY + 34;

  const cardMarkup = cards.map((card, classIndex) => {
    const { classData, requirements, completed, percent, rows } = card;
    const x = 20 + (classIndex % 2) * 490;
    const row = rowPositions[Math.floor(classIndex / 2)];
    const y = row.y;
    const cardHeight = row.height;
    const checks = requirements.map((item, index) => {
      const isComplete = ['adminApproved', 'regionalApproved'].includes(
        submissions[`${classData.slug}:${item.id}`]?.status
      );
      const cellX = x + 20 + (index % columns) * cellWidth;
      const cellY = y + 86 + Math.floor(index / columns) * cellHeight;
      const color = esc(classData.color);
      const mark = isComplete
        ? `<rect x="${cellX}" y="${cellY}" width="14" height="14" rx="3" fill="${color}"/><path d="M${cellX + 3} ${cellY + 7}l3 3 5-6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<rect x="${cellX}" y="${cellY}" width="14" height="14" rx="3" fill="#fff" stroke="#aab6c2" stroke-width="1.3"/>`;
      return `${mark}<text x="${cellX + 18}" y="${cellY + 11}" class="item-label">${esc(item.sectionCode)}-${esc(item.number)}</text>`;
    }).join('');

    return `<g>
      <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="16" fill="#fff" stroke="${esc(classData.color)}" stroke-width="3"/>
      <rect x="${x}" y="${y}" width="${cardWidth}" height="46" rx="14" fill="${esc(classData.color)}"/>
      <path d="M${x} ${y + 32}h${cardWidth}v14h-${cardWidth}z" fill="${esc(classData.color)}"/>
      <text x="${x + 18}" y="${y + 30}" class="class-name">${esc(getClassChecklistLabel(classData))}</text>
      <text x="${x + cardWidth - 18}" y="${y + 29}" class="count" text-anchor="end">${completed}/${requirements.length}</text>
      <text x="${x + 20}" y="${y + 64}" class="percent">${percent}% aprovado pela diretoria</text>
      <rect x="${x + 20}" y="${y + 70}" width="${cardWidth - 40}" height="6" rx="3" fill="#e7edf3"/>
      <rect x="${x + 20}" y="${y + 70}" width="${(cardWidth - 40) * percent / 100}" height="6" rx="3" fill="${esc(classData.color)}"/>
      ${checks}
    </g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Checklist de progresso das seis classes">
    <style>
      text{font-family:Arial,Helvetica,sans-serif;fill:#243342}
      .title{font-size:24px;font-weight:700;fill:#173f73}
      .subtitle{font-size:13px;fill:#617386}
      .class-name{font-size:20px;font-weight:700;fill:#fff}
      .count{font-size:18px;font-weight:700;fill:#fff}
      .percent{font-size:13px;fill:#53677a}
      .item-label{font-size:10px;fill:#405367}
    </style>
    <rect width="100%" height="100%" fill="#f4f6f8"/>
    <text x="20" y="36" class="title">Progresso das classes</text>
    <text x="20" y="57" class="subtitle">Itens marcados foram aprovados pela diretoria.</text>
    ${cardMarkup}
    <g transform="translate(21 ${legendY})">
      <rect width="14" height="14" rx="3" fill="#14509a"/>
      <path d="M3 7l3 3 5-6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="21" y="11" class="subtitle">Aprovado</text>
      <rect x="118" width="14" height="14" rx="3" fill="#fff" stroke="#aab6c2" stroke-width="1.3"/>
      <text x="139" y="11" class="subtitle">Pendente ou em análise</text>
    </g>
  </svg>`;
}

export async function generateDigitalNotebook({ scout, classes, submissions, printWindow, onProgress = () => {} }) {
  const approvedFiles = Object.values(submissions)
    .filter((submission) => ['adminApproved', 'regionalApproved'].includes(submission?.status))
    .flatMap((submission) => submission.files || []);
  const totalBytes = approvedFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  const totalJobs = classes.reduce((sum, classData) => sum + classData.requirements.reduce((sectionSum, [, items]) => sectionSum + items.filter((item) => ['adminApproved', 'regionalApproved'].includes(submissions[`${classData.slug}:${item.id}`]?.status)).length, 0), 0);
  const imageUrls = [];

  const checklistImage = await blobData(
    new Blob([createChecklistSvg(classes, submissions)], { type: 'image/svg+xml;charset=utf-8' })
  );
  const renderableClasses = classes.map((classData) => ({
    classData,
    sections: classData.requirements.map(([name, items]) => ({
      name,
      items: items
        .map((item) => ({ item, submission: submissions[`${classData.slug}:${item.id}`] }))
        .filter(({ submission }) => submission && ['adminApproved', 'regionalApproved'].includes(submission.status))
        .map((entry) => ({ ...entry, html: '' }))
    }))
  }));

  const jobs = renderableClasses.flatMap(({ sections }) =>
    sections.flatMap(({ items }) => items.map((entry) => async () => {
      let media = '';
      for (const file of entry.submission.files || []) {
        if (file.type?.startsWith('image/')) {
          const full = await getEvidenceFile(file.id);
          if (!full?.blob) continue;
          const imageUrl = URL.createObjectURL(full.blob);
          imageUrls.push(imageUrl);
          media += `<img class="photo" loading="lazy" src="${imageUrl}" alt="${esc(file.name)}">`;
        } else if (file.type?.startsWith('video/')) {
          media += `<span class="print-attachment">📹 Vídeo anexado: ${esc(file.name)} (não reproduzido no PDF)</span>`;
        } else if (file.type === 'application/pdf') {
          media += `<span class="print-attachment">📄 PDF anexado: ${esc(file.name)}</span>`;
        } else {
          media += `<span class="print-attachment">📎 Arquivo anexado: ${esc(file.name)}</span>`;
        }
      }

      if (entry.submission.youtube) {
        const match = String(entry.submission.youtube).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/i);
        if (match) media += `<div class="youtube"><a class="youtube-preview" href="https://www.youtube.com/watch?v=${match[1]}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg" alt="Miniatura do vídeo no YouTube"><span aria-hidden="true">▶</span><strong>Assistir vídeo no YouTube</strong></a></div>`;
      }

      const { item, submission } = entry;
      entry.html = `<article class="req">
        <div class="num">${esc(item.number)}</div>
        <div>
          <div class="rid">${esc(item.sectionCode)} · requisito ${esc(item.number)}</div>
          <h3>${esc(item.text)}</h3>
          ${item.sub?.length ? `<ul>${item.sub.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}
          <div class="meta">📅 ${esc(submission.date || '—')} · ✓ ${submission.status === 'regionalApproved' ? 'Confirmado pelo regional' : 'Aprovado pela liderança'}</div>
          ${submission.text ? `<div class="answer"><b>Resposta / relatório</b><p>${esc(submission.text).replace(/\n/g, '<br>')}</p></div>` : ''}
          ${media ? `<div class="media">${media}</div>` : ''}
        </div>
      </article>`;
    }))
  );

  onProgress({ completed: 0, total: jobs.length, fileCount: approvedFiles.length, totalBytes });

  let nextJob = 0;
  let completedJobs = 0;
  const workerCount = Math.min(2, jobs.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob++];
      await job();
      completedJobs += 1;
      onProgress({ completed: completedJobs, total: jobs.length, fileCount: approvedFiles.length, totalBytes });
    }
  }));

  const sections = renderableClasses.map(({ classData, sections: requirementSections }) => {
    const sectionHtml = requirementSections
      .filter(({ items }) => items.length)
      .map(({ name, items }) => `<section><h2>${esc(name)}</h2>${items.map(({ html }) => html).join('')}</section>`)
      .join('');
    return `<div class="class">
      <div class="class-title"><span>Classe de</span><strong>${esc(classData.name)}</strong><small>${esc(classData.advancedName || '')}</small></div>
      ${sectionHtml || '<p class="empty">Nenhum requisito confirmado para esta classe.</p>'}
    </div>`;
  });

  const html = `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Caderno de ${esc(scout.name)}</title>
      <style>
        body{font-family:Arial,sans-serif;background:#f4f6f8;color:#243342;margin:0}
        .wrap{max-width:1000px;margin:auto;background:#fff;min-height:100vh}
        .cover{padding:42px 44px;text-align:center;background:linear-gradient(135deg,#eef5fb,#fff);border-bottom:1px solid #dbe4ec}
        .cover h1{font-size:38px;margin:5px 0 18px}.cover p{color:#667;margin:4px 0}
        .identity{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;text-align:left;max-width:650px;margin:20px auto 0}
        .identity div{padding:8px;border:1px solid #e1e8ef;border-radius:10px}
        .checklist-overview{padding:18px 24px;page-break-before:always;page-break-after:always}
        .checklist-overview h2{margin:0 0 9px;color:#173f73;font-size:25px}
        .checklist-overview img{display:block;width:100%;height:auto;max-height:980px;object-fit:contain}
        .class{padding:24px 40px;page-break-before:always}
        .class-title{padding:14px;border-radius:16px;background:#eaf2f8}
        .class-title span,.class-title small{display:block;color:#607487}
        .class-title strong{font-size:28px;display:block;margin:2px 0 3px}
        .class section{margin-top:17px}.class section>h2{font-size:20px;border-bottom:2px solid #dce5ed;padding-bottom:5px;margin:0 0 6px}
        .req{display:grid;grid-template-columns:42px 1fr;gap:11px;padding:13px 0;border-bottom:1px solid #e5ebf0}
        .num{font-weight:700;font-size:18px;background:#eef3f7;border-radius:10px;width:42px;height:42px;display:grid;place-items:center}
        .rid{font-size:12px;color:#758797;text-transform:uppercase}.req h3{margin:3px 0 7px}
        .meta{font-size:13px;color:#5f7384;margin:6px 0}
        .answer{background:#fafbfd;border:1px solid #e1e8ef;border-radius:10px;padding:9px}
        .answer p{margin:5px 0}
        .photo{display:block;max-width:100%;max-height:650px;margin:6px 0;border-radius:10px}
        .youtube-preview{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:640px;aspect-ratio:16/9;margin:8px 0;overflow:hidden;border-radius:10px;background:#111;color:#fff;text-decoration:none}
        .youtube-preview img{width:100%;height:100%;object-fit:cover;opacity:.78}
        .youtube-preview>span{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);padding:8px 22px;border-radius:12px;background:#f00;color:#fff;font-size:24px}
        .youtube-preview>strong{position:absolute;bottom:0;left:0;right:0;padding:12px;background:linear-gradient(transparent,#000c);text-align:center}
        .pdf{display:block;padding:9px;background:#f2f6f9;border-radius:8px;margin:5px 0;color:#245b82;text-decoration:none}
        .print-attachment{display:block;padding:9px;background:#f2f6f9;border-radius:8px;margin:5px 0;color:#405367}
        .empty{text-align:center;color:#778896;padding:18px}
        @page{size:A4;margin:14mm}
        @media print{body{background:#fff;font-size:10pt}.wrap{max-width:none;min-height:0}.cover{padding:18mm 10mm}.cover h1{font-size:28pt}.checklist-overview{padding:8mm 6mm;break-before:page;break-after:page}.checklist-overview img{max-height:250mm}.class{padding:8mm 0;break-before:page}.class section,.req,.answer,.youtube-preview{break-inside:avoid}.youtube-preview{color:#111;background:#f2f2f2;border:1px solid #ccc;text-decoration:underline}.youtube-preview img{opacity:.35}.youtube-preview>span{display:none}.youtube-preview>strong{position:static;background:none;color:#111;text-decoration:underline;padding:8px}.youtube-preview:after{content:attr(href);display:block;font-size:8pt;overflow-wrap:anywhere;padding:0 8px 8px}.print-attachment{color:#111}}
        @media(max-width:600px){.cover{padding:30px 16px}.checklist-overview{padding:14px 10px}.class{padding:18px 14px}}
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

  if (!printWindow || printWindow.closed) throw new Error('A janela de impressão foi fechada. Tente gerar o caderno novamente.');
  printWindow.document.open();
  printWindow.addEventListener('beforeunload', () => imageUrls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.document.title = `Caderno de ${scout.name}`;
  printWindow.document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await Promise.all(Array.from(printWindow.document.images, (image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
  }));
  printWindow.focus();
  printWindow.print();
  return { filename: `caderno-${slug(scout.name)}.pdf`, size: totalBytes, destination: 'print' };
}
