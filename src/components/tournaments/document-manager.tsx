"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentType } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES_TEXT, TITLE_MAX } from "@/lib/documents/document-input";

// 大会資料の管理（設計書 §5.9）。アップロード（PDF だけ）と、種別・タイトル・公開／非公開・並び順の編集
// 中身はシステムでは検査しない。管理者に「個人情報が含まれていないか確認してください」と出す

export type DocumentRowView = {
  id: string;
  docType: DocumentType;
  title: string;
  isPublic: boolean;
  sortOrder: number;
  sizeText: string;
  createdText: string;
};

type ApiError = { error?: { message?: string; field?: string } };

const SELECT_CLASS = "min-h-12 w-full rounded-md border border-border bg-background px-3 text-base";
const PRIVACY_NOTE = "個人情報が含まれていないか確認してください（選手名の載った組み合わせ表などは協会の判断で公開されます）";

export function DocumentManager({ slug, tournamentId, documents }: { slug: string; tournamentId: string; documents: DocumentRowView[] }) {
  const hydrated = useHydrated();
  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-8">
      <UploadForm slug={slug} tournamentId={tournamentId} />
      <section aria-labelledby="documents-list" className="flex flex-col gap-3">
        <h2 id="documents-list" className="text-lg font-bold">
          アップロード済みの資料（{documents.length} 件）
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-muted">まだ資料はありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {documents.map((d) => (
              <li key={d.id}>
                <DocumentRow slug={slug} tournamentId={tournamentId} document={d} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UploadForm({ slug, tournamentId }: { slug: string; tournamentId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocumentType>("大会冊子");
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // ファイルを選び直せるように、成功のたびに input を作り直す
  const [inputKey, setInputKey] = useState(0);

  function choose(next: File | null) {
    setFile(next);
    setErrors((e) => ({ ...e, file: "" }));
    // タイトルが空ならファイル名（拡張子なし）を入れておく
    if (next && !title.trim()) setTitle(next.name.replace(/\.pdf$/i, "").slice(0, TITLE_MAX));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const next: Record<string, string> = {};
    if (!file) next.file = "ファイルを選んでください";
    else if (file.size > MAX_DOCUMENT_BYTES) next.file = `ファイルの大きさは ${MAX_DOCUMENT_BYTES_TEXT} までです`;
    if (!title.trim()) next.title = "タイトルを入力してください";
    setErrors(next);
    if (Object.keys(next).length > 0 || !file) return;

    setPending(true);
    setDone(null);
    setFailure(null);
    const form = new FormData();
    form.set("file", file);
    form.set("docType", docType);
    form.set("title", title.trim());
    form.set("isPublic", isPublic ? "true" : "false");
    try {
      const response = await fetch(`/api/${slug}/admin/tournaments/${tournamentId}/documents`, { method: "POST", body: form });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        const message = body?.error?.message ?? "アップロードできませんでした";
        if (body?.error?.field) setErrors({ [body.error.field]: message });
        else setFailure(message);
        return;
      }
      setDone(`「${title.trim()}」を追加しました`);
      setFile(null);
      setTitle("");
      setInputKey((k) => k + 1);
      router.refresh();
    } catch {
      setFailure("アップロードできませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="documents-upload" className="flex flex-col gap-4">
      <h2 id="documents-upload" className="text-lg font-bold">
        資料を追加する
      </h2>
      {done ? <Message kind="success" title={done} /> : null}
      {failure ? <Message kind="error" title={failure} /> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="document-file" className="font-semibold">
          PDF ファイル
        </label>
        <input
          key={inputKey}
          id="document-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
          aria-describedby="document-file-hint"
          aria-invalid={errors.file ? true : undefined}
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 py-2 text-base file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-2"
        />
        <p id="document-file-hint" className="text-sm text-muted">
          PDF だけ。1 ファイル {MAX_DOCUMENT_BYTES_TEXT} まで
        </p>
        {errors.file ? <p className="text-sm font-semibold text-danger">{errors.file}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="document-type" className="font-semibold">
          種別
        </label>
        <select id="document-type" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className={SELECT_CLASS}>
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <TextField
        id="document-title"
        label="タイトル"
        value={title}
        maxLength={TITLE_MAX}
        onChange={(e) => {
          setTitle(e.target.value);
          setErrors((prev) => ({ ...prev, title: "" }));
        }}
        error={errors.title || undefined}
        hint="大会ページに出る名前（例: 第10回 春季大会 大会冊子）"
      />
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-5" />
        <span>公開する（大会のページから誰でも開けます）</span>
      </label>
      <p className="rounded-md border border-border bg-info-surface px-4 py-3 text-sm">{PRIVACY_NOTE}</p>
      <Button type="submit" className="self-start" pending={pending} pendingLabel="アップロードしています…">
        アップロードする
      </Button>
    </form>
  );
}

function DocumentRow({ slug, tournamentId, document }: { slug: string; tournamentId: string; document: DocumentRowView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [docType, setDocType] = useState<DocumentType>(document.docType);
  const [title, setTitle] = useState(document.title);
  const [isPublic, setIsPublic] = useState(document.isPublic);
  const [sortOrder, setSortOrder] = useState(String(document.sortOrder));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ids = { type: `doc-${document.id}-type`, title: `doc-${document.id}-title`, order: `doc-${document.id}-order` };

  function cancel() {
    setDocType(document.docType);
    setTitle(document.title);
    setIsPublic(document.isPublic);
    setSortOrder(String(document.sortOrder));
    setErrors({});
    setFailure(null);
    setEditing(false);
  }

  async function save() {
    if (pending) return;
    if (!title.trim()) {
      setErrors({ title: "タイトルを入力してください" });
      return;
    }
    setPending(true);
    setFailure(null);
    setErrors({});
    try {
      const response = await fetch(`/api/${slug}/admin/tournaments/${tournamentId}/documents/${document.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docType, title: title.trim(), isPublic, sortOrder }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        const message = body?.error?.message ?? "保存できませんでした";
        if (body?.error?.field) setErrors({ [body.error.field]: message });
        else setFailure(message);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setFailure("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md border border-border px-2 py-0.5">{document.docType}</span>
        <span className={`rounded-md px-2 py-0.5 font-semibold ${document.isPublic ? "bg-success-surface text-success" : "bg-surface text-muted"}`}>
          {document.isPublic ? "公開" : "非公開"}
        </span>
        <span className="text-muted">並び順 {document.sortOrder}</span>
      </div>
      <p className="font-semibold break-words">{document.title}</p>
      <p className="text-sm text-muted">
        {document.sizeText}・{document.createdText} に追加
      </p>
      {failure ? <p className="text-sm font-semibold text-danger">{failure}</p> : null}
      {editing ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.type} className="font-semibold">
              種別
            </label>
            <select id={ids.type} value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className={SELECT_CLASS}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <TextField id={ids.title} label="タイトル" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} error={errors.title || undefined} />
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-5" />
            <span>公開する</span>
          </label>
          <TextField
            id={ids.order}
            label="並び順"
            value={sortOrder}
            inputMode="numeric"
            onChange={(e) => setSortOrder(e.target.value)}
            error={errors.sortOrder || undefined}
            hint="小さい順に並びます"
            className="max-w-32"
          />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-10" onClick={save} pending={pending} pendingLabel="保存しています…">
              保存する
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={cancel} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="min-h-10 self-start" onClick={() => setEditing(true)}>
          変更する
        </Button>
      )}
    </div>
  );
}
