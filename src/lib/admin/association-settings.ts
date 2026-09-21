import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { setIndividualRegistrationEnabled } from "@/lib/repo/associations";
import { authorizeAssociationAdmin } from "./access";

// 協会の設定（K-02・ADR 0032）。いまは「個人で登録する」を受け付けるかだけ。テナント管理者だけ（§3.2 manageTournaments と同じ入口）

export async function setIndividualRegistration(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  enabled: boolean,
): Promise<void> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      await setIndividualRegistrationEnabled(tx, associationId, enabled);
    },
    { userId: principal.userId },
  );
}
