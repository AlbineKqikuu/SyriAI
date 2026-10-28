using System.Text.Json;
using SyriAI.Backend.DataAccess.Repositories;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.Business;

/// <summary>Per-user studio preferences, stored as one JSON document.</summary>
public class SettingsService(ISettingsRepository settings)
{
    private const int MaxSettingsChars = 64 * 1024;

    public async Task<string> GetJsonAsync(string userId) => (await settings.GetAsync(userId))?.Json ?? "{}";

    public async Task<ServiceResult<bool>> SaveAsync(JsonElement body, string userId)
    {
        if (body.ValueKind != JsonValueKind.Object) return ServiceResult<bool>.Invalid("Settings must be a JSON object.");
        var json = body.GetRawText();
        if (json.Length > MaxSettingsChars) return ServiceResult<bool>.Invalid("Settings are too large.");

        var row = await settings.GetAsync(userId);
        if (row is null)
        {
            row = new UserSettings { UserId = userId };
            await settings.AddAsync(row);
        }
        row.Json = json;
        row.UpdatedAt = DateTime.UtcNow;
        await settings.SaveChangesAsync();
        return ServiceResult<bool>.Success(true);
    }
}
