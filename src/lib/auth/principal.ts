import { cache } from "react";
import { ANONYMOUS, type AssociationMembership, type Principal } from "@/lib/authz";

// ログイン中の人と、その協会での役割の行。A-09（セッション）と A-13（役割の読み出し）で本物にする
// それまでは、誰が来てもアンノウン（役割なし）として判定する

export const getPrincipal = cache(async (): Promise<Principal> => ANONYMOUS);

export const getMembership = cache(
  async (principal: Principal, associationId: string): Promise<AssociationMembership | null> => {
    if (!principal.userId) return null;
    return { associationId, isAssociationAdmin: false, teamAdminOf: new Set(), playerOf: new Set() };
  },
);
