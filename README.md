# TokenScope — Backend API

Hệ thống xác thực cho nền tảng giám sát API trí tuệ nhân tạo TokenScope.
Xây dựng bằng **Express + TypeScript + Prisma** trên **SQL Server**.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js 22 · TypeScript 5.7 |
| Framework | Express 4 |
| ORM | Prisma 6 |
| Cơ sở dữ liệu | SQL Server 2022 (database `TokenScope`) |
| Xác thực | JWT access token + refresh token (bcrypt) |
| Validate | Zod |
| Test | Vitest + Supertest |

## Cấu trúc

```
src/
├── config/
│   ├── index.ts          # Đọc biến môi trường
│   └── prisma.ts         # PrismaClient singleton
├── middlewares/
│   ├── auth.ts           # requireAuth — bắt buộc Bearer token
│   ├── validate.ts       # Validate body theo Zod schema
│   └── error.ts          # Error handler thống nhất
├── modules/auth/
│   ├── auth.controller.ts
│   ├── auth.service.ts   # Business logic + truy vấn Prisma
│   ├── auth.routes.ts
│   └── auth.validation.ts
├── utils/
│   ├── errors.ts         # AppError + các lỗi nghiệp vụ
│   ├── jwt.ts            # Ký / xác minh token
│   └── helpers.ts
├── app.ts                # Khởi tạo Express app
└── server.ts             # Điểm khởi động
prisma/
├── schema.prisma         # 7 model
├── seed.ts               # Dữ liệu mẫu
└── migrations/
tests/
└── auth.test.ts          # 15 test tích hợp
```

## Cơ sở dữ liệu

Database: **`TokenScope`** (SQL Server)

| Bảng | Mô tả |
|---|---|
| `users` | Người dùng — email unique, passwordHash (bcrypt, 12 rounds) |
| `sessions` | Phiên đăng nhập — refreshToken unique, revokedAt, expiresAt |
| `projects` | Dự án nhóm các API key |
| `api_providers` | Nhà cung cấp API (OpenAI, Anthropic, Google…) |
| `budgets` | Ngân sách chi phí theo tháng |
| `alerts` | Cảnh báo vượt ngưỡng / độ trễ tăng |
| `usage_records` | Lịch sử gọi API — token, chi phí, độ trễ |

> SQL Server không hỗ trợ nhiều đường cascade tới cùng một bảng, nên các quan hệ
> "cha" dùng `NoAction`/`SetNull` và việc xóa được xử lý tường minh ở tầng service.

## API

Base URL: `http://localhost:3000/api`

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| `GET` | `/api/health` | — | Kiểm tra dịch vụ |
| `POST` | `/api/auth/register` | — | Đăng ký tài khoản |
| `POST` | `/api/auth/login` | — | Đăng nhập |
| `POST` | `/api/auth/forgot-password` | — | Gửi link đặt lại mật khẩu |
| `POST` | `/api/auth/refresh` | — | Làm mới access token |
| `POST` | `/api/auth/logout` | — | Thu hồi phiên |
| `GET` | `/api/auth/me` | Bearer | Thông tin người dùng hiện tại |
| `POST` | `/api/auth/change-password` | Bearer | Đổi mật khẩu |
| `GET` | `/api/providers/catalog` | Bearer | Danh mục nhà cung cấp hỗ trợ |
| `GET` | `/api/providers` | Bearer | Danh sách kết nối + số liệu usage |
| `POST` | `/api/providers/test` | Bearer | Kiểm tra API Key với nhà cung cấp thật |
| `POST` | `/api/providers` | Bearer | Tạo kết nối (lưu khoá đã mã hoá) |
| `PATCH` | `/api/providers/:id` | Bearer | Đổi tên kết nối |
| `DELETE` | `/api/providers/:id` | Bearer | Xoá kết nối |
| `POST` | `/api/providers/:id/check` | Bearer | Kiểm tra lại kết nối đã lưu |
| `POST` | `/api/providers/:id/sync` | Bearer | Đồng bộ usage & billing |
| `GET` | `/api/providers/openai/models` | Bearer | Danh sách model OpenAI (Secret key) |
| `GET` | `/api/providers/openai/usage` | Bearer | Usage cấp tổ chức OpenAI (Admin key) |
| `GET` | `/api/providers/openai/costs` | Bearer | Chi phí cấp tổ chức OpenAI (Admin key) |
| `PATCH` | `/api/providers/:id/keys` | Bearer | Cập nhật độc lập Secret key / Admin key / Workspace ID |

