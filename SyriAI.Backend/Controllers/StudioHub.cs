using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace SyriAI.Backend.Controllers;

/// <summary>
/// Real-time relay between the admin studio and its client screens.
/// Every signed-in user gets a private group, so the admin page and any number of
/// client screens (same computer or another device on the network) stay in sync
/// without seeing other users' studios.
/// </summary>
[Authorize]
public class StudioHub : Hub
{
    public const string Path = "/hubs/studio";

    private string GroupName => "studio:" + (Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous");

    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName);
        await base.OnConnectedAsync();
    }

    /// <summary>Forward a studio message (same shape as the old BroadcastChannel messages) to the user's other screens.</summary>
    public Task Send(string type, JsonElement data)
    {
        return Clients.OthersInGroup(GroupName).SendAsync("message", type, data);
    }
}
