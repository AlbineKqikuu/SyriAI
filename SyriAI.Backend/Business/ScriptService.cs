using SyriAI.Backend.DataAccess.Repositories;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.Business;

/// <summary>Script library: validation and ownership rules for saved teleprompter scripts.</summary>
public class ScriptService(IScriptRepository scripts)
{
    public const int MaxTitleLength = 200;
    public const int MaxContentLength = 2_000_000;

    public Task<List<ScriptSummary>> ListAsync(string userId) => scripts.ListAsync(userId);

    public async Task<ServiceResult<Script>> GetAsync(int id, string userId) =>
        await scripts.GetAsync(id, userId) is { } script
            ? ServiceResult<Script>.Success(script)
            : ServiceResult<Script>.NotFound();

    public async Task<ServiceResult<Script>> CreateAsync(ScriptInput input, string userId)
    {
        if (Validate(input) is { } error) return ServiceResult<Script>.Invalid(error);
        var now = DateTime.UtcNow;
        var script = new Script { UserId = userId, Title = input.Title.Trim(), Content = input.Content, CreatedAt = now, UpdatedAt = now };
        await scripts.AddAsync(script);
        return ServiceResult<Script>.Success(script);
    }

    public async Task<ServiceResult<Script>> UpdateAsync(int id, ScriptInput input, string userId)
    {
        if (Validate(input) is { } error) return ServiceResult<Script>.Invalid(error);
        var script = await scripts.GetAsync(id, userId);
        if (script is null) return ServiceResult<Script>.NotFound();
        script.Title = input.Title.Trim();
        script.Content = input.Content;
        script.UpdatedAt = DateTime.UtcNow;
        await scripts.SaveChangesAsync();
        return ServiceResult<Script>.Success(script);
    }

    public Task<bool> DeleteAsync(int id, string userId) => scripts.DeleteAsync(id, userId);

    private static string? Validate(ScriptInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return "Title is required.";
        if (input.Title.Length > MaxTitleLength) return "Title is too long.";
        if (input.Content is null || input.Content.Length > MaxContentLength) return "Content is missing or too large.";
        return null;
    }
}