### OpenAI — Usage & Costs cấp tổ chức

```http
GET /api/providers/openai/usage?days=30&bucket_width=1d&group_by=model,project_id
Authorization: Bearer <access-token>
```

Query params chung cho `usage` và `costs`:

| Param | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `days` | int (1–90) | `30` | Số ngày gần nhất (bị bỏ qua nếu có `start_time`) |
| `start_time` | int (Unix giây) | — | Mốc bắt đầu (bao gồm) |
| `end_time` | int (Unix giây) | hiện tại | Mốc kết thúc (không bao gồm) |
| `bucket_width` | `1m` \| `1h` \| `1d` | `1d` | Độ rộng bucket (Costs chỉ nhận `1d`) |
| `project_ids` | csv | — | Lọc theo dự án |
| `group_by` | csv | `model,project_id` (usage) · `line_item,project_id` (costs) | Trường gom nhóm |
| `limit` | int | — | Số bucket mỗi trang (usage ≤ 1440, costs ≤ 180) |
| `page` | string | — | Con trỏ trang từ `next_page` |

Ngoài ra `usage` nhận `models`, `costs` nhận `line_items`.

**200 — `/api/providers/openai/usage`**

```json
{
  "totals": {
    "inputTokens": 1200,
    "outputTokens": 600,
    "totalTokens": 1800,
    "requests": 7,
    "cachedInputTokens": 400
  },
  "byModel": [
    { "model": "gpt-4o", "inputTokens": 1000, "outputTokens": 500, "totalTokens": 1500, "requests": 5 }
  ],
  "byProject": [
    { "projectId": "proj_1", "inputTokens": 1200, "outputTokens": 600, "totalTokens": 1800, "requests": 7 }
  ],
  "points": [
    {
      "date": "2026-11-01",
      "projectId": "proj_1",
      "model": "gpt-4o",
      "inputTokens": 1000,
      "outputTokens": 500,
      "totalTokens": 1500,
      "requests": 5,
      "cachedInputTokens": 400
    }
  ],
  "pagination": { "pages": 1, "hasMore": false, "nextPage": null },
  "message": "Đã đọc 1 điểm usage từ OpenAI Organization."
}
```

**200 — `/api/providers/openai/costs`**

```json
{
  "totals": {
    "byCurrency": [{ "currency": "usd", "amount": 0.09 }],
    "amount": 0.09,
    "currency": "usd"
  },
  "byDate": [{ "date": "2026-11-01", "amount": 0.09, "currency": "usd" }],
  "byProject": [{ "projectId": "proj_1", "amount": 0.09, "currency": "usd" }],
  "byLineItem": [{ "lineItem": "gpt-4o, input_tokens", "amount": 0.06, "currency": "usd" }],
  "points": [
    {
      "date": "2026-11-01",
      "projectId": "proj_1",
      "lineItem": "gpt-4o, input_tokens",
      "model": "gpt-4o",
      "amount": 0.06,
      "currency": "usd",
      "quantity": 1000,
      "quantityUnit": "tokens"
    }
  ],
  "pagination": { "pages": 1, "hasMore": false, "nextPage": null },
  "message": "Đã đọc 1 dòng chi phí từ OpenAI Organization."
}
```

> `totals.amount` là `null` khi dữ liệu có **nhiều đơn vị tiền tệ** — TokenScope
> không tự quy đổi giữa các đơn vị. Dùng `totals.byCurrency` để hiển thị.

### Mã lỗi OpenAI

