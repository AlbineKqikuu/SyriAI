using System.ComponentModel.DataAnnotations;
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

        /// <summary>Claim that keeps the user's full name (shown in the menu and the studio)</summary>
        public const string NameClaim = "display_name";

        public class InputModel
        {
            [Required(ErrorMessage = "Shkruani emrin.")]
            [StringLength(100, ErrorMessage = "Emri mund të ketë deri në {1} karaktere.")]
            [Display(Name = "Emri dhe mbiemri")]
            public string Name { get; set; }

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

            IdentityResult result;
            var user = await _userManager.FindByEmailAsync(Input.Email);
            if (user is { EmailConfirmed: false })
            {
                // An earlier sign-up never got verified (e.g. the code e-mail was lost): the account
                // cannot be used yet, so take the new password and send a fresh code. Only the owner
                // of the e-mail can enter that code, so this does not hand the account to anyone else.
                result = await _userManager.ResetPasswordAsync(user, await _userManager.GeneratePasswordResetTokenAsync(user), Input.Password);
            }
            else
            {
                user = new IdentityUser();
                await _userStore.SetUserNameAsync(user, Input.Email, CancellationToken.None);
                await _emailStore.SetEmailAsync(user, Input.Email, CancellationToken.None);
                result = await _userManager.CreateAsync(user, Input.Password);
            }

            if (!result.Succeeded)
            {
                // The user name is the e-mail, so a taken address fails twice with the same text
                foreach (var description in result.Errors.Select(e => e.Description).Distinct())
                {
                    ModelState.AddModelError(string.Empty, description);
                }
                return Page();
            }

            await SaveNameAsync(user, Input.Name.Trim());
            _logger.LogInformation("Account created or renewed; waiting for e-mail verification.");

            // No sign-in yet: the account is usable only after the e-mail code is entered
            try
            {
                await _codes.SendCodeAsync(user, CodePurpose.ConfirmEmail);
                TempData["StatusMessage"] = "Llogaria u krijua. Ju dërguam një kod me 6 shifra në email.";
            }
            catch (EmailSendException ex)
            {
                _logger.LogError(ex, "Verification e-mail could not be sent.");
                TempData["WarningMessage"] = "Llogaria u krijua, por email-i nuk u dërgua. Provoni “Dërgo kodin përsëri”.";
            }
            return RedirectToPage("./VerifyEmail", new { email = Input.Email, returnUrl });
        }

        /// <summary>Store (or replace) the full name as a user claim; it ends up in the login cookie</summary>
        private async Task SaveNameAsync(IdentityUser user, string name)
        {
            var claims = await _userManager.GetClaimsAsync(user);
            var old = claims.Where(c => c.Type == NameClaim).ToList();
            if (old.Count > 0) await _userManager.RemoveClaimsAsync(user, old);
            await _userManager.AddClaimAsync(user, new System.Security.Claims.Claim(NameClaim, name));
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
