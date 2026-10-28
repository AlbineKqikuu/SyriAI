using Microsoft.EntityFrameworkCore;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.DataAccess;

/// <summary>
/// Studio data (scripts, sessions, settings, media). Lives in the same MySQL database as
/// Identity but has its own migrations history, so it can evolve independently of the
/// login tables in <see cref="ApplicationDbContext"/>.
/// </summary>
public class StudioDbContext : DbContext
{
    public const string MigrationsHistoryTable = "__StudioMigrationsHistory";

    public StudioDbContext(DbContextOptions<StudioDbContext> options) : base(options)
    {
    }

    public DbSet<Script> Scripts => Set<Script>();
    public DbSet<StudioSession> Sessions => Set<StudioSession>();
    public DbSet<UserSettings> Settings => Set<UserSettings>();
    public DbSet<MediaAsset> Media => Set<MediaAsset>();

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
