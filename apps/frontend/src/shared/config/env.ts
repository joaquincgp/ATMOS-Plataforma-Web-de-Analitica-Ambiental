const DEFAULT_API_BASE_URL = 'http://localhost:8000';
const DEFAULT_ALLOWED_EMAIL_DOMAINS = 'udla.edu.ec';

function parseAllowedEmailDomains(value: string): string[] {
  return value
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export const env = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? DEFAULT_API_BASE_URL,
  allowedEmailDomains: parseAllowedEmailDomains(
    (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS as string | undefined) ?? DEFAULT_ALLOWED_EMAIL_DOMAINS,
  ),
};
