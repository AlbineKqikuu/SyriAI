using System.ComponentModel.DataAnnotations;
using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using SyriAI.Backend.Business;

namespace SyriAI.Backend.Areas.Identity.Pages.Account
{
    public class RegisterModel : PageModel
    {
        private readonly UserManager<IdentityUser> _userManager;
        private readonly IUserStore<IdentityUser> _userStore;
        private readonly IUserEmailStore<IdentityUser> _emailStore;
        private readonly AccountCodeService _codes;
        private readonly ILogger<RegisterModel> _logger;

        public RegisterModel(
            UserManager<IdentityUser> userManager,
            IUserStore<IdentityUser> userStore,
            AccountCodeService codes,
            ILogger<RegisterModel> logger)
        {
            _userManager = userManager;
            _userStore = userStore;
            _emailStore = GetEmailStore();
            _codes = codes;
            _logger = logger;
        }

        [BindProperty]
        public InputModel Input { get; set; }

        public string ReturnUrl { get; set; }

        public class InputModel
        {
            [Required(ErrorMessage = "Shkruani email-in.")]
            [EmailAddress(ErrorMessage = "Adresa e email-it nuk është e vlefshme.")]
            [Display(Name = "Email")]
            public string Email { get; set; }

            [Required(ErrorMessage = "Shkruani fjalëkalimin.")]
            [StringLength(100, ErrorMessage = "Fjalëkalimi duhet të ketë {2} deri në {1} karaktere.", MinimumLength = 8)]
            [DataType(DataType.Password)]
            [Display(Name = "Fjalëkalimi")]
            public string Password { get; set; }

            [DataType(DataType.Password)]
            [Display(Name = "Konfirmo fjalëkalimin")]
            [Compare("Password", ErrorMessage = "Fjalëkalimet nuk përputhen.")]
            public string ConfirmPassword { get; set; }
        }

        public void OnGet(string returnUrl = null)
        {
            ReturnUrl = returnUrl;
        }

        public async Task<IActionResult> OnPostAsync(string returnUrl = null)
        {
            returnUrl ??= Url.Content("~/");
            if (!ModelState.IsValid) return Page();

            var user = new IdentityUser();
            await _userStore.SetUserNameAsync(user, Input.Email, CancellationToken.None);
            await _emailStore.SetEmailAsync(user, Input.Email, CancellationToken.None);
            var result = await _userManager.CreateAsync(user, Input.Password);

            if (!result.Succeeded)
            {
                foreach (var error in result.Errors)
                {
                    ModelState.AddModelError(string.Empty, error.Description);
                }
                return Page();
            }

            _logger.LogInformation("New account created; waiting for e-mail verification.");

            // No sign-in yet: the account is usable only after the e-mail code is entered
            try
            {
                await _codes.SendCodeAsync(user, CodePurpose.ConfirmEmail);
                TempData["StatusMessage"] = "Llogaria u krijua. Ju dërguam një kod me 6 shifra në email.";
            }
            catch (SmtpException ex)
            {
                _logger.LogError(ex, "Verification e-mail could not be sent.");
                TempData["WarningMessage"] = "Llogaria u krijua, por email-i nuk u dërgua. Provoni “Dërgo kodin përsëri”.";
            }
            return RedirectToPage("./VerifyEmail", new { email = Input.Email, returnUrl });
        }

        private IUserEmailStore<IdentityUser> GetEmailStore()
        {
            if (!_userManager.SupportsUserEmail)
            {
                throw new NotSupportedException("The default UI requires a user store with email support.");
            }
            return (IUserEmailStore<IdentityUser>)_userStore;
        }
    }
}
