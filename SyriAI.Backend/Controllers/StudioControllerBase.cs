using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SyriAI.Backend.Business;

namespace SyriAI.Backend.Controllers;

/// <summary>Shared plumbing for the studio API: login required, the user id, and result mapping.</summary>
[ApiController]
[Authorize]
public abstract class StudioControllerBase : ControllerBase
{
    protected string UserId =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("Missing user id.");

    /// <summary>Business errors keep the { error } JSON shape the studio pages read.</summary>
    protected IActionResult FromResult<T>(ServiceResult<T> result, Func<T, IActionResult> onSuccess) => result.Status switch
    {
        ResultStatus.Ok => onSuccess(result.Value!),
        ResultStatus.NotFound => NotFound(),
        _ => BadRequest(new { error = result.Error }),
    };
}
