BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- Thêm Workspace ID cho kết nối Anthropic Claude.
-- Lưu mã hoá (AES-256-GCM) giống API Key — không lưu bản rõ.
ALTER TABLE [dbo].[api_providers] ADD [workspaceIdCipher] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[api_providers] ADD [workspaceIdLast4] NVARCHAR(1000) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
