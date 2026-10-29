using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.DataAccess;

/// <summary>
/// Studio data (scripts, sessions, settings, media). Lives in the same MySQL database as
/// Identity but has its own migrations history, so it can evolve independently of the
/// login tables in <see cref="ApplicationDbContext"/>.
/// It also keeps the ASP.NET Core data-protection keys, so login cookies and form tokens stay
/// valid after a redeploy (the cloud container has no persistent disk).
/// </summary>
public class StudioDbContext : DbContext, IDataProtectionKeyContext
{
    public const string MigrationsHistoryTable = "__StudioMigrationsHistory";

    public StudioDbContext(DbContextOptions<StudioDbContext> options) : base(options)
    {
    }

    public DbSet<Script> Scripts => Set<Script>();
    public DbSet<StudioSession> Sessions => Set<StudioSession>();
    public DbSet<UserSettings> Settings => Set<UserSettings>();
    public DbSet<MediaAsset> Media => Set<MediaAsset>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // No special collation on GUID columns: TiDB (the cloud database) does not support
        // ascii_general_ci, and plain MySQL works the same without it
        modelBuilder.UseGuidCollation(string.Empty);
        modelBuilder.Entity<Script>().HasIndex(s => new { s.UserId, s.UpdatedAt });
        modelBuilder.Entity<StudioSession>().HasIndex(s => new { s.UserId, s.StartedAt });
        modelBuilder.Entity<MediaAsset>().HasIndex(m => m.UserId);
    }
}
