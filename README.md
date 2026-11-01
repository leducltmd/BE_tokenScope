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
```

> Prisma **không** hỗ trợ Windows Authentication cho SQL Server — phải dùng SQL
> Authentication, và định dạng chuỗi kết nối dùng dấu `;` với `user`/`password`
> nằm trong chuỗi (không dùng dạng `user:pass@host`).

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
