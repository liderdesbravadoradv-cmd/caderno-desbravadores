import { jsPDF } from 'jspdf';
import { getEvidenceFile } from './storage';

const margin = 15;
const pageWidth = 210;
const pageHeight = 297;
const contentWidth = pageWidth - margin * 2;
const bottom = pageHeight - 15;

export async function generateScoutPDF({ scout, classes, progress, submissions, onProgress = () => {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const approvedEntries = classes.flatMap((classData) => classData.requirements.flatMap(([, items]) =>
    items
      .map((item) => ({ classData, item, submission: submissions[`${classData.slug}:${item.id}`] }))
      .filter(({ submission }) => ['adminApproved', 'regionalApproved'].includes(submission?.status))
  ));
  const fileCount = approvedEntries.reduce((count, entry) => count + (entry.submission.files?.length || 0), 0);
  const totalBytes = approvedEntries.reduce((sum, entry) => sum + (entry.submission.files || []).reduce((fileSum, file) => fileSum + (Number(file.size) || 0), 0), 0);
  let y = 18;
  let completed = 0;

  const newPage = () => {
    doc.addPage();
    y = 18;
  };

  const ensureSpace = (height = 8) => {
    if (y + height > bottom) newPage();
  };

  const write = (value, { size = 9, bold = false, color = [40, 53, 67], indent = 0, gap = 1.5 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(value ?? ''), contentWidth - indent);
    const lineHeight = size * 0.42 + 1.7;
    for (const text of lines) {
      ensureSpace(lineHeight);
      doc.text(text, margin + indent, y);
      y += lineHeight;
    }
    y += gap;
  };

  const writeLink = (label, url) => {
    const size = 9;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(0, 80, 160);
    const lines = doc.splitTextToSize(label, contentWidth);
    const lineHeight = size * 0.42 + 1.7;
    for (const text of lines) {
      ensureSpace(lineHeight);
      doc.text(text, margin, y);
      doc.link(margin, y - size * 0.35, Math.min(contentWidth, doc.getTextWidth(text)), lineHeight, { url });
      y += lineHeight;
    }
    y += 1.5;
  };

  const writeImage = async (file) => {
    const { blob } = await getEvidenceFile(file.id);
    const bitmap = await createImageBitmap(blob);
    const maxPixels = 1400;
    const scale = Math.min(1, maxPixels / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const jpeg = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Não foi possível preparar a imagem.')), 'image/jpeg', 0.78);
    });
    const imageBytes = new Uint8Array(await jpeg.arrayBuffer());
    const imageWidth = Math.min(contentWidth, 170);
    const imageHeight = imageWidth * canvas.height / canvas.width;
    const renderedHeight = Math.min(imageHeight, 105);
    const renderedWidth = imageWidth * renderedHeight / imageHeight;
    ensureSpace(renderedHeight + 4);
    doc.addImage(imageBytes, 'JPEG', margin, y, renderedWidth, renderedHeight, undefined, 'FAST');
    y += renderedHeight + 4;
  };

  doc.setFillColor(20, 80, 154);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('CADERNO DE CLASSES', pageWidth / 2, 15, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Desbravadores · Caderno individual', pageWidth / 2, 24, { align: 'center' });

  y = 45;
  write(`Nome: ${scout.name}`, { size: 11, bold: true, color: [20, 80, 154] });
  write(`Nascimento: ${scout.birth || '—'}   Clube: ${scout.club || '—'}   Unidade: ${scout.unit || '—'}`);
  y += 3;

  for (const classData of classes) {
    ensureSpace(20);
    const classColor = hexToRgb(classData.color);
    doc.setFillColor(...classColor);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Classe de ${classData.name}`, margin + 4, y + 6.8);
    y += 14;

    const classProgress = progress[classData.slug] || { done: 0, total: classData.total };
    write(`Progresso: ${classProgress.done}/${classProgress.total} (${classProgress.total ? Math.round(classProgress.done / classProgress.total * 100) : 0}%)`, { bold: true });

    for (const [section, items] of classData.requirements) {
      const approved = items
        .map((item) => ({ item, submission: submissions[`${classData.slug}:${item.id}`] }))
        .filter(({ submission }) => ['adminApproved', 'regionalApproved'].includes(submission?.status));
      if (!approved.length) continue;

      write(section, { size: 10, bold: true, color: classColor, gap: 2 });
      for (const { item, submission } of approved) {
        write(`${item.id}. ${item.text}`, { size: 9, bold: true, gap: 1 });
        if (item.sub?.length) item.sub.forEach((text) => write(text, { size: 8, color: [85, 95, 105], indent: 3, gap: 0.5 }));
        write(`Data: ${submission.date || '—'} · ${submission.status === 'regionalApproved' ? 'Confirmado pelo regional' : 'Aprovado pela liderança'}`, { size: 8, color: [85, 105, 125], gap: 1 });
        if (submission.text) write(`Resposta / relatório: ${submission.text}`, { size: 9, indent: 2 });
        if (submission.comment) write(`Comentário: ${submission.comment}`, { size: 8, color: [85, 95, 105], indent: 2 });

        for (const file of submission.files || []) {
          if (file.type?.startsWith('image/')) {
            try {
              write(`Imagem anexada: ${file.name}`, { size: 8, color: [85, 95, 105], gap: 1 });
              await writeImage(file);
            } catch {
              write(`Imagem indisponível: ${file.name}`, { size: 8, color: [120, 75, 65] });
            }
          } else if (file.type?.startsWith('video/')) {
            write(`Vídeo anexado (não reproduzido no PDF): ${file.name}`, { size: 8, color: [85, 95, 105] });
          } else if (file.type === 'application/pdf') {
            write(`PDF anexado: ${file.name}`, { size: 8, color: [85, 95, 105] });
          } else {
            write(`Arquivo anexado: ${file.name}`, { size: 8, color: [85, 95, 105] });
          }
        }

        const youtubeUrl = getYouTubeUrl(submission.youtube);
        if (youtubeUrl) writeLink(`Vídeo no YouTube: ${youtubeUrl}`, youtubeUrl);
        y += 2;
        completed += 1;
        onProgress({ completed, total: approvedEntries.length, fileCount, totalBytes });
      }
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 132, 145);
    doc.text(`Caderno de ${scout.name} · ${page}/${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  const filename = `caderno-${slugify(scout.name)}.pdf`;
  doc.save(filename);
  return { filename };
}

function getYouTubeUrl(value) {
  const match = String(value || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : '';
}

function hexToRgb(hex = '#14509a') {
  const match = String(hex).match(/^#?([\da-f]{6})$/i);
  if (!match) return [20, 80, 154];
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'desbravador';
}
