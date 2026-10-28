using Microsoft.EntityFrameworkCore;

namespace SyriAI.Backend.DataAccess;

/// <summary>
/// One-time copy of the old SQLite database (app.db) into MySQL:
///   dotnet run -- import-sqlite app.db
/// Rows that already exist in MySQL (same key, or a user with the same e-mail) are skipped,
/// so running it twice does no harm. app.db itself is only read.
/// </summary>
public static class SqliteImporter
{
    public static async Task ImportAsync(string sqlitePath, ApplicationDbContext identity, StudioDbContext studio, ILogger logger)
    {
        if (!File.Exists(sqlitePath)) throw new FileNotFoundException($"SQLite file not found: {sqlitePath}");
        var source = $"Data Source={sqlitePath};Mode=ReadOnly";
        await using var oldIdentity = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlite(source).Options);
        await using var oldStudio = new StudioDbContext(new DbContextOptionsBuilder<StudioDbContext>().UseSqlite(source).Options);

        // ---------- Accounts ----------
        var knownEmails = (await identity.Users.Select(u => u.NormalizedEmail).ToListAsync()).ToHashSet();
        var knownUserIds = (await identity.Users.Select(u => u.Id).ToListAsync()).ToHashSet();
        var users = (await oldIdentity.Users.AsNoTracking().ToListAsync())
            .Where(u => !knownUserIds.Contains(u.Id) && !knownEmails.Contains(u.NormalizedEmail)).ToList();
        var userIds = users.Select(u => u.Id).ToHashSet();
        identity.Users.AddRange(users);

        var knownRoles = (await identity.Roles.Select(r => r.Id).ToListAsync()).ToHashSet();
        var roles = (await oldIdentity.Roles.AsNoTracking().ToListAsync()).Where(r => !knownRoles.Contains(r.Id)).ToList();
        identity.Roles.AddRange(roles);
        var roleIds = roles.Select(r => r.Id).ToHashSet();
        identity.RoleClaims.AddRange((await oldIdentity.RoleClaims.AsNoTracking().ToListAsync()).Where(c => roleIds.Contains(c.RoleId)));

        // Claims, logins, roles and tokens only for the accounts copied now
        identity.UserClaims.AddRange((await oldIdentity.UserClaims.AsNoTracking().ToListAsync()).Where(c => userIds.Contains(c.UserId)));
        identity.UserLogins.AddRange((await oldIdentity.UserLogins.AsNoTracking().ToListAsync()).Where(l => userIds.Contains(l.UserId)));
        identity.UserRoles.AddRange((await oldIdentity.UserRoles.AsNoTracking().ToListAsync()).Where(r => userIds.Contains(r.UserId)));
        identity.UserTokens.AddRange((await oldIdentity.UserTokens.AsNoTracking().ToListAsync()).Where(t => userIds.Contains(t.UserId)));
        await identity.SaveChangesAsync();

        // ---------- Studio data ----------
        var scriptIds = (await studio.Scripts.Select(s => s.Id).ToListAsync()).ToHashSet();
        var scripts = (await oldStudio.Scripts.AsNoTracking().ToListAsync()).Where(s => !scriptIds.Contains(s.Id)).ToList();
        studio.Scripts.AddRange(scripts);

        var sessionIds = (await studio.Sessions.Select(s => s.Id).ToListAsync()).ToHashSet();
        var sessions = (await oldStudio.Sessions.AsNoTracking().ToListAsync()).Where(s => !sessionIds.Contains(s.Id)).ToList();
        studio.Sessions.AddRange(sessions);

        var settingsIds = (await studio.Settings.Select(s => s.UserId).ToListAsync()).ToHashSet();
        var settings = (await oldStudio.Settings.AsNoTracking().ToListAsync()).Where(s => !settingsIds.Contains(s.UserId)).ToList();
        studio.Settings.AddRange(settings);

        var mediaIds = (await studio.Media.Select(m => m.Id).ToListAsync()).ToHashSet();
        var media = (await oldStudio.Media.AsNoTracking().ToListAsync()).Where(m => !mediaIds.Contains(m.Id)).ToList();
        studio.Media.AddRange(media);
        await studio.SaveChangesAsync();

        logger.LogInformation(
            "Imported from {Path}: {Users} users, {Roles} roles, {Scripts} scripts, {Sessions} sessions, {Settings} settings, {Media} media files.",
            sqlitePath, users.Count, roles.Count, scripts.Count, sessions.Count, settings.Count, media.Count);
    }
}
