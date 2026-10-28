using System.ComponentModel.DataAnnotations;
using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using SyriAI.Backend.Business;

namespace SyriAI.Backend.Areas.Identity.Pages.Account
{
    public class ForgotPasswordModel : PageModel
    {
        private readonly UserManager<IdentityUser> _userManager;
        private readonly AccountCodeService _codes;
        private readonly ILogger<ForgotPasswordModel> _logger;

        public ForgotPasswordModel(UserManager<IdentityUser> userManager, AccountCodeService codes, ILogger<ForgotPasswordModel> logger)
        {
            _userManager = userManager;
            _codes = codes;
            _logger = logger;
        }

        [BindProperty]
        [Required(ErrorMessage = "Shkruani email-in.")]
        [EmailAddress(ErrorMessage = "Adresa e email-it nuk është e vlefshme.")]
        public string Email { get; set; } = "";

        public void OnGet() { }

        public async Task<IActionResult> OnPostAsync()
        {
            if (!ModelState.IsValid) return Page();

            var user = await _userManager.FindByEmailAsync(Email);
            if (user != null)
            {
                try
                {
                    await _codes.SendCodeAsync(user, CodePurpose.ResetPassword); // skipped within the 60 s cooldown
                }
                catch (SmtpException ex)
                {
                    _logger.LogError(ex, "Password reset e-mail could not be sent.");
                    TempData["WarningMessage"] = "Email-i nuk u dërgua. Provoni përsëri pas pak.";
                    return Page();
                }
            }

            // Same answer whether or not the account exists, so e-mail addresses cannot be probed
            TempData["StatusMessage"] = "Nëse ekziston një llogari me këtë email, ju dërguam një kod me 6 shifra.";
            return RedirectToPage("./ResetPassword", new { email = Email });
        }
    }
}
