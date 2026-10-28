using Microsoft.EntityFrameworkCore;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.DataAccess.Repositories;

// Data access for the studio tables. Repositories only read and write rows; rules and
// validation live in the business layer. Every query is scoped to one user.

public interface IScriptRepository
{
    Task<List<ScriptSummary>> ListAsync(string userId);
    Task<Script?> GetAsync(int id, string userId);
    Task AddAsync(Script script);
    Task SaveChangesAsync();
    Task<bool> DeleteAsync(int id, string userId);
}

public interface ISessionRepository
{
    Task<List<SessionSummary>> ListAsync(string userId, int max);
    Task<List<StudioSession>> ListAllAsync(string userId);
    Task<StudioSession?> GetAsync(int id, string userId);
    Task AddAsync(StudioSession session);
    Task SaveChangesAsync();
    Task<bool> DeleteAsync(int id, string userId);
}

public interface ISettingsRepository
{
    Task<UserSettings?> GetAsync(string userId);
    Task AddAsync(UserSettings settings);
    Task SaveChangesAsync();
}

public interface IMediaRepository
{
    Task<MediaAsset?> GetAsync(Guid id, string userId);
    Task AddAsync(MediaAsset asset);
}

public class ScriptRepository(StudioDbContext db) : IScriptRepository
{
    public Task<List<ScriptSummary>> ListAsync(string userId) =>
        db.Scripts.Where(s => s.UserId == userId)
            .OrderByDescending(s => s.UpdatedAt)
            .Select(s => new ScriptSummary(s.Id, s.Title, s.UpdatedAt, s.Content.Length))
            .ToListAsync();

    public Task<Script?> GetAsync(int id, string userId) =>
        db.Scripts.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId);

    public async Task AddAsync(Script script)
    {
        db.Scripts.Add(script);
        await db.SaveChangesAsync();
    }

    public Task SaveChangesAsync() => db.SaveChangesAsync();

    public async Task<bool> DeleteAsync(int id, string userId) =>
        await db.Scripts.Where(s => s.Id == id && s.UserId == userId).ExecuteDeleteAsync() > 0;
}

public class SessionRepository(StudioDbContext db) : ISessionRepository
{
    public Task<List<SessionSummary>> ListAsync(string userId, int max) =>
        db.Sessions.Where(s => s.UserId == userId)
            .OrderByDescending(s => s.StartedAt)
            .Select(s => new SessionSummary(
                s.Id, s.Participant, s.Condition, s.ScriptTitle, s.StartedAt, s.DurationSeconds,
                s.TotalWords, s.WordsReached, s.ProgressPercent, s.AverageWpm, s.MatchRatePercent,
                s.StallCount, s.MedianProcessingMs, s.EyeContactPercent,
                s.ObserverLostCount, s.SusScore))
            .Take(max)
            .ToListAsync();

    public Task<List<StudioSession>> ListAllAsync(string userId) =>
        db.Sessions.Where(s => s.UserId == userId).OrderBy(s => s.StartedAt).ToListAsync();

    public Task<StudioSession?> GetAsync(int id, string userId) =>
        db.Sessions.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId);

    public async Task AddAsync(StudioSession session)
    {
        db.Sessions.Add(session);
        await db.SaveChangesAsync();
    }

    public Task SaveChangesAsync() => db.SaveChangesAsync();

    public async Task<bool> DeleteAsync(int id, string userId) =>
        await db.Sessions.Where(s => s.Id == id && s.UserId == userId).ExecuteDeleteAsync() > 0;
}

public class SettingsRepository(StudioDbContext db) : ISettingsRepository
{
    public async Task<UserSettings?> GetAsync(string userId) => await db.Settings.FindAsync(userId);

    public Task AddAsync(UserSettings settings)
    {
        db.Settings.Add(settings);
        return Task.CompletedTask; // saved together with the values by SaveChangesAsync
    }

    public Task SaveChangesAsync() => db.SaveChangesAsync();
}

public class MediaRepository(StudioDbContext db) : IMediaRepository
{
    public Task<MediaAsset?> GetAsync(Guid id, string userId) =>
        db.Media.FirstOrDefaultAsync(m => m.Id == id && m.UserId == userId);

    public async Task AddAsync(MediaAsset asset)
    {
        db.Media.Add(asset);
        await db.SaveChangesAsync();
    }
}
