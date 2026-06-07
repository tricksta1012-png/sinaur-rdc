import { sql } from '../db.js';
import { config } from '../config.js';

export async function enqueueSms(phone: string, message: string, scheduledAt?: Date): Promise<void> {
  await sql`
    INSERT INTO sms_queue (to_phone, message, scheduled_at)
    VALUES (${phone}, ${message}, ${scheduledAt ?? new Date()})
  `;
}

export async function sendAcknowledgment(phone: string, eventTitle: string): Promise<void> {
  const message = `SINAUR-RDC: Votre signalement "${eventTitle.slice(0, 40)}..." a été reçu. Merci. Répondez STOP pour ne plus recevoir ces messages.`;
  await enqueueSms(phone, message);
}

export async function processSmsQueue(): Promise<void> {
  if (!config.SMS_GATEWAY_URL || !config.SMS_GATEWAY_API_KEY) return;

  const pending = await sql`
    SELECT id, to_phone, message
    FROM sms_queue
    WHERE status = 'pending' AND scheduled_at <= NOW() AND attempts < 3
    ORDER BY scheduled_at
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  `;

  for (const sms of pending) {
    try {
      const response = await fetch(`${config.SMS_GATEWAY_URL}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.SMS_GATEWAY_API_KEY}`,
        },
        body: JSON.stringify({
          to: sms.toPhone,
          from: config.SMS_SENDER_ID,
          message: sms.message,
        }),
      });

      if (!response.ok) throw new Error(`SMS gateway HTTP ${response.status}`);

      await sql`
        UPDATE sms_queue SET status = 'sent', sent_at = NOW() WHERE id = ${sms.id}
      `;
    } catch (err) {
      await sql`
        UPDATE sms_queue
        SET attempts = attempts + 1,
            last_error = ${String(err)},
            status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END
        WHERE id = ${sms.id}
      `;
    }
  }
}