| HTTP | `code` | Ý nghĩa |
|---|---|---|
| 400 | `OPENAI_BAD_REQUEST` | OpenAI không chấp nhận tham số truy vấn |
| 401 | `OPENAI_UNAUTHORIZED` | API Key không hợp lệ hoặc đã thu hồi |
| 403 | `OPENAI_FORBIDDEN` | Thiếu quyền Organization — cần Admin API Key |
| 403 | `FORBIDDEN` | Chưa bật `OPENAI_ORG_ACCESS_ENABLED` hoặc không nằm trong danh sách được phép |
| 404 | `OPENAI_NOT_FOUND` | Endpoint OpenAI không tồn tại |
| 429 | `OPENAI_RATE_LIMITED` | Vượt giới hạn request |
| 502 | `OPENAI_UNREACHABLE` | Lỗi mạng hoặc timeout |
| 503 | `OPENAI_NOT_CONFIGURED` | Chưa cấu hình `OPENAI_API_KEY` / `OPENAI_ADMIN_API_KEY` |

### Anthropic Claude — trạng thái & lỗi

Claude dùng **kết nối theo từng người dùng** (khoá lưu trong `api_providers`),
nên Usage/Cost được đọc qua các endpoint chung:

```http
POST /api/providers/test
{ "providerType": "anthropic", "apiKey": "sk-ant-...", "adminApiKey": "sk-ant-admin-...", "workspaceId": "wsp_..." }
```

```http
POST /api/providers/:id/sync    # đồng bộ Usage + Cost của kết nối đã lưu
```

**Trạng thái từng loại khoá** (`secretKey` / `adminKey` trong response):

| `status` | Ý nghĩa |
|---|---|
| `connected` | Khoá hợp lệ và dùng được cho mục đích của nó |
| `invalid` | Khoá không hợp lệ / đã thu hồi |
| `missingPermissions` | Thiếu quyền tổ chức (Usage hoặc Costs) |
| `missingWorkspace` | Khoá chưa scope vào Workspace — cần `anthropic-workspace-id` |
| `missing` | Chưa cấu hình khoá đó |

Lỗi Anthropic được chuẩn hoá theo HTTP status:

| HTTP | Nội dung | Ý nghĩa |
|---|---|---|
| 400 | `bad_request` | Thiếu `anthropic-workspace-id` hoặc tham số không hợp lệ |
| 401 | `unauthorized` | Secret/Admin API Key không hợp lệ |
| 403 | `forbidden` / `missing_admin_permissions` | Thiếu quyền tổ chức |
| 404 | `not_found` | Endpoint Anthropic không tồn tại |
| 429 | `rate_limited` | Vượt giới hạn request (kèm `retry-after`) |
| 5xx | `server_error` | Lỗi phía Anthropic |
| — | `network` | Lỗi mạng / timeout |

Dữ liệu **không khả dụng** được báo rõ (`Usage Report không khả dụng`,
`Cost Report không khả dụng`) chứ không gán giá trị 0 giả.


### Đăng ký

```http
POST /api/auth/register
Content-Type: application/json

{ "name": "Nguyễn Văn A", "email": "a@congty.com", "password": "Abc12345" }
```

**201**
```json
{
  "message": "Đăng ký thành công.",
  "user": {
    "id": "01ceef16-...",
    "email": "a@congty.com",
    "name": "Nguyễn Văn A",
    "avatarUrl": null,
    "isVerified": false,
    "createdAt": "2026-11-01T09:24:27.686Z"
  },
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

### Đăng nhập

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "demo@tokenscope.io", "password": "123456" }
```

Response giống hệt đăng ký (status `200`).

### Mã lỗi

| HTTP | `code` | Ý nghĩa |
|---|---|---|
| 400 | `BAD_REQUEST` | Dữ liệu không hợp lệ (email sai định dạng, mật khẩu yếu) |
| 401 | `INVALID_CREDENTIALS` | Sai email hoặc mật khẩu |
| 401 | `MISSING_TOKEN` | Thiếu header `Authorization: Bearer <token>` |
| 401 | `TOKEN_EXPIRED` | Access token đã hết hạn |
| 401 | `ACCOUNT_DISABLED` | Tài khoản bị vô hiệu hoá |
| 409 | `EMAIL_ALREADY_EXISTS` | Email đã đăng ký |
| 500 | `INTERNAL_ERROR` | Lỗi hệ thống |

