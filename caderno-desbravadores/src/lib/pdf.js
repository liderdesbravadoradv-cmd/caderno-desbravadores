import { jsPDF } from 'jspdf';
import { getEvidenceFile } from './storage';
import { getClassChecklistLabel } from '../data/classes';

const margin = 15;
const pageWidth = 210;
const contentWidth = pageWidth - margin * 2;

export async function generateScoutPDF({ scout, classes, progress, submissions, onProgress = () => {} }) {
  const measurer = new jsPDF({ unit: 'mm', format: 'a4' });
  const operations = [];
  const approvedEntries = classes.flatMap((classData) => classData.requirements.flatMap(([, items]) =>
    items
      .map((item) => ({ classData, item, submission: submissions[`${classData.slug}:${item.id}`] }))
      .filter(({ submission }) => ['adminApproved', 'regionalApproved'].includes(submission?.status))
  ));
  const fileCount = approvedEntries.reduce((count, entry) => count + (entry.submission.files?.length || 0), 0);
  const totalBytes = approvedEntries.reduce((sum, entry) => sum + (entry.submission.files || []).reduce((fileSum, file) => fileSum + (Number(file.size) || 0), 0), 0);
  let y = 18;
  let completed = 0;

  const write = (value, { size = 9, bold = false, color = [40, 53, 67], indent = 0, gap = 1.5, url } = {}) => {
    measurer.setFont('helvetica', bold ? 'bold' : 'normal');
    measurer.setFontSize(size);
    const lines = measurer.splitTextToSize(String(value ?? ''), contentWidth - indent);
    const lineHeight = size * 0.42 + 1.7;
    for (const text of lines) {
      const lineY = y;
      operations.push({ type: 'text', text, x: margin + indent, y: lineY, size, bold, color });
      if (url) operations.push({ type: 'link', x: margin + indent, y: lineY - size * 0.35, width: Math.min(contentWidth - indent, measurer.getTextWidth(text)), height: lineHeight, url });
      y += lineHeight;
    }
    y += gap;
  };

  const addImage = (bytes, format, x, yPosition, width, height) => {
    operations.push({ type: 'image', bytes, format, x, y: yPosition, width, height });
  };

  const addYouTubeCard = (url) => {
    const card = { x: margin, y, width: 88, height: 30, url };
    operations.push({ type: 'youtubeCard', ...card });
    operations.push({ type: 'link', ...card });
    y += card.height + 3;
  };

  const prepareImage = async (file) => {
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
    const imageWidth = Math.min(contentWidth, 170);
    const imageHeight = imageWidth * canvas.height / canvas.width;
    const renderedHeight = Math.min(imageHeight, 105);
    return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width: imageWidth * renderedHeight / imageHeight, height: renderedHeight };
  };

  operations.push({ type: 'rect', x: 0, y: 0, width: pageWidth, height: 34, color: [20, 80, 154] });
  operations.push({ type: 'text', text: 'CADERNO DE CLASSES', x: pageWidth / 2, y: 15, size: 20, bold: true, color: [255, 255, 255], align: 'center' });
  operations.push({ type: 'text', text: 'Desbravadores · Caderno individual', x: pageWidth / 2, y: 24, size: 10, bold: true, color: [255, 255, 255], align: 'center' });

  y = 45;
  write(`Nome: ${scout.name}`, { size: 11, bold: true, color: [20, 80, 154] });
  write(`Nascimento: ${scout.birth || '—'}   Clube: ${scout.club || '—'}   Unidade: ${scout.unit || '—'}`);
  y += 3;
  write('CHECKLIST DAS CLASSES', { size: 16, bold: true, color: [20, 80, 154], gap: 2 });
  write('Visão geral dos requisitos aprovados e pendentes.', { size: 9, color: [85, 105, 125], gap: 5 });

  const checklistCanvas = drawChecklistCanvas(classes, submissions);
  const checklistPng = await new Promise((resolve, reject) => {
    checklistCanvas.toBlob((result) => result ? resolve(result) : reject(new Error('Não foi possível preparar a imagem da checklist.')), 'image/png');
  });
  const checklistBytes = new Uint8Array(await checklistPng.arrayBuffer());
  const checklistScale = Math.min(contentWidth / checklistCanvas.width, 225 / checklistCanvas.height);
  const checklistWidth = checklistCanvas.width * checklistScale;
  const checklistHeight = checklistCanvas.height * checklistScale;
  addImage(checklistBytes, 'PNG', margin + (contentWidth - checklistWidth) / 2, y, checklistWidth, checklistHeight);
  y += checklistHeight + 3;

  for (const classData of classes) {
    const classColor = hexToRgb(classData.color);
    operations.push({ type: 'roundedRect', x: margin, y, width: contentWidth, height: 10, radius: 2, color: classColor });
    operations.push({ type: 'text', text: `Classe de ${classData.name}`, x: margin + 4, y: y + 6.8, size: 11, bold: true, color: [255, 255, 255] });
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
              const image = await prepareImage(file);
              addImage(image.bytes, 'JPEG', margin, y, image.width, image.height);
              y += image.height + 4;
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
        if (youtubeUrl) addYouTubeCard(youtubeUrl);
        y += 2;
        completed += 1;
        onProgress({ completed, total: approvedEntries.length, fileCount, totalBytes });
      }
    }
  }

  const pageHeight = Math.ceil(y + 15);
  const doc = new jsPDF({ unit: 'mm', format: [pageWidth, pageHeight], compress: true });
  for (const operation of operations) {
    if (operation.type === 'rect' || operation.type === 'roundedRect') {
      doc.setFillColor(...operation.color);
      if (operation.type === 'roundedRect') doc.roundedRect(operation.x, operation.y, operation.width, operation.height, operation.radius, operation.radius, 'F');
      else doc.rect(operation.x, operation.y, operation.width, operation.height, 'F');
    } else if (operation.type === 'text') {
      doc.setFont('helvetica', operation.bold ? 'bold' : 'normal');
      doc.setFontSize(operation.size);
      doc.setTextColor(...operation.color);
      doc.text(operation.text, operation.x, operation.y, operation.align ? { align: operation.align } : undefined);
    } else if (operation.type === 'link') {
      doc.link(operation.x, operation.y, operation.width, operation.height, { url: operation.url });
    } else if (operation.type === 'youtubeCard') {
      doc.setFillColor(31, 41, 55);
      doc.roundedRect(operation.x, operation.y, operation.width, operation.height, 3, 3, 'F');
      doc.setFillColor(230, 33, 23);
      doc.roundedRect(operation.x + 3, operation.y + 5, 21, 20, 3, 3, 'F');
      doc.setFillColor(255, 255, 255);
      doc.triangle(operation.x + 11, operation.y + 10, operation.x + 11, operation.y + 20, operation.x + 18, operation.y + 15, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.text('ASSISTIR NO YOUTUBE', operation.x + 29, operation.y + 13);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(218, 226, 235);
      doc.text('Clique para abrir o vídeo', operation.x + 29, operation.y + 21);
    } else if (operation.type === 'image') {
      doc.addImage(operation.bytes, operation.format, operation.x, operation.y, operation.width, operation.height, undefined, 'FAST');
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 132, 145);
  doc.text(`Caderno de ${scout.name} · Página única`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  const filename = `caderno-${slugify(scout.name)}.pdf`;
  doc.save(filename);
  return { filename };
}

function drawChecklistCanvas(classes, submissions) {
  const width = 1000;
  const cardWidth = 470;
  const columns = 10;
  const cellWidth = 43;
  const cellHeight = 22;
  const cards = classes.map((classData) => {
    const requirements = classData.requirements.flatMap(([, items]) => items);
    const completed = requirements.filter((item) => ['adminApproved', 'regionalApproved'].includes(submissions[`${classData.slug}:${item.id}`]?.status)).length;
    const rows = Math.ceil(requirements.length / columns);
    return { classData, requirements, completed, height: 95 + rows * cellHeight };
  });

  const rowPositions = [];
  let nextCardY = 86;
  for (let index = 0; index < cards.length; index += 2) {
    const rowHeight = Math.max(cards[index].height, cards[index + 1]?.height || 0);
    rowPositions.push({ y: nextCardY, height: rowHeight });
    nextCardY += rowHeight + 12;
  }
  const legendY = nextCardY;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = legendY + 34;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f4f6f8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#173f73';
  context.font = 'bold 24px Arial, sans-serif';
  context.fillText('Progresso das classes', 20, 36);
  context.fillStyle = '#617386';
  context.font = '13px Arial, sans-serif';
  context.fillText('Itens marcados foram aprovados pela diretoria.', 20, 57);

  cards.forEach((card, classIndex) => {
    const { classData, requirements, completed } = card;
    const x = 20 + (classIndex % 2) * 490;
    const { y } = rowPositions[Math.floor(classIndex / 2)];
    const color = `#${hexToRgb(classData.color).map((part) => part.toString(16).padStart(2, '0')).join('')}`;
    const percent = requirements.length ? Math.round((completed / requirements.length) * 100) : 0;

    context.fillStyle = '#fff';
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(x, y, cardWidth, card.height, 16);
    context.fill();
    context.stroke();
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(x, y, cardWidth, 46, 14);
    context.fill();
    context.fillRect(x, y + 32, cardWidth, 14);
    context.fillStyle = '#fff';
    context.font = 'bold 20px Arial, sans-serif';
    context.fillText(getClassChecklistLabel(classData), x + 18, y + 30);
    context.font = 'bold 18px Arial, sans-serif';
    context.textAlign = 'right';
    context.fillText(`${completed}/${requirements.length}`, x + cardWidth - 18, y + 29);
    context.textAlign = 'left';
    context.fillStyle = '#53677a';
    context.font = '13px Arial, sans-serif';
    context.fillText(`${percent}% aprovado pela diretoria`, x + 20, y + 64);
    context.fillStyle = '#e7edf3';
    context.fillRect(x + 20, y + 70, cardWidth - 40, 6);
    context.fillStyle = color;
    context.fillRect(x + 20, y + 70, (cardWidth - 40) * percent / 100, 6);

    requirements.forEach((item, index) => {
      const isComplete = ['adminApproved', 'regionalApproved'].includes(submissions[`${classData.slug}:${item.id}`]?.status);
      const cellX = x + 20 + (index % columns) * cellWidth;
      const cellY = y + 86 + Math.floor(index / columns) * cellHeight;
      context.fillStyle = isComplete ? color : '#fff';
      context.strokeStyle = isComplete ? color : '#aab6c2';
      context.lineWidth = 1.3;
      context.beginPath();
      context.roundRect(cellX, cellY, 14, 14, 3);
      context.fill();
      context.stroke();
      context.font = 'bold 10px Arial, sans-serif';
      context.fillStyle = '#405367';
      if (isComplete) {
        context.beginPath();
        context.moveTo(cellX + 3, cellY + 7);
        context.lineTo(cellX + 6, cellY + 10);
        context.lineTo(cellX + 11, cellY + 4);
        context.strokeStyle = '#fff';
        context.lineWidth = 1.8;
        context.stroke();
      }
      context.fillText(`${item.sectionCode}-${item.number}`, cellX + 18, cellY + 11);
    });
  });

  context.fillStyle = '#14509a';
  context.beginPath();
  context.roundRect(21, legendY, 14, 14, 3);
  context.fill();
  context.beginPath();
  context.moveTo(24, legendY + 7);
  context.lineTo(27, legendY + 10);
  context.lineTo(32, legendY + 4);
  context.strokeStyle = '#fff';
  context.lineWidth = 1.8;
  context.stroke();
  context.fillStyle = '#617386';
  context.font = '13px Arial, sans-serif';
  context.fillText('Aprovado', 42, legendY + 11);
  context.fillStyle = '#fff';
  context.strokeStyle = '#aab6c2';
  context.lineWidth = 1.3;
  context.beginPath();
  context.roundRect(139, legendY, 14, 14, 3);
  context.fill();
  context.stroke();
  context.fillStyle = '#617386';
  context.fillText('Pendente ou em análise', 160, legendY + 11);
  return canvas;
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
