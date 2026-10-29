using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using SyriAI.Backend.Business;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.Controllers;

// Presentation layer of the studio API (/api/...). Controllers only translate HTTP to
// business calls and back; every endpoint works on the signed-in user's own data.

[Route("api/scripts")]
public class ScriptsController(ScriptService scripts) : StudioControllerBase
{
    [HttpGet]
    public async Task<List<ScriptSummary>> List() => await scripts.ListAsync(UserId);

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id) => FromResult(await scripts.GetAsync(id, UserId), Ok);

    [HttpPost]
    public async Task<IActionResult> Create(ScriptInput input) =>
        FromResult(await scripts.CreateAsync(input, UserId), script => Created($"/api/scripts/{script.Id}", script));

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, ScriptInput input) => FromResult(await scripts.UpdateAsync(id, input, UserId), Ok);

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id) => await scripts.DeleteAsync(id, UserId) ? NoContent() : NotFound();
}

[Route("api/sessions")]
public class SessionsController(SessionService sessions) : StudioControllerBase
{
    [HttpGet]
    public async Task<List<SessionSummary>> List() => await sessions.ListAsync(UserId);

    [HttpPost]
    public async Task<IActionResult> Create(SessionInput input)
    {
        var id = await sessions.CreateAsync(input, UserId);
        return Created($"/api/sessions/{id}", new { id });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id) => FromResult(await sessions.GetAsync(id, UserId), Ok);

    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Patch(int id, SessionPatch patch) => FromResult(await sessions.PatchAsync(id, patch, UserId), Ok);

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id) => await sessions.DeleteAsync(id, UserId) ? NoContent() : NotFound();

    [HttpGet("export.csv")]
    public async Task<IActionResult> ExportCsv() =>
        File(await sessions.ExportCsvAsync(UserId), "text/csv; charset=utf-8", $"syriai-sessions-{DateTime.UtcNow:yyyyMMdd-HHmm}.csv");
}

[Route("api/settings")]
public class SettingsController(SettingsService settings) : StudioControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get() => Content(await settings.GetJsonAsync(UserId), "application/json");

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] JsonElement body) => FromResult(await settings.SaveAsync(body, UserId), _ => NoContent());
}

[Route("api/media")]
public class MediaController(MediaService media) : StudioControllerBase
{
    [HttpPost]
    [RequestSizeLimit(MediaService.MaxMediaBytes + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MediaService.MaxMediaBytes + 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file) => FromResult(await media.UploadAsync(file, UserId), Ok);

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id) =>
        await media.FindFileAsync(id, UserId) is { } asset
            ? PhysicalFile(asset.StoragePath, asset.ContentType, enableRangeProcessing: true) // range = video seeking
            : NotFound();
}
