using System.ComponentModel.DataAnnotations;
using System.Net.Mail;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using SyriAI.Backend.Business;

namespace SyriAI.Backend.Areas.Identity.Pages.Account
{
    public class LoginModel : PageModel
    {
        private readonly SignInManager<IdentityUser> _signInManager;
        private readonly UserManager<IdentityUser> _userManager;
        private readonly AccountCodeService _codes;
        private readonly ILogger<LoginModel> _logger;

        public LoginModel(SignInManager<IdentityUser> signInManager, UserManager<IdentityUser> userManager,
            AccountCodeService codes, ILogger<LoginModel> logger)
        {
            _signInManager = signInManager;
            _userManager = userManager;
            _codes = codes;
            _logger = logger;
        }

        [BindProperty]
        public InputModel Input { get; set; }

        public string ReturnUrl { get; set; }

        [TempData]
        public string ErrorMessage { get; set; }

        public class InputModel
        {
            [Required(ErrorMessage = "Shkruani email-in.")]
            [EmailAddress(ErrorMessage = "Adresa e email-it nuk është e vlefshme.")]
            public string Email { get; set; }

            [Required(ErrorMessage = "Shkruani fjalëkalimin.")]
            [DataType(DataType.Password)]
            public string Password { get; set; }

            [Display(Name = "Më mbaj të kyçur")]
            public bool RememberMe { get; set; }
        }

        public async Task OnGetAsync(string returnUrl = null)
        {
            if (!string.IsNullOrEmpty(ErrorMessage))
            {
                ModelState.AddModelError(string.Empty, ErrorMessage);
            }

            // Clear the existing external cookie to ensure a clean login process
            await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);

            ReturnUrl = returnUrl ?? Url.Content("~/");
        }

        public async Task<IActionResult> OnPostAsync(string returnUrl = null)
        {
            returnUrl ??= Url.Content("~/");
            ReturnUrl = returnUrl;
            if (!ModelState.IsValid) return Page();

            // Wrong passwords count towards the lockout (5 attempts → 5 minutes)
            var result = await _signInManager.PasswordSignInAsync(Input.Email, Input.Password, Input.RememberMe, lockoutOnFailure: true);
            if (result.Succeeded)
            {
                _logger.LogInformation("User logged in.");
                return LocalRedirect(returnUrl);
            }
            if (result.IsLockedOut)
            {
                _logger.LogWarning("User account locked out.");
                ModelState.AddModelError(string.Empty, "Shumë tentativa të gabuara. Llogaria u bllokua përkohësisht — provoni përsëri pas 5 minutash.");
                return Page();
            }
            if (result.IsNotAllowed)
            {
                // E-mail not verified yet. Identity rejects before checking the password, so check it
                // here (counting failures) before sending a code: otherwise anyone could trigger e-mails.
                var redirect = await HandleUnverifiedAsync(returnUrl);
                if (redirect != null) return redirect;
            }

            ModelState.AddModelError(string.Empty, "Email-i ose fjalëkalimi është i pasaktë.");
            return Page();
        }

        private async Task<IActionResult> HandleUnverifiedAsync(string returnUrl)
        {
            var user = await _userManager.FindByEmailAsync(Input.Email);
            if (user == null || user.EmailConfirmed) return null;

            if (await _userManager.IsLockedOutAsync(user))
            {
                ModelState.AddModelError(string.Empty, "Shumë tentativa të gabuara. Llogaria u bllokua përkohësisht — provoni përsëri pas 5 minutash.");
                return Page();
            }
            if (!await _userManager.CheckPasswordAsync(user, Input.Password))
            {
                await _userManager.AccessFailedAsync(user);
                return null;
            }
            await _userManager.ResetAccessFailedCountAsync(user);

            try
            {
                await _codes.SendCodeAsync(user, CodePurpose.ConfirmEmail); // skipped silently within the 60 s cooldown
                TempData["StatusMessage"] = "Llogaria juaj nuk është verifikuar ende. Ju dërguam një kod në email.";
            }
            catch (SmtpException ex)
            {
                _logger.LogError(ex, "Verification e-mail could not be sent.");
                TempData["WarningMessage"] = "Llogaria nuk është verifikuar dhe email-i nuk u dërgua. Provoni “Dërgo kodin përsëri”.";
            }
            return RedirectToPage("./VerifyEmail", new { email = user.Email, returnUrl });
        }
    }
}
