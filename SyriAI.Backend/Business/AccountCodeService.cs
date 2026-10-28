using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;

namespace SyriAI.Backend.Business;

public enum CodePurpose
{
    ConfirmEmail,
    ResetPassword,
}

public enum CodeCheck
{
    /// <summary>Code accepted and the action succeeded.</summary>
    Ok,
    /// <summary>Wrong or expired code.</summary>
    Invalid,
    /// <summary>Too many wrong codes: a new code must be requested.</summary>
    TooManyAttempts,
    /// <summary>Code accepted but the action failed, e.g. the new password breaks the rules.</summary>
    Failed,
}

/// <summary>
/// Six-digit e-mail codes for account verification and password reset.
///
/// Every request gets a new random code (never the same as the previous one). Only its SHA-256
/// hash is kept, in memory, for <see cref="ValidMinutes"/> minutes; a code works once and a new
/// code replaces the old one. On top of that this service limits wrong attempts per code and how
/// often a new code can be requested.
/// </summary>
public class AccountCodeService
{
    public const int MaxAttempts = 5;
    public static readonly TimeSpan ResendCooldown = TimeSpan.FromSeconds(60);
    public const int ValidMinutes = 5;

    private readonly UserManager<IdentityUser> _users;
    private readonly SmtpEmailSender _email;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AccountCodeService> _logger;

    public AccountCodeService(UserManager<IdentityUser> users, SmtpEmailSender email, IMemoryCache cache, ILogger<AccountCodeService> logger)
    {
        _users = users;
        _email = email;
        _cache = cache;
        _logger = logger;
    }

    /// <summary>False when SMTP is missing and codes are only written to the server log.</summary>
    public bool CanSendEmail => _email.IsConfigured;

    /// <summary>Seconds until a new code may be sent (0 = now).</summary>
    public int SecondsUntilResend(IdentityUser user, CodePurpose purpose) =>
        _cache.TryGetValue(CooldownKey(user, purpose), out DateTimeOffset until)
            ? Math.Max(0, (int)Math.Ceiling((until - DateTimeOffset.UtcNow).TotalSeconds))
            : 0;

    /// <summary>Send a new code unless one was sent less than a minute ago. Returns true when sent.</summary>
    public async Task<bool> SendCodeAsync(IdentityUser user, CodePurpose purpose)
    {
        if (SecondsUntilResend(user, purpose) > 0) return false;

        var code = NewCode(user, purpose);
        _cache.Set(CodeKey(user, purpose), Hash(code), TimeSpan.FromMinutes(ValidMinutes));

        _cache.Set(CooldownKey(user, purpose), DateTimeOffset.UtcNow + ResendCooldown, ResendCooldown);
        _cache.Remove(AttemptsKey(user, purpose)); // a fresh code gets fresh attempts

        var (subject, intro) = purpose == CodePurpose.ConfirmEmail
            ? ("Kodi i verifikimit për SyriAI", "Përdorni këtë kod për të verifikuar adresën tuaj të email-it dhe për të aktivizuar llogarinë në SyriAI Studio.")
            : ("Kodi për rivendosjen e fjalëkalimit", "Përdorni këtë kod për të vendosur një fjalëkalim të ri për llogarinë tuaj në SyriAI Studio.");

        if (!_email.IsConfigured)
        {
            // Local development without SMTP: the code is only visible to whoever runs the server
            _logger.LogWarning("SMTP nuk është konfiguruar — email-i nuk u dërgua. Kodi ({Purpose}) për {Email}: {Code}",
                purpose, user.Email, code);
            return true;
        }

        await _email.SendEmailAsync(user.Email!, subject, BuildEmail(subject, intro, code));
        return true;
    }

    /// <summary>Check a code and, if it is right, confirm the e-mail or set the new password.</summary>
    public async Task<(CodeCheck Result, IdentityResult? Identity)> UseCodeAsync(
        IdentityUser user, CodePurpose purpose, string code, string? newPassword = null)
    {
        var attemptsKey = AttemptsKey(user, purpose);
        var attempts = _cache.GetOrCreate(attemptsKey, e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(ValidMinutes * 2);
            return 0;
        });
        if (attempts >= MaxAttempts) return (CodeCheck.TooManyAttempts, null);

        code = new string((code ?? "").Where(char.IsDigit).ToArray());
        var codeKey = CodeKey(user, purpose);
        if (!_cache.TryGetValue(codeKey, out byte[]? expected) || expected == null
            || !CryptographicOperations.FixedTimeEquals(expected, Hash(code)))
        {
            _cache.Set(attemptsKey, attempts + 1, TimeSpan.FromMinutes(ValidMinutes * 2));
            return (CodeCheck.Invalid, null);
        }

        // The code is right: carry out the action with a one-off Identity token
        var result = purpose == CodePurpose.ConfirmEmail
            ? await _users.ConfirmEmailAsync(user, await _users.GenerateEmailConfirmationTokenAsync(user))
            : await _users.ResetPasswordAsync(user, await _users.GeneratePasswordResetTokenAsync(user), newPassword!);

        if (result.Succeeded)
        {
            _cache.Remove(codeKey);
            _cache.Remove(attemptsKey);
            return (CodeCheck.Ok, result);
        }
        // A password that breaks the rules is not a wrong code: the code stays valid
        return (CodeCheck.Failed, result);
    }

    /// <summary>Random six-digit code, different from the code sent last time</summary>
    private string NewCode(IdentityUser user, CodePurpose purpose)
    {
        var lastKey = $"code-last:{purpose}:{user.Id}";
        _cache.TryGetValue(lastKey, out string? last);
        string code;
        do code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        while (code == last);
        _cache.Set(lastKey, code, TimeSpan.FromHours(1));
        return code;
    }

    private static byte[] Hash(string code) => SHA256.HashData(Encoding.UTF8.GetBytes(code));

    private static string CodeKey(IdentityUser user, CodePurpose purpose) => $"code:{purpose}:{user.Id}";

    private static string CooldownKey(IdentityUser user, CodePurpose purpose) => $"code-sent:{purpose}:{user.Id}";
    private static string AttemptsKey(IdentityUser user, CodePurpose purpose) => $"code-attempts:{purpose}:{user.Id}";

    private static string BuildEmail(string title, string intro, string code)
    {
        var enc = HtmlEncoder.Default;
        return $"""
            <!DOCTYPE html>
            <html lang="sq"><body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
                <tr><td align="center">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
                    <tr><td style="background:#0b1220;padding:20px 28px;font-size:22px;font-weight:800;color:#ffffff;">
                      Syri<span style="color:#4da3ff;">AI</span> <span style="font-size:12px;letter-spacing:2px;color:#aab4c8;">STUDIO</span>
                    </td></tr>
                    <tr><td style="padding:28px;">
                      <h1 style="margin:0 0 12px;font-size:20px;color:#0b1220;">{enc.Encode(title)}</h1>
                      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#3c4150;">{enc.Encode(intro)}</p>
                      <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;padding:16px;background:#eef4ff;border-radius:10px;color:#0a66ff;font-family:'Courier New',monospace;">{enc.Encode(code)}</div>
                      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b7080;">Kodi vlen për {ValidMinutes} minuta. Nëse nuk e keni kërkuar ju, injorojeni këtë email — llogaria juaj mbetet e sigurt.</p>
                    </td></tr>
                  </table>
                </td></tr>
              </table>
            </body></html>
            """;
    }
}
