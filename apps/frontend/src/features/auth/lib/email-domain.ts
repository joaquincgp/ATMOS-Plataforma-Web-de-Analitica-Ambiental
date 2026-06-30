import { env } from '@/shared/config/env';

export function isAllowedEmailDomain(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    return false;
  }
  const domain = normalized.split('@').pop() ?? '';
  return env.allowedEmailDomains.includes(domain);
}

export function allowedEmailDomainLabel(): string {
  return env.allowedEmailDomains.map((domain) => `@${domain}`).join(' o ');
}
