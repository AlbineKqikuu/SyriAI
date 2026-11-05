using System.Net;
using System.Net.Http.Json;
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
/// Brevo e-mail API (section "Brevo"). Sends over HTTPS, so it works on hosts that block SMTP
/// ports, such as Render's free plan. The sender is Smtp:FromEmail / Smtp:FromName and must be
/// a verified sender in the Brevo account.
/// </summary>
public class BrevoOptions
{
    public const string Section = "Brevo";

    public string? ApiKey { get; set; }
}

/// <summary>An e-mail could not be sent (any provider, including a timeout).</summary>
public class EmailSendException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Sends Identity e-mails: through the Brevo API when Brevo:ApiKey is set, otherwise through SMTP
/// (e.g. Gmail with an app password). Every attempt gives up after <see cref="Timeout"/>, so a
/// blocked connection can never leave a page loading for minutes. When nothing is configured,
/// <see cref="AccountCodeService"/> writes the code to the server log instead.
/// </summary>
public class EmailSender : IEmailSender
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);
    private const string BrevoUrl = "https://api.brevo.com/v3/smtp/email";

    private readonly SmtpOptions _smtp;
    private readonly BrevoOptions _brevo;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<EmailSender> _logger;

    public EmailSender(IOptions<SmtpOptions> smtp, IOptions<BrevoOptions> brevo, IHttpClientFactory http, ILogger<EmailSender> logger)
    {
        _smtp = smtp.Value;
        _brevo = brevo.Value;
        _http = http;
        _logger = logger;
    }

    private bool UseBrevo => !string.IsNullOrWhiteSpace(_brevo.ApiKey) && !string.IsNullOrWhiteSpace(_smtp.FromEmail);

    public bool IsConfigured => UseBrevo || _smtp.IsConfigured;

    public async Task SendEmailAsync(string email, string subject, string htmlMessage)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("E-mail is not configured; \"{Subject}\" to {Email} was not sent.", subject, email);
            return;
        }

        using var timeout = new CancellationTokenSource(Timeout);
        try
        {
            if (UseBrevo) await SendWithBrevoAsync(email, subject, htmlMessage, timeout.Token);
            else await SendWithSmtpAsync(email, subject, htmlMessage, timeout.Token);
            _logger.LogInformation("Sent e-mail \"{Subject}\" to {Email} via {Provider}.", subject, email, UseBrevo ? "Brevo" : "SMTP");
        }
        catch (OperationCanceledException ex)
        {
            throw new EmailSendException($"Sending timed out after {Timeout.TotalSeconds:0} s (is the {(UseBrevo ? "Brevo API" : "SMTP server")} reachable?).", ex);
        }
        catch (Exception ex) when (ex is SmtpException or HttpRequestException or IOException)
        {
            throw new EmailSendException(ex.Message, ex);
        }
    }

    private async Task SendWithBrevoAsync(string email, string subject, string html, CancellationToken token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, BrevoUrl)
        {
            Content = JsonContent.Create(new
            {
                sender = new { name = _smtp.FromName, email = _smtp.FromEmail },
                to = new[] { new { email } },
                subject,
                htmlContent = html,
            }),
        };
        request.Headers.Add("api-key", _brevo.ApiKey);
        request.Headers.Accept.ParseAdd("application/json");

        using var response = await _http.CreateClient().SendAsync(request, token);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(token);
            throw new EmailSendException($"Brevo answered {(int)response.StatusCode}: {body}");
        }
    }

    private async Task SendWithSmtpAsync(string email, string subject, string html, CancellationToken token)
    {
        using var message = new MailMessage
        {
            From = new MailAddress(_smtp.FromEmail!, _smtp.FromName),
            Subject = subject,
            Body = html,
            IsBodyHtml = true,
        };
        message.To.Add(email);

        using var client = new SmtpClient(_smtp.Host, _smtp.Port)
        {
            EnableSsl = _smtp.EnableSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Credentials = string.IsNullOrEmpty(_smtp.User) ? null : new NetworkCredential(_smtp.User, _smtp.Password),
        };
        // SmtpClient.Timeout only covers the synchronous Send; the token covers the async one
        await client.SendMailAsync(message, token);
    }
}
