// 送信が済んだ申込の番号を、その端末のタブにだけ覚えておく（設計書 §5.5）
// 完了後にブラウザの「戻る」で確認ページに戻っても、「この申し込みはすでに完了しています」と案内できるようにする
// 一時保存（localStorage）は送信時に消すので、生年月日は残らない。ここに置くのは申込番号だけ

const KEY = "entry-completed";

function session(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // プライベートモードなどで使えない
  }
}

export function saveCompletedEntry(draftKey: string, entryId: string): void {
  try {
    session()?.setItem(`${KEY}:${draftKey}`, entryId);
  } catch {
    // 覚えられなくても送信は済んでいる（再送してもワンタイムの値で 2 件目にはならない）
  }
}

export function readCompletedEntry(draftKey: string): string | null {
  try {
    return session()?.getItem(`${KEY}:${draftKey}`) ?? null;
  } catch {
    return null;
  }
}
