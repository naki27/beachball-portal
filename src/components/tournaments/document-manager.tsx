"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentType } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES_TEXT, PUBLIC_CACHE_TEXT, TITLE_MAX } from "@/lib/documents/document-input";

// 大会資料の管理（設計書 §5.9）。アップロード（PDF だけ）、種別・タイトル・公開／非公開・並び順の編集、差し替え、削除
// 中身はシステムでは検査しない。管理者に「個人情報が含まれていないか確認してください」と出す

export type DocumentRowView = {
  id: string;
  docType: DocumentType;
  title: string;
  isPublic: boolean;
  // いま公開用に置かれているか（「公開」でも大会が準備中の間は置かれない）
  published: boolean;
  sortOrder: number;
  sizeText: string;
  createdText: string;
};

type ApiError = { error?: { message?: string; field?: string } };

const SELECT_CLASS = "min-h-12 w-full rounded-md border border-border bg-background px-3 text-base";
const FILE_CLASS =
  "min-h-12 w-full rounded-md border border-border bg-background px-3 py-2 text-base file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-2";
const PRIVACY_NOTE = "個人情報が含まれていないか確認してください（選手名の載った組み合わせ表などは協会の判断で公開されます）";

async function readError(response: Response, fallback: string): Promise<{ message: string; field: string | null }> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return { message: body?.error?.message ?? fallback, field: body?.error?.field ?? null };
}

export function DocumentManager({
  slug,
  tournamentId,
  tournamentIsDraft,
  documents,
}: {
  slug: string;
  tournamentId: string;
  tournamentIsDraft: boolean;
  documents: DocumentRowView[];
}) {
  const hydrated = useHydrated();
  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-8">
      <UploadForm slug={slug} tournamentId={tournamentId} />
      <section aria-labelledby="documents-list" className="flex flex-col gap-3">
        <h2 id="documents-list" className="text-lg font-bold">
          アップロード済みの資料（{documents.length} 件）
        </h2>
        {tournamentIsDraft && documents.length > 0 ? (
          <Message kind="info" title="大会が「準備中」の間は、「公開」の資料も大会のページに出ません。大会を「受付中」などにすると公開されます" />
        ) : null}
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
        const error = await readError(response, "アップロードできませんでした");
        if (error.field) setErrors({ [error.field]: error.message });
        else setFailure(error.message);
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
          className={FILE_CLASS}
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
  const [mode, setMode] = useState<"view" | "edit" | "replace" | "delete">("view");
  const [docType, setDocType] = useState<DocumentType>(document.docType);
  const [title, setTitle] = useState(document.title);
  const [isPublic, setIsPublic] = useState(document.isPublic);
  const [sortOrder, setSortOrder] = useState(String(document.sortOrder));
  const [replacement, setReplacement] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { type: `doc-${document.id}-type`, title: `doc-${document.id}-title`, order: `doc-${document.id}-order`, file: `doc-${document.id}-file` };
  const apiUrl = `/api/${slug}/admin/tournaments/${tournamentId}/documents/${document.id}`;
  const openUrl = `/${slug}/tournaments/${tournamentId}/documents/${document.id}`;

  function reset() {
    setDocType(document.docType);
    setTitle(document.title);
    setIsPublic(document.isPublic);
    setSortOrder(String(document.sortOrder));
    setReplacement(null);
    setErrors({});
    setFailure(null);
    setMode("view");
  }

  // 3 つの操作で共通: 送る → 失敗なら欄かメッセージに出す → 成功なら一覧を読み直す
  async function send(init: RequestInit, fallback: string, onDone: () => void) {
    if (pending) return;
    setPending(true);
    setFailure(null);
    setNotice(null);
    setErrors({});
    try {
      const response = await fetch(apiUrl, init);
      if (!response.ok) {
        const error = await readError(response, fallback);
        if (error.field) setErrors({ [error.field]: error.message });
        else setFailure(error.message);
        return;
      }
      onDone();
      router.refresh();
    } catch {
      setFailure(`${fallback}。電波の状態を確かめてください`);
    } finally {
      setPending(false);
    }
  }

  function save() {
    if (!title.trim()) {
      setErrors({ title: "タイトルを入力してください" });
      return;
    }
    void send(
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ docType, title: title.trim(), isPublic, sortOrder }) },
      "保存できませんでした",
      () => setMode("view"),
    );
  }

  function replace() {
    if (!replacement) {
      setErrors({ file: "ファイルを選んでください" });
      return;
    }
    if (replacement.size > MAX_DOCUMENT_BYTES) {
      setErrors({ file: `ファイルの大きさは ${MAX_DOCUMENT_BYTES_TEXT} までです` });
      return;
    }
    const form = new FormData();
    form.set("file", replacement);
    void send({ method: "PUT", body: form }, "差し替えられませんでした", () => {
      setReplacement(null);
      setMode("view");
      setNotice("ファイルを差し替えました。公開中なら、開くための URL が新しくなっています");
    });
  }

  function remove() {
    void send({ method: "DELETE" }, "削除できませんでした", () => setMode("view"));
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
      {document.published ? (
        <p className="text-sm">
          <a href={openUrl} target="_blank" rel="noopener" className="underline underline-offset-2">
            大会ページと同じ URL で開く
          </a>
          （新しいタブ）
        </p>
      ) : document.isPublic ? (
        <p className="text-sm text-muted">大会が「準備中」のため、まだ公開されていません</p>
      ) : null}
      {notice ? <Message kind="success" title={notice} /> : null}
      {failure ? <p className="text-sm font-semibold text-danger">{failure}</p> : null}

      {mode === "view" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-10" onClick={() => setMode("edit")}>
            変更する
          </Button>
          <Button variant="secondary" className="min-h-10" onClick={() => setMode("replace")}>
            ファイルを差し替える
          </Button>
          <Button variant="danger" className="min-h-10" onClick={() => setMode("delete")}>
            削除する
          </Button>
        </div>
      ) : null}

      {mode === "edit" ? (
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
          <p className="text-sm text-muted">非公開にしても、すでに開いていた人は最長 {PUBLIC_CACHE_TEXT} は開けることがあります</p>
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
            <Button variant="secondary" className="min-h-10" onClick={reset} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "replace" ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.file} className="font-semibold">
              新しい PDF ファイル
            </label>
            <input
              id={ids.file}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setReplacement(e.target.files?.[0] ?? null);
                setErrors({});
              }}
              aria-invalid={errors.file ? true : undefined}
              className={FILE_CLASS}
            />
            <p className="text-sm text-muted">
              タイトルや公開の設定はそのまま。公開中なら開くための URL が新しくなり、古い URL は開けなくなります（最長 {PUBLIC_CACHE_TEXT}{" "}
              は古いほうが開けることがあります）
            </p>
            {errors.file ? <p className="text-sm font-semibold text-danger">{errors.file}</p> : null}
          </div>
          <p className="rounded-md border border-border bg-info-surface px-4 py-3 text-sm">{PRIVACY_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-10" onClick={replace} pending={pending} pendingLabel="差し替えています…">
              差し替える
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={reset} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "delete" ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3">
          <p className="text-sm">削除すると大会のページから消え、開くための URL も使えなくなります。「削除済みデータ」から元に戻せます。</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" className="min-h-10" onClick={remove} pending={pending} pendingLabel="削除しています…">
              削除する
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={reset} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
