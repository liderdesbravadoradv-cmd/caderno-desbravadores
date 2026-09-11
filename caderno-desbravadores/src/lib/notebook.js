import { getEvidenceFile } from './storage';

const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase() || 'desbravador';
const blobData = blob => new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(blob); });

export async function generateDigitalNotebook({scout, classes, submissions}) {
  const sections=[];
  for(const c of classes){
    const reqHtml=[];
    for(const [section,items] of c.requirements){
      const itemHtml=[];
      for(const item of items){
        const s=submissions[`${c.slug}:${item.id}`];
        if(!s || !['adminApproved','regionalApproved'].includes(s.status)) continue;
        let media='';
        for(const f of (s.files||[])){
          const full=await getEvidenceFile(f.id);
          if(!full) continue;
          const data=await blobData(full.blob);
          if(f.type?.startsWith('image/')) media += `<img class="photo" src="${data}" alt="${esc(f.name)}">`;
          else if(f.type?.startsWith('video/')) media += `<video class="video" controls preload="metadata" src="${data}"></video>`;
          else if(f.type==='application/pdf') media += `<a class="pdf" href="${data}" download="${esc(f.name)}">📄 Abrir PDF: ${esc(f.name)}</a>`;
          else media += `<a class="pdf" href="${data}" download="${esc(f.name)}">📎 ${esc(f.name)}</a>`;
        }
        if(s.youtube){ const m=String(s.youtube).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/i); if(m) media += `<div class="youtube"><iframe src="https://www.youtube.com/embed/${m[1]}" allowfullscreen></iframe></div>`; }
        itemHtml.push(`<article class="req"><div class="num">${esc(item.number)}</div><div><div class="rid">${esc(item.sectionCode)} · requisito ${esc(item.number)}</div><h3>${esc(item.text)}</h3>${item.sub?.length?`<ul>${item.sub.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<div class="meta">📅 ${esc(s.date||'—')} · ✓ ${s.status==='regionalApproved'?'Confirmado pelo regional':'Aprovado pela liderança'}</div>${s.text?`<div class="answer"><b>Resposta / relatório</b><p>${esc(s.text).replace(/\n/g,'<br>')}</p></div>`:''}${media?`<div class="media">${media}</div>`:''}</div></article>`);
      }
      if(itemHtml.length) reqHtml.push(`<section><h2>${esc(section)}</h2>${itemHtml.join('')}</section>`);
    }
    sections.push(`<div class="class"><div class="class-title"><span>Classe de</span><strong>${esc(c.name)}</strong><small>${esc(c.advancedName||'')}</small></div>${reqHtml.join('')||'<p class="empty">Nenhum requisito confirmado para esta classe.</p>'}</div>`);
  }
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Caderno de ${esc(scout.name)}</title><style>body{font-family:Arial,sans-serif;background:#f4f6f8;color:#243342;margin:0}.wrap{max-width:1000px;margin:auto;background:white;min-height:100vh}.cover{padding:70px 60px;text-align:center;background:linear-gradient(135deg,#eef5fb,#fff);border-bottom:1px solid #dbe4ec}.cover h1{font-size:38px;margin:8px}.cover p{color:#667}.identity{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;text-align:left;max-width:650px;margin:35px auto 0}.identity div{padding:12px;border:1px solid #e1e8ef;border-radius:10px}.class{padding:35px 55px;page-break-before:always}.class-title{padding:20px;border-radius:16px;background:#eaf2f8}.class-title span,.class-title small{display:block;color:#607487}.class-title strong{font-size:30px;display:block;margin:3px 0 5px}.class section{margin-top:28px}.class section>h2{font-size:21px;border-bottom:2px solid #dce5ed;padding-bottom:8px}.req{display:grid;grid-template-columns:42px 1fr;gap:15px;padding:20px 0;border-bottom:1px solid #e5ebf0}.num{font-weight:700;font-size:18px;background:#eef3f7;border-radius:10px;width:42px;height:42px;display:grid;place-items:center}.rid{font-size:12px;color:#758797;text-transform:uppercase}.req h3{margin:5px 0 10px}.meta{font-size:13px;color:#5f7384;margin:10px 0}.answer{background:#fafbfd;border:1px solid #e1e8ef;border-radius:10px;padding:12px}.photo{display:block;max-width:100%;max-height:650px;margin:10px 0;border-radius:10px}.video{display:block;width:100%;max-height:650px;margin:10px 0;border-radius:10px;background:#000}.youtube iframe{width:100%;height:420px;border:0;border-radius:10px}.pdf{display:block;padding:12px;background:#f2f6f9;border-radius:8px;margin:8px 0;color:#245b82;text-decoration:none}.empty{text-align:center;color:#778896;padding:30px}@media print{body{background:#fff}.wrap{max-width:none}.class{padding:25px 35px}} </style></head><body><div class="wrap"><header class="cover"><div>CLUBE DE DESBRAVADORES</div><h1>CADERNO DE CLASSES</h1><p>Caderno digital individual</p><div class="identity"><div><b>Nome:</b><br>${esc(scout.name)}</div><div><b>Nascimento:</b><br>${esc(scout.birth||'—')}</div><div><b>Clube:</b><br>${esc(scout.club||'—')}</div><div><b>Unidade:</b><br>${esc(scout.unit||'—')}</div></div></header>${sections.join('')}</div></body></html>`;
  const blob=new Blob([html],{type:'text/html;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`caderno-${slug(scout.name)}.html`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000);
}
