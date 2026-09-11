import { supabase } from "@/lib/supabase";

export async function deletarArquivo(fileId, filePath) {
  const { error: dbError } = await supabase
    .from("files")
    .delete()
    .eq("id", fileId);

  if (dbError) throw dbError;

  if (filePath) {
    await supabase.storage.from("files").remove([filePath]);
  }
}
