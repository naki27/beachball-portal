"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import {
  DOC_MAX_BYTES,
  DOC_TITLE_MAX,
  DOC_TYPES,
  type DocumentField,
  formatFileSize,
  parseDocumentInput,
} from "@/lib/documents/document-input";

// 大会資料の管理（設計書 §5.9）。PDF だけ・10 MB まで。公開／非公開と並び順もここで変える
// 中身は協会の判断で公開されるので、アップロードの前に「個人情報が含まれていないか確認してください」と出す

export type DocumentRow = {
  id: string;
  docType: string;
  title: string;
  sizeBytes: number;
  isPublic: boolean;
  sortOrder: string;
  // 公開用に置かれているか（置かれていれば公開ページから開ける・C-02）
  published: boolean;
  createdAtText: string;
  publicUrl: string | null;
};

type Draft = { docType: string; title: string; isPublic: boolean; sortOrder: string };

const EMPTY: Draft = { docType: "大会冊子", title: "", isPublic: true, sortOrder: "100" };

type ApiBody = { error?: { message?: string; field?: DocumentField } };

export function DocumentManager({
  slug,
  tournamentId,
  documents,
  isDraftTournament,
}: {
  slug: string;
  tournamentId: string;
  documents: DocumentRow[];
  // 下書きの大会は公開用に置かない（§5.9）。画面にもそう書く
  isDraftTournament: boolean;
}) {
  const router = useRouter();
  const base = `/api/${slug}/admin/tournaments/${tournamentId}/documents`;
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<DocumentField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  function reset(): void {
    setErrors({});
    setNotice(null);
    setDone(null);
  }

  async function send(key: string, url: string, method: string, body: BodyInit | undefined, headers: HeadersInit | undefined, message: string) {
    if (pending) return;
    reset();
    setPending(key);
    try {
      const response = await fetch(url, { method, headers, body });
      const parsedBody = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        setDone(message);
        setEditingId(null);
        setDraft(EMPTY);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
        return;
      }
      if (parsedBody?.error?.field) setErrors({ [parsedBody.error.field]: parsedBody.error.message ?? "入力を確かめてください" });
      setNotice(parsedBody?.error?.message ?? "保存できませんでした");
    } catch {
      setNotice("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(null);
    }
  }

  function upload(): void {
    const parsedInput = parseDocumentInput(draft);
    if (!parsedInput.ok) {
      setErrors({ [parsedInput.field]: parsedInput.message });
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErrors({ file: "PDF のファイル（.pdf）を選んでください" });
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      setErrors({ file: `ファイルは ${DOC_MAX_BYTES / 1024 / 1024} MB までです。小さくしてから選んでください` });
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("docType", draft.docType);
    form.set("title", draft.title);
    form.set("isPublic", draft.isPublic ? "true" : "false");
    form.set("sortOrder", draft.sortOrder);
    // multipart のときは content-type をブラウザに付けさせる（境界の文字列が必要）
    void send("upload", base, "POST", form, undefined, `${draft.title}を追加しました`);
  }

  function saveEdit(row: DocumentRow): void {
    const parsedInput = parseDocumentInput(draft);
    if (!parsedInput.ok) {
      setErrors({ [parsedInput.field]: parsedInput.message });
      return;
    }
    void send(
      `edit:${row.id}`,
      `${base}/${row.id}`,
      "PATCH",
      JSON.stringify({ ...draft, isPublic: draft.isPublic }),
      { "content-type": "application/json" },
      `${draft.title}を保存しました`,
    );
  }

  function togglePublic(row: DocumentRow): void {
    void send(
      `toggle:${row.id}`,
      `${base}/${row.id}`,
      "PATCH",
      JSON.stringify({ docType: row.docType, title: row.title, sortOrder: row.sortOrder, isPublic: !row.isPublic }),
      { "content-type": "application/json" },
      row.isPublic ? `${row.title}を非公開にしました` : `${row.title}を公開しました`,
    );
  }

  // ファイルの差し替え（§5.9）。公開中なら新しい名前で置き直すので、前に配った URL は開けなくなる
  function replaceFile(row: DocumentRow): void {
    const file = replaceRefs.current[row.id]?.files?.[0];
    if (!file) {
      setErrors({ file: "差し替えるファイルを選んでください" });
      return;
    }
    if (!window.confirm(`${row.title}のファイルを差し替えます。前に配った資料の URL は開けなくなります。よろしいですか？`)) return;
    const form = new FormData();
    form.set("file", file);
    void send(`replace:${row.id}`, `${base}/${row.id}`, "PUT", form, undefined, `${row.title}のファイルを差し替えました`);
  }

  function remove(row: DocumentRow): void {
    if (!window.confirm(`${row.title}を削除します。公開ページからも見られなくなります。よろしいですか？`)) return;
    void send(`remove:${row.id}`, `${base}/${row.id}`, "DELETE", undefined, undefined, `${row.title}を削除しました`);
  }

  function startEdit(row: DocumentRow): void {
    reset();
    setEditingId(row.id);
    setDraft({ docType: row.docType, title: row.title, isPublic: row.isPublic, sortOrder: row.sortOrder });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">大会の資料</h2>
      <Message kind="info" title="個人情報が含まれていないか確認してください">
        公開した資料は、大会に関係のない人でも開けます。組み合わせ表などに載っている氏名は、そのまま公開されます。
        非公開にしたあと、配信の仕組みの都合で最長 1 時間は開ける場合があります。
      </Message>
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      <ul className="flex flex-col gap-3">
        {documents.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            {editingId === row.id ? (
              <div className="flex flex-col gap-3">
                <DraftFields draft={draft} setDraft={setDraft} errors={errors} idPrefix={`edit-${row.id}`} />
                <div className="flex flex-wrap gap-2">
                  <Button pending={pending === `edit:${row.id}`} pendingLabel="保存しています…" onClick={() => saveEdit(row)}>
                    保存する
                  </Button>
                  <Button variant="secondary" onClick={() => setEditingId(null)}>
                    やめる
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded-sm border border-border px-2 py-0.5 text-sm">{row.docType}</span>
                  <span className="font-semibold break-words">{row.title}</span>
                  <span className={`text-sm font-semibold ${row.isPublic ? "text-success" : "text-muted"}`}>
                    {row.isPublic ? (row.published ? "公開中" : "公開待ち") : "非公開"}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {formatFileSize(row.sizeBytes)}・並び順 {row.sortOrder}・{row.createdAtText}
                  {row.isPublic && !row.published && isDraftTournament ? "（大会が下書きのため、まだ公開されません）" : ""}
                </p>
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-semibold">ファイルを差し替える</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      ref={(element) => {
                        replaceRefs.current[row.id] = element;
                      }}
                      className="min-h-12 w-full rounded-md border border-border bg-background px-3 py-2 text-base"
                    />
                  </label>
                  <Button
                    variant="secondary"
                    pending={pending === `replace:${row.id}`}
                    pendingLabel="差し替えています…"
                    onClick={() => replaceFile(row)}
                  >
                    差し替える
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.publicUrl ? (
                    <a
                      href={row.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-12 items-center underline underline-offset-2"
                    >
                      開いて確かめる
                    </a>
                  ) : null}
                  <Button variant="secondary" onClick={() => startEdit(row)}>
                    直す
                  </Button>
                  <Button
                    variant="secondary"
                    pending={pending === `toggle:${row.id}`}
                    pendingLabel="変えています…"
                    onClick={() => togglePublic(row)}
                  >
                    {row.isPublic ? "非公開にする" : "公開する"}
                  </Button>
                  <Button variant="danger" pending={pending === `remove:${row.id}`} pendingLabel="削除しています…" onClick={() => remove(row)}>
                    削除する
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
        {documents.length === 0 ? <li className="text-muted">まだ資料はありません。</li> : null}
      </ul>

      {editingId === null ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <h3 className="font-bold">資料を追加する</h3>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="doc-file" className="font-semibold">
              PDF のファイル
            </label>
            <input
              id="doc-file"
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              aria-invalid={errors.file ? true : undefined}
              className={`min-h-12 w-full rounded-md border bg-background px-3 py-2 text-base ${errors.file ? "border-2 border-danger" : "border-border"}`}
            />
            <p className="text-sm text-muted">PDF だけ・{DOC_MAX_BYTES / 1024 / 1024} MB まで</p>
            {errors.file ? <p className="text-sm font-semibold text-danger">{errors.file}</p> : null}
          </div>
          <DraftFields draft={draft} setDraft={setDraft} errors={errors} idPrefix="new" />
          <Button pending={pending === "upload"} pendingLabel="アップロードしています…" onClick={upload} fullWidth>
            追加する
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function DraftFields({
  draft,
  setDraft,
  errors,
  idPrefix,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  errors: Partial<Record<DocumentField, string>>;
  idPrefix: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-doc-type`} className="font-semibold">
          種別
        </label>
        <select
          id={`${idPrefix}-doc-type`}
          value={draft.docType}
          onChange={(event) => setDraft({ ...draft, docType: event.target.value })}
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          {DOC_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {errors.docType ? <p className="text-sm font-semibold text-danger">{errors.docType}</p> : null}
      </div>
      <TextField
        id={`${idPrefix}-doc-title`}
        label="タイトル"
        value={draft.title}
        maxLength={DOC_TITLE_MAX}
        error={errors.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />
      <TextField
        id={`${idPrefix}-doc-sort`}
        label="並び順"
        inputMode="numeric"
        value={draft.sortOrder}
        error={errors.sortOrder}
        hint="小さい数が先に出ます"
        onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
      />
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          checked={draft.isPublic}
          onChange={(event) => setDraft({ ...draft, isPublic: event.target.checked })}
          className="size-6"
        />
        <span className="font-semibold">公開する（大会ページに出す）</span>
      </label>
    </>
  );
}
