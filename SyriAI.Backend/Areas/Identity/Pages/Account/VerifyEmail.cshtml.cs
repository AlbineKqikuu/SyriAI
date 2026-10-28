using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using SyriAI.Backend.Business;

namespace SyriAI.Backend.Areas.Identity.Pages.Account
{
    /// <summary>
    /// Enter the 6-digit code sent after registration (or after trying to log in with an
    /// unverified account). The page never reveals whether an e-mail address has an account.
    /// </summary>
    public class VerifyEmailModel : PageModel
    {
        private readonly UserManager<IdentityUser> _userManager;
        private readonly SignInManager<IdentityUser> _signInManager;
        private readonly AccountCodeService _codes;
        private readonly ILogger<VerifyEmailModel> _logger;

        public VerifyEmailModel(UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager,
            AccountCodeService codes, ILogger<VerifyEmailModel> logger)
        {
            _userManager = userManager;
            _signInManager = signInManager;
            _codes = codes;
            _logger = logger;
        }

        [BindProperty(SupportsGet = true)]
        public string Email { get; set; } = "";

        [BindProperty]
        public string? Code { get; set; }

        public string? ReturnUrl { get; set; }
        public int ResendSeconds { get; private set; }
        public bool CanSendEmail => _codes.CanSendEmail;
        public int ValidMinutes => AccountCodeService.ValidMinutes;

        public async Task<IActionResult> OnGetAsync(string? returnUrl = null)
        {
            ReturnUrl = returnUrl;
            if (string.IsNullOrWhiteSpace(Email)) return RedirectToPage("./Login");

            var user = await _userManager.FindByEmailAsync(Email);
            if (user is { EmailConfirmed: true })
            {
                TempData["StatusMessage"] = "Email-i është verifikuar tashmë. Mund të kyçeni.";
                return RedirectToPage("./Login", new { returnUrl });
            }
            if (user != null) ResendSeconds = _codes.SecondsUntilResend(user, CodePurpose.ConfirmEmail);
            return Page();
        }

        public async Task<IActionResult> OnPostAsync(string? returnUrl = null)
        {
            ReturnUrl = returnUrl;
            returnUrl ??= Url.Content("~/");

            var user = await _userManager.FindByEmailAsync(Email);
            if (user is { EmailConfirmed: true })
            {
                TempData["StatusMessage"] = "Email-i është verifikuar tashmë. Mund të kyçeni.";
                return RedirectToPage("./Login", new { returnUrl });
            }

            if (string.IsNullOrWhiteSpace(Code) || user == null)
            {
                ModelState.AddModelError(string.Empty, "Kodi është i pasaktë ose ka skaduar.");
                return await ShowAgainAsync(user);
            }

            var (check, _) = await _codes.UseCodeAsync(user, CodePurpose.ConfirmEmail, Code);
            switch (check)
            {
                case CodeCheck.Ok:
                    _logger.LogInformation("E-mail verified for a user account.");
                    await _signInManager.SignInAsync(user, isPersistent: false);
                    return LocalRedirect(returnUrl);
                case CodeCheck.TooManyAttempts:
                    ModelState.AddModelError(string.Empty, "Shumë tentativa të gabuara. Kërkoni një kod të ri.");
                    break;
                default:
                    ModelState.AddModelError(string.Empty, "Kodi është i pasaktë ose ka skaduar.");
                    break;
            }
            return await ShowAgainAsync(user);
        }

        public async Task<IActionResult> OnPostResendAsync(string? returnUrl = null)
        {
            var user = await _userManager.FindByEmailAsync(Email);
            if (user is { EmailConfirmed: false })
            {
                try
                {
                    if (!await _codes.SendCodeAsync(user, CodePurpose.ConfirmEmail))
                    {
                        TempData["WarningMessage"] = $"Prisni {_codes.SecondsUntilResend(user, CodePurpose.ConfirmEmail)} sekonda para se të kërkoni një kod të ri.";
                        return RedirectToPage(new { email = Email, returnUrl });
                    }
                }
                catch (SmtpException ex)
                {
                    _logger.LogError(ex, "Verification e-mail could not be sent.");
                    TempData["WarningMessage"] = "Email-i nuk u dërgua. Provoni përsëri pas pak.";
                    return RedirectToPage(new { email = Email, returnUrl });
                }
            }
            // Same answer whether or not the account exists
            TempData["StatusMessage"] = "U dërgua një kod i ri.";
            return RedirectToPage(new { email = Email, returnUrl });
        }

        private Task<IActionResult> ShowAgainAsync(IdentityUser? user)
        {
            if (user != null) ResendSeconds = _codes.SecondsUntilResend(user, CodePurpose.ConfirmEmail);
            return Task.FromResult<IActionResult>(Page());
        }
    }
}
