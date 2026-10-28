# E-mail: verification codes and password reset

SyriAI sends two kinds of e-mail, both with a 6-digit code:

| When | Page | Code is used for |
|---|---|---|
| After registering, or when logging in with an unverified account | `/Identity/Account/VerifyEmail` | activating the account |
| "Keni harruar fjalëkalimin?" on the login page | `/Identity/Account/ForgotPassword` → `ResetPassword` | setting a new password |

Security rules:

- A code is valid for about 5 minutes.
- A code stops working once it has been used, or when the password changes.
- 5 wrong codes → a new code must be requested.
- A new code can be requested once per 60 seconds.
- 5 wrong passwords lock the account for 5 minutes.
- The pages never reveal whether an e-mail address has an account.

## Without SMTP (local development)

Nothing needs configuring. The e-mail is not sent. Instead the code is written to the terminal where
`dotnet run` is running, and the page shows a note about this:

```
warn: SyriAI.Backend.Services.AccountCodeService[0]
      SMTP nuk është konfiguruar — email-i nuk u dërgua. Kodi (ConfirmEmail) për ju@shembull.com: 123456
```

## With Gmail (real e-mails)

1. Turn on 2-Step Verification for the Gmail account, then create an **App password**:
   Google Account → Security → *App passwords*. You get a 16-letter password.
2. Store the settings as user-secrets. They stay on your computer and never go into git:

   ```bash
   cd SyriAI.Backend
   dotnet user-secrets set "Smtp:Host" "smtp.gmail.com"
   dotnet user-secrets set "Smtp:Port" "587"
   dotnet user-secrets set "Smtp:User" "youraddress@gmail.com"
   dotnet user-secrets set "Smtp:Password" "abcd efgh ijkl mnop"
   dotnet user-secrets set "Smtp:FromEmail" "youraddress@gmail.com"
   ```

3. Restart the server. Codes now arrive by e-mail (check the spam folder the first time).

Other providers work the same way. Outlook uses `smtp.office365.com`, port 587. For testing without
real mailboxes, Mailtrap's sandbox SMTP captures every e-mail.

On a production server, set the same values as environment variables, e.g. `Smtp__Host`,
`Smtp__Password`.

## Existing accounts

Accounts created before verification was introduced, and never confirmed, are asked for a code at
their next login. The code is sent to their address, or printed in the terminal without SMTP.
