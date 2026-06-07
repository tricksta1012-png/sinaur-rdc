import { createHash, randomInt } from 'node:crypto';
import { sql } from '../db.js';

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 3;

export function generateOtpCode(): string {
  return String(randomInt(100000, 999999));
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function createOtp(phone: string): Promise<string> {
  const code = generateOtpCode();
  const hash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await sql`
    INSERT INTO otp_codes (phone, code_hash, expires_at)
    VALUES (${phone}, ${hash}, ${expiresAt})
  `;

  return code;
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const hash = hashCode(code);
  const [record] = await sql`
    SELECT id, attempts
    FROM otp_codes
    WHERE phone = ${phone}
      AND code_hash = ${hash}
      AND expires_at > NOW()
      AND used_at IS NULL
      AND attempts < ${MAX_ATTEMPTS}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!record) {
    // Increment attempts on failed lookup
    await sql`
      UPDATE otp_codes
      SET attempts = attempts + 1
      WHERE phone = ${phone}
        AND expires_at > NOW()
        AND used_at IS NULL
    `;
    return false;
  }

  await sql`
    UPDATE otp_codes SET used_at = NOW() WHERE id = ${record.id}
  `;
  return true;
}
