BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- Thêm trạng thái kiểm tra độc lập cho từng loại khoá của Anthropic Claude.
-- Secret API Key và Admin API Key được kiểm tra riêng biệt nên cần lưu trạng
-- thái của từng khoá để giao diện hiển thị đúng:
--   connected | invalid | missingPermissions | missingWorkspace | missing
ALTER TABLE [dbo].[api_providers] ADD [secretKeyStatus] NVARCHAR(50) NULL;
ALTER TABLE [dbo].[api_providers] ADD [adminKeyStatus] NVARCHAR(50) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
