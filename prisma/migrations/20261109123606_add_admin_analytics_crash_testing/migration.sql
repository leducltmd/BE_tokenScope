BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[api_providers] ALTER COLUMN [secretKeyStatus] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[api_providers] ALTER COLUMN [adminKeyStatus] NVARCHAR(1000) NULL;

-- AlterTable
ALTER TABLE [dbo].[users] ADD [role] NVARCHAR(1000) NOT NULL CONSTRAINT [users_role_df] DEFAULT 'user';

-- CreateTable
CREATE TABLE [dbo].[app_usage_events] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [sessionId] NVARCHAR(1000),
    [eventName] NVARCHAR(1000) NOT NULL,
    [feature] NVARCHAR(1000),
    [screen] NVARCHAR(1000),
    [metadata] NVARCHAR(1000),
    [platform] NVARCHAR(1000),
    [appVersion] NVARCHAR(1000),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [app_usage_events_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [app_usage_events_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [app_usage_events_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[crash_test_devices] (
    [id] NVARCHAR(1000) NOT NULL,
    [deviceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [deviceName] NVARCHAR(1000),
    [platform] NVARCHAR(1000),
    [appVersion] NVARCHAR(1000),
    [reportToken] NVARCHAR(1000),
    [isOnline] BIT NOT NULL CONSTRAINT [crash_test_devices_isOnline_df] DEFAULT 0,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [crash_test_devices_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [crash_test_devices_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [crash_test_devices_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [crash_test_devices_deviceId_key] UNIQUE NONCLUSTERED ([deviceId])
);

-- CreateTable
CREATE TABLE [dbo].[crash_test_requests] (
    [id] NVARCHAR(1000) NOT NULL,
    [deviceId] NVARCHAR(1000),
    [requestedBy] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [crash_test_requests_status_df] DEFAULT 'pending',
    [reason] NVARCHAR(1000),
    [result] NVARCHAR(1000),
    [attemptCount] INT NOT NULL CONSTRAINT [crash_test_requests_attemptCount_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [crash_test_requests_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [triggeredAt] DATETIME2,
    [reportedAt] DATETIME2,
    CONSTRAINT [crash_test_requests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [app_usage_events_userId_occurredAt_idx] ON [dbo].[app_usage_events]([userId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [app_usage_events_eventName_occurredAt_idx] ON [dbo].[app_usage_events]([eventName], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [app_usage_events_occurredAt_idx] ON [dbo].[app_usage_events]([occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [crash_test_devices_userId_idx] ON [dbo].[crash_test_devices]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [crash_test_devices_lastSeenAt_idx] ON [dbo].[crash_test_devices]([lastSeenAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [crash_test_requests_status_idx] ON [dbo].[crash_test_requests]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [crash_test_requests_createdAt_idx] ON [dbo].[crash_test_requests]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_role_idx] ON [dbo].[users]([role]);

-- AddForeignKey
ALTER TABLE [dbo].[app_usage_events] ADD CONSTRAINT [app_usage_events_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[crash_test_devices] ADD CONSTRAINT [crash_test_devices_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[crash_test_requests] ADD CONSTRAINT [crash_test_requests_deviceId_fkey] FOREIGN KEY ([deviceId]) REFERENCES [dbo].[crash_test_devices]([deviceId]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
