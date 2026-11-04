BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[budgets] ADD [projectId] NVARCHAR(1000);

-- CreateIndex
CREATE NONCLUSTERED INDEX [budgets_apiProviderId_idx] ON [dbo].[budgets]([apiProviderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [budgets_projectId_idx] ON [dbo].[budgets]([projectId]);

-- AddForeignKey
ALTER TABLE [dbo].[budgets] ADD CONSTRAINT [budgets_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
