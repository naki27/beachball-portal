import { customType } from "drizzle-orm/pg-core";

// 大文字小文字を区別しない文字列（拡張 citext・付録 A）。メールアドレスに使う
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "citext";
  },
});
