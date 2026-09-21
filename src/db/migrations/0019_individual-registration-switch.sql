-- 「個人で登録する」をテナントごとに出す／出さない（K-02・ADR 0032）。既定は true（いままでどおり受け付ける）
-- associations は RLS の対象外（テナントの表そのもの）。app_user には 0003 で select/insert/update を与えてある
ALTER TABLE "associations" ADD COLUMN "individual_registration_enabled" boolean DEFAULT true NOT NULL;