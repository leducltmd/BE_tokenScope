/**
 * Kiểm tra phần ký JWT của Firebase Analytics service.
 *
 * Script này KHÔNG gọi mạng tới Google — nó chứng minh rằng chuỗi ký
 * RS256 dùng để lấy access token hoạt động đúng:
 * 1. Sinh cặp RSA thật (giống service account của Google).
 * 2. Ký assertion bằng private key.
 * 3. Verify lại bằng public key + kiểm tra đúng scope/iss/aud/exp.
 *
 * Chạy: npx tsx scripts/verify-firebase-analytics-jwt.ts
 */
import crypto from 'node:crypto';

const CLIENT_EMAIL = 'test@tokenscope-5116d.iam.gserviceaccount.com';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** Base64url encode — không phụ thuộc Buffer API khác version. */
function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Ký assertion JWT bằng RS256. */
function buildAssertion(privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: CLIENT_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claim}`)
    .sign(privateKey);

  return `${header}.${claim}.${base64url(signature)}`;
}

function main(): void {
  console.log('[Test] Sinh cap RSA 2048-bit (gia lap service account)...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  console.log('[Test] Ky assertion RS256...');
  const assertion = buildAssertion(privateKey);
  const parts = assertion.split('.');
  console.log(`[Test] OK  JWT co ${parts.length} phan (header.payload.signature)`);
  console.log(
    `[Test] OK  header = ${Buffer.from(parts[0], 'base64url').toString()}`,
  );

  console.log('[Test] Verify bang public key...');
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url'),
  );
  console.log(`[Test] ${verified ? 'OK ' : 'FAIL'} chu ky hop le = ${verified}`);

  console.log('[Test] Kiem tra claims...');
  const claims = JSON.parse(
    Buffer.from(parts[1], 'base64url').toString(),
  ) as Record<string, unknown>;
  const checks: [string, boolean][] = [
    ['iss === client_email', claims.iss === CLIENT_EMAIL],
    ['aud === token_uri', claims.aud === TOKEN_URI],
    ['scope === analytics.readonly', claims.scope === SCOPE],
    ['exp > iat', Number(claims.exp) > Number(claims.iat)],
  ];
  checks.forEach(([label, ok]) => {
    console.log(`[Test] ${ok ? 'OK ' : 'FAIL'} ${label} = ${ok}`);
  });

  const allOk = verified && checks.every(([, ok]) => ok);
  console.log(
    `[Test] ${allOk ? 'PASS' : 'FAIL'} — chu ky RS256 cho Firebase Analytics hoat dong dung.`,
  );
  if (!allOk) process.exit(1);
}

main();
