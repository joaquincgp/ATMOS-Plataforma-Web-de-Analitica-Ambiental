from __future__ import annotations

import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    pass


def _send_with_acs(*, to_email: str, subject: str, plain_text: str, html: str) -> None:
    settings = get_settings()
    if not settings.acs_email_connection_string or not settings.acs_email_sender_address:
        raise EmailDeliveryError("Azure Communication Services email settings are not configured.")

    try:
        from azure.communication.email import EmailClient
    except ImportError as exc:  # pragma: no cover - depends on optional runtime package install
        raise EmailDeliveryError("azure-communication-email package is not installed.") from exc

    client = EmailClient.from_connection_string(settings.acs_email_connection_string)
    try:
        poller = client.begin_send(
            {
                "senderAddress": settings.acs_email_sender_address,
                "recipients": {"to": [{"address": to_email}]},
                "content": {
                    "subject": subject,
                    "plainText": plain_text,
                    "html": html,
                },
            },
        )
        result = poller.result()
        logger.info("ACS email accepted. To=%s Subject=%s Result=%s", to_email, subject, result)
    except Exception as exc:
        raise EmailDeliveryError(f"Azure Communication Services could not send email: {exc}") from exc


def send_email(*, to_email: str, subject: str, plain_text: str, html: str) -> None:
    settings = get_settings()
    provider = settings.email_provider.lower().strip()

    if provider == "acs":
        _send_with_acs(to_email=to_email, subject=subject, plain_text=plain_text, html=html)
        return

    if settings.environment.lower() == "production":
        raise EmailDeliveryError("EMAIL_PROVIDER=acs is required in production.")

    logger.info("Email provider disabled/log. To=%s Subject=%s Body=%s", to_email, subject, plain_text)


def send_verification_email(*, to_email: str, full_name: str, verification_url: str) -> None:
    subject = "Verifica tu cuenta ATMOS"
    plain_text = (
        f"Hola {full_name},\n\n"
        "Confirma tu correo institucional para activar tu cuenta ATMOS:\n"
        f"{verification_url}\n\n"
        "Si no creaste esta cuenta, puedes ignorar este mensaje."
    )
    html = f"""
    <p>Hola {full_name},</p>
    <p>Confirma tu correo institucional para activar tu cuenta ATMOS.</p>
    <p><a href="{verification_url}">Verificar cuenta</a></p>
    <p>Si no creaste esta cuenta, puedes ignorar este mensaje.</p>
    """
    send_email(to_email=to_email, subject=subject, plain_text=plain_text, html=html)


def send_password_reset_email(*, to_email: str, full_name: str, reset_url: str) -> None:
    subject = "Recupera tu contraseña ATMOS"
    plain_text = (
        f"Hola {full_name},\n\n"
        "Usa este enlace para cambiar tu contraseña ATMOS:\n"
        f"{reset_url}\n\n"
        "El enlace expira pronto. Si no solicitaste este cambio, puedes ignorar este mensaje."
    )
    html = f"""
    <p>Hola {full_name},</p>
    <p>Usa este enlace para cambiar tu contraseña ATMOS.</p>
    <p><a href="{reset_url}">Cambiar contraseña</a></p>
    <p>El enlace expira pronto. Si no solicitaste este cambio, puedes ignorar este mensaje.</p>
    """
    send_email(to_email=to_email, subject=subject, plain_text=plain_text, html=html)
