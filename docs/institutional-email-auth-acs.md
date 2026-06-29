# ATMOS Institutional Email Verification With Azure Communication Services

This guide configures ATMOS to accept only institutional `@udla.edu.ec` accounts, verify identity by email, and send password recovery links through Azure Communication Services.

## Backend Environment Variables

Use these values locally with `.env` or in Azure as app/container environment variables:

```env
ALLOWED_EMAIL_DOMAINS=udla.edu.ec
FRONTEND_BASE_URL=http://localhost:5173
BACKEND_BASE_URL=http://localhost:8000

EMAIL_PROVIDER=acs
ACS_EMAIL_CONNECTION_STRING=<acs-connection-string>
ACS_EMAIL_SENDER_ADDRESS=<mail-from-address-from-verified-domain>
EMAIL_FROM_NAME=ATMOS

EMAIL_VERIFICATION_TOKEN_EXPIRE_MINUTES=1440
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES=30
```

For production, change:

```env
FRONTEND_BASE_URL=https://<frontend-domain>
BACKEND_BASE_URL=https://<backend-domain>
ENVIRONMENT=production
EMAIL_PROVIDER=acs
```

Frontend:

```env
VITE_API_BASE_URL=https://<backend-domain>
```

## Azure Communication Services Email Setup

1. Create or open an Azure Communication Services resource.
2. Create or connect an Email Communication Services resource.
3. Use either the Azure-managed sender domain or a verified custom domain.
4. Copy the connection string from the ACS resource.
5. Copy the sender address from the verified email domain.
6. Set:
   - `EMAIL_PROVIDER=acs`
   - `ACS_EMAIL_CONNECTION_STRING`
   - `ACS_EMAIL_SENDER_ADDRESS`

## Database Migration

Run the migration before testing verification emails:

```bash
cd apps/backend
alembic upgrade head
```

## Local Test Flow

1. Start backend and frontend.
2. Register with a `@udla.edu.ec` email.
3. In development with `EMAIL_PROVIDER=log`, inspect backend logs for the verification link.
4. Open the verification link.
5. Sign in with email/password.
6. Test forgot password and open the reset link from logs or email.

## Expected Behavior

- Non-`@udla.edu.ec` emails are rejected by the backend.
- New accounts remain `pending_validation` until the verification link is opened.
- Email/password accounts cannot log in until verified.
- Password reset and account verification emails are sent by ACS when `EMAIL_PROVIDER=acs`.
- In production, log-only email delivery is blocked.
