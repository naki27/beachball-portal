import { forbidden, notFound } from "next/navigation";
import { TeamError } from "@/lib/teams/errors";

// 画面でチームの処理（src/lib/teams/…）が投げた TeamError を、404 / 403 のページにする（§3.1。リダイレクトしない）
// それ以外の状態（409 など）は画面では起きない前提で、そのまま投げる
export function pageErrorFrom(error: unknown): never {
  if (error instanceof TeamError) {
    if (error.status === 404) notFound();
    if (error.status === 403) forbidden();
  }
  throw error;
}
