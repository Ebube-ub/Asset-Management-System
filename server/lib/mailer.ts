import { query } from '../db/index.js';
import { uid } from './repo.js';

/**
 * Transactional email without a vendor lock-in or a new dependency.
 *
 * Delivery providers are configured with environment variables (never with a
 * value committed to the repository):
 *   MAIL_FROM            the verified sender, e.g. "I4nnova <assets@i4nnova.com>"
 *   RESEND_API_KEY       sends through https://api.resend.com
 *   MAIL_WEBHOOK_URL     POSTs { to, subject, text } to any internal relay
 *   MAIL_WEBHOOK_TOKEN   optional Bearer token for that relay
 *   APP_URL              public origin used to build links (default 127.0.0.1:5173)
 *
 * Every attempt is written to email_log first, keyed by a deterministic dedupe
 * key, so a retried action never sends the same notice twice and a delivery
 * failure is recorded instead of corrupting the request or stock transaction.
 */

export type MailInput = {
  to: string | null | undefined;
  subject: string;
  body: string;
  dedupeKey: string;
};

export type MailResult = 'sent' | 'skipped' | 'failed' | 'duplicate' | 'invalid';

const APP_URL = (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/+$/, '');

export function appUrl(path: string): string {
  return `${APP_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.MAIL_WEBHOOK_URL);
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (!input.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.to)) return 'invalid';

  const id = uid();
  let inserted: { id: string }[];
  try {
    inserted = await query<{ id: string }>(
      `insert into email_log (id, dedupe_key, to_email, subject, body, status)
       values ($1,$2,$3,$4,$5,'queued')
       on conflict (dedupe_key) do nothing
       returning id`,
      [id, input.dedupeKey, input.to, input.subject, input.body],
    );
  } catch (error) {
    console.error('[mail] could not queue message', error);
    return 'failed';
  }
  // Another action already queued this exact notice.
  if (!inserted.length) return 'duplicate';

  if (!mailConfigured()) {
    await mark(id, 'skipped', null);
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[mail:skipped] ${input.subject} → ${input.to}`);
    }
    return 'skipped';
  }

  try {
    await deliver(input);
    await mark(id, 'sent', null);
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mail] delivery failed for ${input.to}: ${message}`);
    await mark(id, 'failed', message.slice(0, 500));
    return 'failed';
  }
}

async function mark(id: string, status: 'sent' | 'failed' | 'skipped', error: string | null) {
  try {
    await query(
      `update email_log
          set status = $2, attempts = attempts + 1, error = $3,
              sent_at = case when $2 = 'sent' then now() else sent_at end
        where id = $1`,
      [id, status, error],
    );
  } catch (e) {
    console.error('[mail] could not record delivery result', e);
  }
}

async function deliver(input: MailInput): Promise<void> {
  const from = process.env.MAIL_FROM ?? 'I4nnova Asset Management <no-reply@i4nnova.local>';
  const resendKey = process.env.RESEND_API_KEY;
  const webhook = process.env.MAIL_WEBHOOK_URL;

  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.body }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend responded ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return;
  }

  if (webhook) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.MAIL_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.MAIL_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.body }),
    });
    if (!res.ok) throw new Error(`Mail webhook responded ${res.status}`);
    return;
  }

  throw new Error('No email provider is configured.');
}

/** Email addresses for a set of staff ids, ignoring people who have left. */
export async function emailsForStaff(ids: (string | null | undefined)[]): Promise<string[]> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return [];
  const rows = await query<{ email: string }>(
    `select email from staff where id = any($1::uuid[]) and left_at is null`,
    [unique],
  );
  return rows.map((r) => r.email);
}

export async function emailsForRoles(roles: string[]): Promise<string[]> {
  if (!roles.length) return [];
  const rows = await query<{ email: string }>(
    `select distinct s.email
       from staff_role sr join staff s on s.id = sr.staff_id
      where sr.role = any($1::text[]) and s.left_at is null`,
    [roles],
  );
  return rows.map((r) => r.email);
}

/** Human-readable block used by every notice. */
export function mailBody(lines: string[]): string {
  return `I4nnova Asset Management\n\n${lines.filter(Boolean).join('\n')}\n\nThis is an automated message from the asset management system.`;
}