Response lỗi luôn có cấu trúc:

```json
{
  "message": "Email hoặc mật khẩu không đúng.",
  "code": "INVALID_CREDENTIALS"
}
```

## Cấu hình

`.env` (xem `.env.example`):

```env
DATABASE_URL="sqlserver://localhost:1433;database=TokenScope;user=<USER>;password=<PASSWORD>;encrypt=false;trustServerCertificate=true;connectionLimit=5"
JWT_ACCESS_SECRET="..."
JWT_REFRESH_SECRET="..."
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="30d"
PORT=3000
NODE_ENV=development
CORS_ORIGIN="http://localhost:3000,http://localhost:8099"

# OpenAI
OPENAI_API_KEY="sk-..."
OPENAI_ADMIN_API_KEY="sk-admin-..."
OPENAI_ORG_ACCESS_ENABLED="true"
OPENAI_ORG_ALLOWED_USER_IDS=""
OPENAI_BASE_URL="https://api.openai.com"

# Anthropic Claude
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_ADMIN_API_KEY="sk-ant-admin-..."
ANTHROPIC_WORKSPACE_ID="wsp_..."
ANTHROPIC_BASE_URL="https://api.anthropic.com"
```

> Prisma **không** hỗ trợ Windows Authentication cho SQL Server — phải dùng SQL
> Authentication, và định dạng chuỗi kết nối dùng dấu `;` với `user`/`password`
> nằm trong chuỗi (không dùng dạng `user:pass@host`).

### OpenAI — hai loại API Key

OpenAI tách rõ hai loại khoá, TokenScope cũng tách theo đúng ranh giới đó:

| Biến môi trường | Loại khoá | Dùng cho |
|---|---|---|
| `OPENAI_API_KEY` | Secret API Key | `GET /v1/models` (danh sách model) và gọi model |
| `OPENAI_ADMIN_API_KEY` | Admin API Key (Organization) | `GET /v1/organization/usage/completions`, `GET /v1/organization/costs` |

Quy tắc:

- Khoá **không bao giờ** được hardcode trong source — đọc từ `.env`.
- **Admin API Key chỉ sống ở backend**: không lưu vào database, không trả về
  frontend, không ghi vào log.
- **Admin API Key không bao giờ dùng để gọi model inference** — chỉ dùng cho
  endpoint `/v1/organization/*`.
- Secret API Key của người dùng (lưu mã hoá trong `api_providers.apiKeyCipher`)
  **không** thay thế được Admin API Key: OpenAI trả `403` cho các endpoint
  Organization nếu dùng secret key.

Vì sao cần `OPENAI_ORG_ACCESS_ENABLED`? Dữ liệu Usage/Costs là của **toàn tổ
chức** nên có thể nhìn thấy hoạt động của các thành viên khác. Endpoint đọc
trực tiếp (`/api/providers/openai/*`) mặc định **tắt**; chủ dự án phải bật
tường minh. Nếu cần giới hạn theo người dùng, đặt `OPENAI_ORG_ALLOWED_USER_IDS`
(danh sách userId phân tách bằng dấu phẩy).

### Quyền cần cấp trên OpenAI Platform

| Endpoint | Quyền |
|---|---|
| `GET /v1/models` | Secret API Key thông thường (`sk-...`) |
| `GET /v1/organization/usage/completions` | Admin API Key (`sk-admin-...`) + bật **Usage** trong Organization settings |
| `GET /v1/organization/costs` | Admin API Key (`sk-admin-...`) + bật **Costs** trong Organization settings |

Tạo Admin API Key tại
`https://platform.openai.com/settings/organization/admin-keys`. Nếu chưa bật
quyền, OpenAI trả `403` và TokenScope trả về thông điệp yêu cầu kiểm tra
quyền Organization.

### Anthropic Claude — hai loại API Key

Claude cũng tách hai loại khoá, và TokenScope xử lý **hoàn toàn độc lập** với
OpenAI (client/service riêng, không dùng chung khoá hay endpoint):

