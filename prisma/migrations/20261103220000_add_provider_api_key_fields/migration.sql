BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[api_providers] ADD [apiKeyCipher] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[api_providers] ADD [lastCheckStatus] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[api_providers] ADD [lastCheckedAt] DATETIME2 NULL;
ALTER TABLE [dbo].[api_providers] ADD [usageAvailable] BIT NOT NULL CONSTRAINT [api_providers_usageAvailable_df] DEFAULT 1;
ALTER TABLE [dbo].[api_providers] ADD [modelsList] NVARCHAR(1000) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
