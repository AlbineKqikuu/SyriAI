using System.Net;
using System.Net.Mail;
using Microsoft.AspNetCore.Identity.UI.Services;
using Microsoft.Extensions.Options;

namespace SyriAI.Backend.Business;

/// <summary>SMTP settings (section "Smtp"). Keep User/Password in user-secrets, never in source.</summary>
public class SmtpOptions
{
    public const string Section = "Smtp";

    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string? User { get; set; }
    public string? Password { get; set; }
    public string? FromEmail { get; set; }
    public string FromName { get; set; } = "SyriAI Studio";

    // A login user without its password (e.g. the app password not added yet) counts as not configured
    public bool IsConfigured => !string.IsNullOrWhiteSpace(Host) && !string.IsNullOrWhiteSpace(FromEmail)
        && (string.IsNullOrWhiteSpace(User) || !string.IsNullOrWhiteSpace(Password));
}

/// <summary>
/// Sends Identity e-mails through SMTP (e.g. Gmail with an app password, Outlook, Mailtrap).
/// When SMTP is not configured nothing is sent; <see cref="AccountCodeService"/> then writes the
/// code to the server log so the flow can still be tested locally.
/// </summary>
public class SmtpEmailSender : IEmailSender
{
    private readonly SmtpOptions _options;
    private readonly ILogger<SmtpEmailSender> _logger;

    public SmtpEmailSender(IOptions<SmtpOptions> options, ILogger<SmtpEmailSender> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public bool IsConfigured => _options.IsConfigured;

    public async Task SendEmailAsync(string email, string subject, string htmlMessage)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("SMTP is not configured; e-mail \"{Subject}\" to {Email} was not sent.", subject, email);
            return;
        }

        using var message = new MailMessage
        {
            From = new MailAddress(_options.FromEmail!, _options.FromName),
            Subject = subject,
            Body = htmlMessage,
            IsBodyHtml = true,
        };
        message.To.Add(email);

        using var client = new SmtpClient(_options.Host, _options.Port)
        {
            EnableSsl = _options.EnableSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Credentials = string.IsNullOrEmpty(_options.User) ? null : new NetworkCredential(_options.User, _options.Password),
        };

        await client.SendMailAsync(message);
        _logger.LogInformation("Sent e-mail \"{Subject}\" to {Email}.", subject, email);
    }
}
