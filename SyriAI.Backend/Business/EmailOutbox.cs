using System.Threading.Channels;
using Microsoft.Extensions.Caching.Memory;

namespace SyriAI.Backend.Business;

/// <summary>
/// Sends e-mails in the background, so a page (e.g. Register) answers at once instead of waiting
/// for the mail server. A failed send is remembered for a while per address, so the page that
/// asks for the code can tell the user and offer to send it again.
/// </summary>
public class EmailOutbox(EmailSender sender, IMemoryCache cache, ILogger<EmailOutbox> logger) : BackgroundService
{
    private static readonly TimeSpan RememberFailure = TimeSpan.FromMinutes(10);

    private readonly Channel<(string To, string Subject, string Html)> _queue =
        Channel.CreateBounded<(string, string, string)>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.DropOldest });

    /// <summary>Queue an e-mail; returns immediately</summary>
    public void Enqueue(string to, string subject, string html)
    {
        cache.Remove(FailureKey(to));
        _queue.Writer.TryWrite((to, subject, html));
    }

    /// <summary>True when the last e-mail to this address could not be sent</summary>
    public bool LastSendFailed(string to) => cache.TryGetValue(FailureKey(to), out _);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var (to, subject, html) in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await sender.SendEmailAsync(to, subject, html);
            }
            catch (Exception ex)
            {
                // Never let one e-mail stop the queue
                logger.LogError(ex, "E-mail \"{Subject}\" to {Email} could not be sent", subject, to);
                cache.Set(FailureKey(to), true, RememberFailure);
            }
        }
    }

    private static string FailureKey(string email) => "email-failed:" + email.ToLowerInvariant();
}
