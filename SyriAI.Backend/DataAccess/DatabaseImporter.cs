using Microsoft.EntityFrameworkCore;

namespace SyriAI.Backend.DataAccess;

/// <summary>
/// Copies accounts and studio data from another database into the configured one:
///   dotnet run -- import-sqlite app.db                       (the old SQLite file)
///   dotnet run -- import-mysql "Server=...;Database=...;"    (e.g. the local MySQL → the cloud)
/// Rows that already exist in the target (same key, or a user with the same e-mail) are skipped,
/// so running it twice does no harm. The source is only read.
/// </summary>
public static class DatabaseImporter
{
    public static Task ImportFromSqliteAsync(string sqlitePath, ApplicationDbContext identity, StudioDbContext studio, ILogger logger)
    {
        if (!File.Exists(sqlitePath)) throw new FileNotFoundException($"SQLite file not found: {sqlitePath}");
        var source = $"Data Source={sqlitePath};Mode=ReadOnly";
        return ImportAsync(
            new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlite(source).Options,
            new DbContextOptionsBuilder<StudioDbContext>().UseSqlite(source).Options,
            sqlitePath, identity, studio, logger);
    }

    public static Task ImportFromMySqlAsync(string connectionString, ApplicationDbContext identity, StudioDbContext studio, ILogger logger)
    {
        var version = ServerVersion.AutoDetect(connectionString);
        return ImportAsync(
            new DbContextOptionsBuilder<ApplicationDbContext>().UseMySql(connectionString, version).Options,
            new DbContextOptionsBuilder<StudioDbContext>().UseMySql(connectionString, version).Options,
            "MySQL source", identity, studio, logger);
    }

    private static async Task ImportAsync(
        DbContextOptions<ApplicationDbContext> identitySource, DbContextOptions<StudioDbContext> studioSource,
        string sourceName, ApplicationDbContext identity, StudioDbContext studio, ILogger logger)
    {
        await using var oldIdentity = new ApplicationDbContext(identitySource);
        await using var oldStudio = new StudioDbContext(studioSource);

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
            "Imported from {Source}: {Users} users, {Roles} roles, {Scripts} scripts, {Sessions} sessions, {Settings} settings, {Media} media files.",
            sourceName, users.Count, roles.Count, scripts.Count, sessions.Count, settings.Count, media.Count);
    }
}
