-- AlterTable
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";

-- DropTable
DROP TABLE IF EXISTS "RefreshSession";
