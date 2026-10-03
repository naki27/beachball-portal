"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { type ContactScope, subjectsFor } from "@/lib/contact-subjects";

// 問い合わせフォーム（設計書 §5.10）。ログインしていなくても送れる
// 協会のページ（/[スラッグ]/contact）からはその協会宛て。/contact では宛先を選んでもらう
type AssociationOption = { id: string; name: string };

type Props = {
  initialName: string;
  initialEmail: string;
  // 協会のページから開いたとき。宛先は選ばせない
  associationId?: string;
  // /contact で選べる協会（役割を持つ協会、なければ全協会）
  associations?: AssociationOption[];
  // 申込の画面から開いたとき（§5.10）
  entryId?: string | null;
};

export function ContactForm({ initialName, initialEmail, associationId, associations = [], entryId = null }: Props) {
  const fixedAssociation = !!associationId;
  const [destination, setDestination] = useState<ContactScope | "">(fixedAssociation ? "association" : "");
  const [selectedAssociationId, setSelectedAssociationId] = useState(associationId ?? "");
  const [senderName, setSenderName] = useState(initialName);
  const [senderEmail, setSenderEmail] = useState(initialEmail);
  const [subjectType, setSubjectType] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // 宛先を選び直したら、選べない種別が残らないようにする
  function changeDestination(next: ContactScope) {
    setDestination(next);
    if (!subjectsFor(next).some((s) => s.value === subjectType)) setSubjectType("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || destination === "") return;
    setError(null);
    if (destination === "association" && !selectedAssociationId) {
      setError("お問い合わせ先の協会を選んでください");
      return;
    }
    if (!senderName.trim() || !senderEmail.includes("@") || !subjectType || !body.trim()) {
      setError("入力していない欄があります");
      return;
    }

    setPending(true);
    const isAssociation = destination === "association";
    const response = await fetch(isAssociation ? "/api/contact" : "/api/site-contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        associationId: isAssociation ? selectedAssociationId : undefined,
        senderName,
        senderEmail,
        subjectType,
        body,
        website,
        entryId: isAssociation ? entryId : undefined,
      }),
    });
    const result: unknown = await response.json().catch(() => null);
    setPending(false);
    if (!response.ok) {
      const message =
        typeof result === "object" && result !== null && "error" in result
          ? (result.error as { message?: string }).message
          : null;
      setError(message ?? "送信できませんでした。時間をおいてから、もう一度お試しください。");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Message kind="success" title="お問い合わせを受け付けました">
        <p>受付の控えをメールでお送りしました。運営はボランティアのため、返信に数日かかることがあります。</p>
      </Message>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error ? <Message kind="error" title={error} /> : null}
      {!fixedAssociation ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">どちらへのお問い合わせですか？</legend>
          <label className="flex min-h-12 items-center gap-2">
            <input
              type="radio"
              name="destination"
              value="platform"
              checked={destination === "platform"}
              onChange={() => changeDestination("platform")}
            />
            このサイトの運営者（ログインなど）
          </label>
          <label className="flex min-h-12 items-center gap-2">
            <input
              type="radio"
              name="destination"
              value="association"
              checked={destination === "association"}
              onChange={() => changeDestination("association")}
            />
            協会（大会・申し込みのこと）
          </label>
          {destination === "association" ? (
            <label htmlFor="associationId" className="flex flex-col gap-1.5">
              <span className="font-semibold">協会</span>
              <select
                id="associationId"
                value={selectedAssociationId}
                onChange={(event) => setSelectedAssociationId(event.target.value)}
                className="min-h-12 rounded-md border border-border-strong bg-background px-3 text-base"
              >
                <option value="">選んでください</option>
                {associations.map((association) => (
                  <option key={association.id} value={association.id}>
                    {association.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {destination === "" ? null : (
        <>
          <TextField
            id="senderName"
            label="お名前"
            autoComplete="name"
            value={senderName}
            onChange={(event) => setSenderName(event.target.value)}
          />
          <TextField
            id="senderEmail"
            label="返信先のメールアドレス"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={senderEmail}
            onChange={(event) => setSenderEmail(event.target.value)}
          />
          <label htmlFor="subjectType" className="flex flex-col gap-1.5">
            <span className="font-semibold">お問い合わせの種類</span>
            <select
              id="subjectType"
              value={subjectType}
              onChange={(event) => setSubjectType(event.target.value)}
              className="min-h-12 rounded-md border border-border-strong bg-background px-3 text-base"
            >
              <option value="">選んでください</option>
              {subjectsFor(destination).map((subject) => (
                <option key={subject.value} value={subject.value}>
                  {subject.label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="body" className="flex flex-col gap-1.5">
            <span className="font-semibold">お問い合わせの内容</span>
            <textarea
              id="body"
              maxLength={2000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-40 w-full rounded-md border border-border-strong bg-background px-3 py-3 text-base"
            />
          </label>
          {/* 機械よけ（honeypot・§5.10）。人には見せない */}
          <label htmlFor="website" aria-hidden="true" tabIndex={-1} className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <span>ウェブサイト</span>
            <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
          </label>
          <p className="text-sm text-muted">
            受付の控えをメールでお送りします。運営はボランティアのため、返信に数日かかることがあります。
          </p>
          <Button type="submit" pending={pending} fullWidth>
            送信する
          </Button>
        </>
      )}
    </form>
  );
}
