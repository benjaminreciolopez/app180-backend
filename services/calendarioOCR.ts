import { api } from "@/services/api";

export async function ocrPreview(files: File[]) {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);

  const res = await api.post("/admin/calendario/ocr/preview", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return res.data;
}

export async function ocrReparse(raw_text: string) {
  const res = await api.post("/admin/calendario/ocr/reparse", { raw_text });
  return res.data;
}

export async function ocrConfirm(payload: { items: any[]; raw_text: string }) {
  const res = await api.post("/admin/calendario/ocr/confirmar", payload);
  return res.data;
}
