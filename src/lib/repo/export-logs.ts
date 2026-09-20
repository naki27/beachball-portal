import { exportLogs, type ExportFormat, type ExportScope } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 名簿・CSV の出力記録（設計書 §5.13・§12）。誰がいつ何を出したかだけを残す（中身は持たない）
export type NewExportLog = {
  userId: string;
  scope: ExportScope;
  scopeId: string | null;
  format: ExportFormat;
  year: number | null;
  includesBirthDate: boolean;
  rowCount: number;
};

export async function insertExportLog(tx: Tx, associationId: string, input: NewExportLog): Promise<void> {
  await tx.insert(exportLogs).values({ associationId, ...input });
}
