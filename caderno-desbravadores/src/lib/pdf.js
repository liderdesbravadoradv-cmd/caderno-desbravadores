import { jsPDF } from 'jspdf';

export function generateScoutPDF({ scout, classes, progress, submissions }) {
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  let y = 18;
  const margin = 14;
  const width = 182;
  const blue = [20,80,154];

  const line = (text, size=9, bold=false, color=[30,45,60]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text), width);
    if(y + lines.length*(size*0.48+2) > 282){ doc.addPage(); y=18; }
    doc.text(lines, margin, y); y += lines.length*(size*0.48+2)+2;
  };

  doc.setFillColor(...blue); doc.rect(0,0,210,32,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.text('CADERNO DE CLASSES',105,14,{align:'center'});
  doc.setFontSize(10); doc.text('Desbravadores · Caderno individual',105,23,{align:'center'});
  y=43;
  line(`Nome: ${scout.name}`,11,true,blue);
  line(`Nascimento: ${scout.birth || '—'}   Clube: ${scout.club || '—'}   Unidade: ${scout.unit || '—'}`,9);
  y += 3;

  classes.forEach(c=>{
    if(y>265){doc.addPage();y=18;}
    doc.setFillColor(...hexToRgb(c.color)); doc.roundedRect(margin,y,width,10,2,2,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text(`Classe de ${c.name}`,margin+4,y+6.8); y+=15;
    const p = progress[c.slug] || { done:0, total:c.total };
    line(`Progresso: ${p.done}/${p.total} (${p.total ? Math.round(p.done/p.total*100) : 0}%)`,9,true);
    c.requirements.forEach(([section, items])=>{
      line(section,10,true,hexToRgb(c.color));
      items.forEach(item=>{
        const sub = submissions[`${c.slug}:${item.id}`];
        const status = sub?.status || 'Não iniciado';
        line(`${item.id}. ${item.text} — ${status}`,8.5,false);
        if(item.sub?.length) item.sub.forEach(s=>line(`   ${s}`,7.5,false,[85,95,105]));
        if(sub?.date) line(`Data registrada: ${sub.date}`,7.5,false,[85,95,105]);
        if(sub?.comment) line(`Comentário: ${sub.comment}`,7.5,false,[85,95,105]);
      });
    });
  });

  doc.save(`caderno-${slugify(scout.name)}.pdf`);
}
function hexToRgb(hex){ const n=parseInt(hex.replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function slugify(s){ return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'desbravador'; }