| Biến môi trường | Loại khoá | Dùng cho |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret API Key | `GET /v1/models` (kiểm tra kết nối + danh sách model) và gọi model |
| `ANTHROPIC_ADMIN_API_KEY` | Admin API Key (Organization) | `GET /v1/organizations/usage_report/messages`, `GET /v1/organizations/cost_report` |
| `ANTHROPIC_WORKSPACE_ID` | Workspace ID (`wsp_...`) | Header `anthropic-workspace-id` (tuỳ chọn) |

Quy tắc:

- Khoá **không bao giờ** được hardcode trong source — đọc từ `.env` hoặc do
  người dùng nhập (mã hoá trong `api_providers`).
- **Secret API Key không bao giờ dùng cho endpoint tổ chức** và ngược lại —
  Anthropic trả `401`/`403` khi dùng sai loại khoá.
- Việc kiểm tra Secret API Key **không suy ra** được trạng thái Admin API Key
  và ngược lại. Hai trạng thái được báo riêng: `connected`, `invalid`,
  `missingPermissions`, `missingWorkspace`, `missing`.
- Header bắt buộc: `x-api-key`, `anthropic-version: 2023-06-01`,
  `content-type: application/json`.
- **Workspace ID** không hardcode — đến từ người dùng nhập hoặc biến môi
  trường. Chỉ gửi header `anthropic-workspace-id` khi có Workspace ID.
- Ba khoá (Secret, Admin, Workspace) được mã hoá **riêng biệt** bằng
  AES-256-GCM và **không bao giờ** trả bản rõ về frontend.

### Quyền cần cấp trên Anthropic Console

| Endpoint | Quyền |
|---|---|
| `GET /v1/models` | Secret API Key thông thường (`sk-ant-...`) |
| `GET /v1/organizations/usage_report/messages` | Admin API Key (`sk-ant-admin-...`) + quyền đọc **Usage** cấp tổ chức |
| `GET /v1/organizations/cost_report` | Admin API Key (`sk-ant-admin-...`) + quyền đọc **Costs** cấp tổ chức |

Tạo Admin API Key tại `https://console.anthropic.com/settings/admin-keys`.

### Endpoint cập nhật khoá (Anthropic & OpenAI)

`PATCH /api/providers/:id/keys` cho phép cập nhật **từng loại khoá độc lập** —
chỉ trường được gửi lên mới thay đổi, các trường khác giữ nguyên:

```http
PATCH /api/providers/:id/keys
{ "adminApiKey": "sk-ant-admin-..." }   # chỉ thay Admin API Key
{ "apiKey": "sk-ant-..." }               # chỉ thay Secret API Key
{ "workspaceId": "wsp_..." }             # chỉ thay Workspace ID
{ "clearAdminApiKey": true }             # xoá Admin API Key đã lưu
```

Khoá mới luôn được kiểm tra với nhà cung cấp thật trước khi lưu.


## Tạo SQL login (chạy một lần)

```sql
USE [master];
CREATE LOGIN [tokenscope] WITH PASSWORD = 'TokenScope2026Db', CHECK_POLICY = OFF;
GO
USE [TokenScope];
CREATE USER [tokenscope] FOR LOGIN [tokenscope];
ALTER ROLE [db_owner] ADD MEMBER [tokenscope];
GO
-- Cần cho `prisma migrate dev` tạo shadow database:
ALTER SERVER ROLE [dbcreator] ADD MEMBER [tokenscope];
GO
```

## Chạy

```bash
npm install
npx prisma migrate deploy   # áp dụng migration
npm run prisma:seed         # nạp dữ liệu mẫu
npm run dev                 # http://localhost:3000
```

Tài khoản demo: **demo@tokenscope.io / 123456**

## Kiểm thử

```bash
npm test
```

Bao gồm 15 test: đăng ký, đăng nhập (thành công / sai mật khẩu / email không tồn tại),
validate, quên mật khẩu, refresh token, `/me` (có token / thiếu token / token sai),
và route 404.
