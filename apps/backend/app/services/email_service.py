# ruff: noqa: E501

from __future__ import annotations

import logging
from html import escape

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


def _email_shell(
    *,
    title: str,
    greeting: str,
    body: str,
    cta_label: str,
    cta_url: str,
    footer_note: str,
) -> str:
    # Embedded HTML/CSS email template: some inline-style lines exceed the limit
    # by design and cannot be wrapped without altering the rendered markup.
    # pylint: disable=line-too-long
    escaped_title = escape(title)
    escaped_greeting = escape(greeting)
    escaped_body = escape(body)
    escaped_cta_label = escape(cta_label)
    escaped_cta_url = escape(cta_url, quote=True)
    escaped_footer_note = escape(footer_note)

    return f"""<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>{escaped_title}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef7fb;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;">
            <tr>
              <td style="border-radius:22px;overflow:hidden;background:#ffffff;box-shadow:0 18px 48px rgba(31,90,138,0.16);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:0;background:#dff1fb;">
                      <div style="height:130px;background:linear-gradient(135deg,#e9f8f2 0%,#dff1fb 48%,#f7fbff 100%);">
                        <p style="margin:0;padding:36px 38px 0 38px;color:#0f172a;font-family:Georgia,'Times New Roman',serif;font-size:44px;line-height:1.05;font-weight:700;letter-spacing:0;">ATMOS</p>
                        <p style="margin:10px 38px 0 38px;color:#475569;font-size:15px;line-height:1.55;">Atmospheric Time-Series Modeling and Observation System</p>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:34px 38px 10px 38px;">
                      <p style="margin:2px 0 0 0;color:#64748b;font-size:13px;line-height:1.5;">Plataforma de Investigación Ambiental Académica y Analítica de Datos</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:22px 38px 8px 38px;">
                      <h2 style="margin:0 0 12px 0;color:#111827;font-size:24px;line-height:1.25;font-weight:700;">{escaped_title}</h2>
                      <p style="margin:0 0 14px 0;color:#334155;font-size:16px;line-height:1.65;">{escaped_greeting}</p>
                      <p style="margin:0;color:#334155;font-size:16px;line-height:1.65;">{escaped_body}</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:28px 38px 28px 38px;">
                      <a href="{escaped_cta_url}" target="_blank" style="display:inline-block;background:#509EE3;color:#ffffff;text-decoration:none;border-radius:10px;padding:15px 28px;font-size:16px;font-weight:700;box-shadow:0 10px 22px rgba(80,158,227,0.28);">{escaped_cta_label}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:22px 38px 30px 38px;background:#f3f8fb;border-top:1px solid #dceaf5;">
                      <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">{escaped_footer_note}</p>
                      <p style="margin:10px 0 0 0;color:#94a3b8;font-size:11px;line-height:1.5;">Universidad de Las Américas - Departamento de Investigación y Vinculación</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def send_verification_email(*, to_email: str, full_name: str, verification_url: str) -> None:
    subject = "Bienvenido a ATMOS - verifica tu cuenta"
    plain_text = (
        f"Hola {full_name},\n\n"
        "Bienvenido a ATMOS. Confirma tu correo institucional para activar tu cuenta:\n"
        f"{verification_url}\n\n"
        "Si no creaste esta cuenta, puedes ignorar este mensaje."
    )
    html = _email_shell(
        title="Bienvenido a ATMOS",
        greeting=f"Hola {full_name}, gracias por registrarte en ATMOS.",
        body="Para proteger el acceso a la plataforma, confirma tu correo institucional y activa tu cuenta.",
        cta_label="Verificar mi cuenta",
        cta_url=verification_url,
        footer_note=(
            "Si no creaste esta cuenta, puedes ignorar este mensaje. "
            "El enlace de verificacion expira por seguridad."
        ),
    )
    send_email(to_email=to_email, subject=subject, plain_text=plain_text, html=html)


def send_password_reset_email(*, to_email: str, full_name: str, reset_url: str) -> None:
    subject = "Recupera tu contraseña ATMOS"
    plain_text = (
        f"Hola {full_name},\n\n"
        "Usa este enlace para cambiar tu contraseña ATMOS:\n"
        f"{reset_url}\n\n"
        "El enlace expira pronto. Si no solicitaste este cambio, puedes ignorar este mensaje."
    )
    html = _email_shell(
        title="Recuperacion de contraseña",
        greeting=f"Hola {full_name}, recibimos una solicitud para cambiar tu contraseña.",
        body=(
            "Usa el siguiente boton para crear una nueva contraseña. "
            "Por seguridad, este enlace es de un solo uso y expira pronto."
        ),
        cta_label="Crear nueva contraseña",
        cta_url=reset_url,
        footer_note=(
            "Si no solicitaste este cambio, puedes ignorar este mensaje. "
            "Tu contraseña actual seguira siendo valida."
        ),
    )
    send_email(to_email=to_email, subject=subject, plain_text=plain_text, html=html)
