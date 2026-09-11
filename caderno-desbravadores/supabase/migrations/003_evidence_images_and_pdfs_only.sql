-- Evidências futuras: somente imagens e PDFs.
-- Vídeos deixam de ocupar o Storage; vídeos continuam disponíveis
-- quando já existirem e podem ser exibidos pelo aplicativo.
update storage.buckets
set allowed_mime_types = array['image/*','application/pdf']
where id = 'evidence';
