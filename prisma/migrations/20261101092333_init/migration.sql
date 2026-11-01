BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [avatarUrl] NVARCHAR(1000),
    [isVerified] BIT NOT NULL CONSTRAINT [users_isVerified_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [users_isActive_df] DEFAULT 1,
    [lastLoginAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[sessions] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [refreshToken] NVARCHAR(1000) NOT NULL,
    [userAgent] NVARCHAR(1000),
    [ipAddress] NVARCHAR(1000),
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [sessions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [sessions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [sessions_refreshToken_key] UNIQUE NONCLUSTERED ([refreshToken])
);

-- CreateTable
CREATE TABLE [dbo].[projects] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [color] NVARCHAR(1000) NOT NULL CONSTRAINT [projects_color_df] DEFAULT '#6366F1',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [projects_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [projects_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[api_providers] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [projectId] NVARCHAR(1000),
    [name] NVARCHAR(1000) NOT NULL,
    [providerType] NVARCHAR(1000) NOT NULL,
    [baseUrl] NVARCHAR(1000),
    [apiKeyLast4] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [api_providers_status_df] DEFAULT 'active',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [api_providers_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [api_providers_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[budgets] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [apiProviderId] NVARCHAR(1000),
    [monthlyLimit] DECIMAL(18,4) NOT NULL,
    [currentSpend] DECIMAL(18,4) NOT NULL CONSTRAINT [budgets_currentSpend_df] DEFAULT 0,
    [warningPercent] INT NOT NULL CONSTRAINT [budgets_warningPercent_df] DEFAULT 80,
    [periodStart] DATETIME2 NOT NULL CONSTRAINT [budgets_periodStart_df] DEFAULT CURRENT_TIMESTAMP,
    [periodEnd] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [budgets_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [budgets_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[alerts] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [apiProviderId] NVARCHAR(1000),
    [type] NVARCHAR(1000) NOT NULL,
    [threshold] DECIMAL(18,4),
    [isEnabled] BIT NOT NULL CONSTRAINT [alerts_isEnabled_df] DEFAULT 1,
    [triggeredAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [alerts_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [alerts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[usage_records] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [projectId] NVARCHAR(1000),
    [apiProviderId] NVARCHAR(1000) NOT NULL,
    [model] NVARCHAR(1000) NOT NULL,
    [endpoint] NVARCHAR(1000),
    [promptTokens] INT NOT NULL CONSTRAINT [usage_records_promptTokens_df] DEFAULT 0,
    [completionTokens] INT NOT NULL CONSTRAINT [usage_records_completionTokens_df] DEFAULT 0,
    [totalTokens] INT NOT NULL CONSTRAINT [usage_records_totalTokens_df] DEFAULT 0,
    [cost] DECIMAL(18,6) NOT NULL CONSTRAINT [usage_records_cost_df] DEFAULT 0,
    [latencyMs] INT,
    [statusCode] INT NOT NULL CONSTRAINT [usage_records_statusCode_df] DEFAULT 200,
    [isSuccess] BIT NOT NULL CONSTRAINT [usage_records_isSuccess_df] DEFAULT 1,
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [usage_records_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [usage_records_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [usage_records_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_email_idx] ON [dbo].[users]([email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [sessions_userId_idx] ON [dbo].[sessions]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [projects_userId_idx] ON [dbo].[projects]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [api_providers_userId_idx] ON [dbo].[api_providers]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [api_providers_projectId_idx] ON [dbo].[api_providers]([projectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [budgets_userId_idx] ON [dbo].[budgets]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [alerts_userId_idx] ON [dbo].[alerts]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_userId_occurredAt_idx] ON [dbo].[usage_records]([userId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_apiProviderId_idx] ON [dbo].[usage_records]([apiProviderId]);

-- AddForeignKey
ALTER TABLE [dbo].[sessions] ADD CONSTRAINT [sessions_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[projects] ADD CONSTRAINT [projects_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[api_providers] ADD CONSTRAINT [api_providers_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[api_providers] ADD CONSTRAINT [api_providers_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[budgets] ADD CONSTRAINT [budgets_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[budgets] ADD CONSTRAINT [budgets_apiProviderId_fkey] FOREIGN KEY ([apiProviderId]) REFERENCES [dbo].[api_providers]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[alerts] ADD CONSTRAINT [alerts_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[alerts] ADD CONSTRAINT [alerts_apiProviderId_fkey] FOREIGN KEY ([apiProviderId]) REFERENCES [dbo].[api_providers]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[usage_records] ADD CONSTRAINT [usage_records_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[usage_records] ADD CONSTRAINT [usage_records_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[projects]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[usage_records] ADD CONSTRAINT [usage_records_apiProviderId_fkey] FOREIGN KEY ([apiProviderId]) REFERENCES [dbo].[api_providers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
