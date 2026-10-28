using Microsoft.AspNetCore.Identity;

namespace SyriAI.Backend.Business;

/// <summary>Identity validation messages in Albanian (the studio UI language).</summary>
public class AlbanianIdentityErrorDescriber : IdentityErrorDescriber
{
    private static IdentityError Error(string code, string description) => new() { Code = code, Description = description };

    public override IdentityError DefaultError() => Error(nameof(DefaultError), "Ndodhi një gabim. Provoni përsëri.");
    public override IdentityError InvalidToken() => Error(nameof(InvalidToken), "Kodi është i pasaktë ose ka skaduar.");
    public override IdentityError PasswordMismatch() => Error(nameof(PasswordMismatch), "Fjalëkalimi është i pasaktë.");
    public override IdentityError InvalidEmail(string? email) => Error(nameof(InvalidEmail), $"Adresa e email-it '{email}' nuk është e vlefshme.");
    public override IdentityError InvalidUserName(string? userName) => Error(nameof(InvalidUserName), $"Emri i përdoruesit '{userName}' nuk është i vlefshëm.");
    public override IdentityError DuplicateEmail(string email) => Error(nameof(DuplicateEmail), $"Ekziston tashmë një llogari me email-in '{email}'.");
    public override IdentityError DuplicateUserName(string userName) => Error(nameof(DuplicateUserName), $"Ekziston tashmë një llogari me email-in '{userName}'.");
    public override IdentityError PasswordTooShort(int length) => Error(nameof(PasswordTooShort), $"Fjalëkalimi duhet të ketë të paktën {length} karaktere.");
    public override IdentityError PasswordRequiresDigit() => Error(nameof(PasswordRequiresDigit), "Fjalëkalimi duhet të përmbajë të paktën një shifër (0–9).");
    public override IdentityError PasswordRequiresLower() => Error(nameof(PasswordRequiresLower), "Fjalëkalimi duhet të përmbajë të paktën një shkronjë të vogël.");
    public override IdentityError PasswordRequiresUpper() => Error(nameof(PasswordRequiresUpper), "Fjalëkalimi duhet të përmbajë të paktën një shkronjë të madhe.");
    public override IdentityError PasswordRequiresNonAlphanumeric() => Error(nameof(PasswordRequiresNonAlphanumeric), "Fjalëkalimi duhet të përmbajë të paktën një simbol (p.sh. ! ? #).");
    public override IdentityError PasswordRequiresUniqueChars(int uniqueChars) => Error(nameof(PasswordRequiresUniqueChars), $"Fjalëkalimi duhet të ketë të paktën {uniqueChars} karaktere të ndryshme.");
    public override IdentityError UserLockoutNotEnabled() => Error(nameof(UserLockoutNotEnabled), "Bllokimi i llogarisë nuk është i aktivizuar.");
    public override IdentityError ConcurrencyFailure() => Error(nameof(ConcurrencyFailure), "Të dhënat u ndryshuan ndërkohë. Provoni përsëri.");
}
