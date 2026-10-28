using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using SyriAI.Backend.Business;

namespace SyriAI.Backend.Areas.Identity.Pages.Account
{
    public class ResetPasswordModel : PageModel
    {
        private readonly UserManager<IdentityUser> _userManager;
        private readonly AccountCodeService _codes;
        private readonly ILogger<ResetPasswordModel> _logger;

        public ResetPasswordModel(UserManager<IdentityUser> userManager, AccountCodeService codes, ILogger<ResetPasswordModel> logger)
        {
            _userManager = userManager;
            _codes = codes;
            _logger = logger;
        }

        [BindProperty]
        public InputModel Input { get; set; } = new();

        public bool CanSendEmail => _codes.CanSendEmail;
        public int ValidMinutes => AccountCodeService.ValidMinutes;

        public class InputModel
        {
            [Required]
            [EmailAddress]
            public string Email { get; set; } = "";

            [Required(ErrorMessage = "Shkruani kodin nga email-i.")]
            public string Code { get; set; } = "";

            [Required(ErrorMessage = "Shkruani fjalëkalimin e ri.")]
            [StringLength(100, ErrorMessage = "Fjalëkalimi duhet të ketë {2} deri në {1} karaktere.", MinimumLength = 8)]
            [DataType(DataType.Password)]
            public string Password { get; set; } = "";

            [DataType(DataType.Password)]
            [Compare("Password", ErrorMessage = "Fjalëkalimet nuk përputhen.")]
            public string ConfirmPassword { get; set; } = "";
        }

        public IActionResult OnGet(string? email = null)
        {
            if (string.IsNullOrWhiteSpace(email)) return RedirectToPage("./ForgotPassword");
            Input.Email = email;
            return Page();
        }

        public async Task<IActionResult> OnPostAsync()
        {
            if (!ModelState.IsValid) return Page();

            var user = await _userManager.FindByEmailAsync(Input.Email);
            if (user == null)
            {
                // Do not reveal that the account does not exist
                ModelState.AddModelError(string.Empty, "Kodi është i pasaktë ose ka skaduar.");
                return Page();
            }

            var (check, identity) = await _codes.UseCodeAsync(user, CodePurpose.ResetPassword, Input.Code, Input.Password);
            switch (check)
            {
                case CodeCheck.Ok:
                    // The code arrived by e-mail, so the address is proven as well
                    if (!user.EmailConfirmed)
                    {
                        user.EmailConfirmed = true;
                        await _userManager.UpdateAsync(user);
                    }
                    await _userManager.SetLockoutEndDateAsync(user, null);
                    await _userManager.ResetAccessFailedCountAsync(user);
                    _logger.LogInformation("Password reset for a user account.");
                    TempData["StatusMessage"] = "Fjalëkalimi u ndryshua. Tani mund të kyçeni.";
                    return RedirectToPage("./Login");
                case CodeCheck.TooManyAttempts:
                    ModelState.AddModelError(string.Empty, "Shumë tentativa të gabuara. Kërkoni një kod të ri.");
                    break;
                case CodeCheck.Invalid:
                    ModelState.AddModelError(string.Empty, "Kodi është i pasaktë ose ka skaduar.");
                    break;
                default:
                    foreach (var error in identity!.Errors) ModelState.AddModelError(string.Empty, error.Description);
                    break;
            }
            return Page();
        }
    }
}
