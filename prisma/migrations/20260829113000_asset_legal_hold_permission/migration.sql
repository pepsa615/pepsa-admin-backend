INSERT INTO "Permission" (
  "id",
  "platformId",
  "scope",
  "key",
  "description",
  "riskLevel",
  "delegatable"
)
SELECT
  '20260829-1130-4000-8000-000000000001',
  "id",
  'business-as-a-service',
  'bas.assets.legal-hold',
  'Place and release legal holds on retained KYC and proof-of-delivery assets',
  'HIGH'::"RiskLevel",
  false
FROM "Platform"
WHERE "key" = 'business-as-a-service'
ON CONFLICT ("scope", "key") DO UPDATE SET
  "platformId" = EXCLUDED."platformId",
  "description" = EXCLUDED."description",
  "riskLevel" = EXCLUDED."riskLevel",
  "delegatable" = EXCLUDED."delegatable";
