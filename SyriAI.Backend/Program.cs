using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.UI.Services;
using SyriAI.Backend.Business;
using SyriAI.Backend.Controllers;
using SyriAI.Backend.DataAccess;
using SyriAI.Backend.DataAccess.Repositories;

// Three layers in one project (see docs/ARCHITECTURE.md):
//   Controllers/  presentation: API controllers, SignalR hub, Razor pages
//   Business/     rules and validation (services)
//   DataAccess/   EF Core contexts and repositories on MySQL
//   Entities/     tables and request/response shapes, shared by all layers

var builder = WebApplication.CreateBuilder(args);

// ---------- Data access layer: MySQL ----------
// The connection string (with the password) lives in user-secrets, see docs/DATABASE.md
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
var serverVersion = ServerVersion.AutoDetect(connectionString);
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseMySql(connectionString, serverVersion));
builder.Services.AddDbContext<StudioDbContext>(options =>
    options.UseMySql(connectionString, serverVersion, mysql => mysql.MigrationsHistoryTable(StudioDbContext.MigrationsHistoryTable)));
builder.Services.AddDatabaseDeveloperPageExceptionFilter();

builder.Services.AddScoped<IScriptRepository, ScriptRepository>();
builder.Services.AddScoped<ISessionRepository, SessionRepository>();
builder.Services.AddScoped<ISettingsRepository, SettingsRepository>();
builder.Services.AddScoped<IMediaRepository, MediaRepository>();

// ---------- Business layer ----------
builder.Services.AddScoped<ScriptService>();
builder.Services.AddScoped<SessionService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<MediaService>();

builder.Services.AddDefaultIdentity<IdentityUser>(options => {
    // New accounts must verify their e-mail with a 6-digit code before they can sign in
    options.SignIn.RequireConfirmedAccount = true;
    options.SignIn.RequireConfirmedEmail = true;
    options.User.RequireUniqueEmail = true;

    // E-mail codes (6 digits) instead of long links, for verification and password reset
    options.Tokens.EmailConfirmationTokenProvider = TokenOptions.DefaultEmailProvider;
    options.Tokens.PasswordResetTokenProvider = TokenOptions.DefaultEmailProvider;

    options.Password.RequireDigit = false;
    options.Password.RequireLowercase = false;
    options.Password.RequireUppercase = false;
    options.Password.RequireNonAlphanumeric = false;
    options.Password.RequiredLength = 8;

    // 5 wrong passwords lock the account for 5 minutes
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
})
    .AddErrorDescriber<AlbanianIdentityErrorDescriber>()
    .AddEntityFrameworkStores<ApplicationDbContext>();

// E-mail: SMTP settings from configuration (user-secrets), see docs/EMAIL.md
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection(SmtpOptions.Section));
builder.Services.AddSingleton<SmtpEmailSender>();
builder.Services.AddSingleton<IEmailSender>(sp => sp.GetRequiredService<SmtpEmailSender>());
builder.Services.AddMemoryCache();
builder.Services.AddScoped<AccountCodeService>();

builder.Services.ConfigureApplicationCookie(options =>
{
    options.LoginPath = "/Identity/Account/Login";
    options.ExpireTimeSpan = TimeSpan.FromMinutes(20); // Fallback timeout
    options.SlidingExpiration = true;
    // By not setting a MaxAge, the cookie becomes a session cookie by default if not 'persistent'

    // API and hub calls get a 401 instead of an HTML redirect to the login page
    options.Events.OnRedirectToLogin = context =>
    {
        if (IsApiRequest(context.Request.Path))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        }
        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
});

builder.Services.AddRazorPages();

// ---------- Presentation layer: API controllers ----------
builder.Services.AddControllers(options =>
    // Required fields are checked by the business layer, which returns the error text the pages show
    options.SuppressImplicitRequiredAttributeForNonNullableReferenceTypes = true)
    .ConfigureApiBehaviorOptions(options =>
        // Bad JSON keeps the { error } shape of the other API errors
        options.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(new
        {
            error = context.ModelState.Values.SelectMany(v => v.Errors).Select(e => e.ErrorMessage).FirstOrDefault(m => m.Length > 0)
                ?? "Invalid request.",
        }));

// Real-time sync between the admin studio and client screens.
// Media travels as URLs, so messages stay small; the limit covers long rendered scripts.
builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 8 * 1024 * 1024);

builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = MediaService.MaxMediaBytes + 1024 * 1024);

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var userManager = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    var studioDb = scope.ServiceProvider.GetRequiredService<StudioDbContext>();

    // Login and studio tables each have their own migrations (DataAccess/Migrations)
    db.Database.Migrate();
    studioDb.Database.Migrate();

    // One-time copy of the old SQLite data:  dotnet run -- import-sqlite app.db
    if (args is ["import-sqlite", var sqlitePath, ..])
    {
        await SqliteImporter.ImportAsync(sqlitePath, db, studioDb, app.Logger);
        return;
    }

    // Seed the admin user from configuration (user-secrets or environment variables),
    // never from source code:
    //   dotnet user-secrets set "SeedAdmin:Email" "you@example.com"
    //   dotnet user-secrets set "SeedAdmin:Password" "..."
    var seedEmail = app.Configuration["SeedAdmin:Email"];
    var seedPassword = app.Configuration["SeedAdmin:Password"];
    if (!string.IsNullOrWhiteSpace(seedEmail) && !string.IsNullOrWhiteSpace(seedPassword)
        && !db.Users.Any(u => u.Email == seedEmail))
    {
        var user = new IdentityUser { UserName = seedEmail, Email = seedEmail, EmailConfirmed = true };
        userManager.CreateAsync(user, seedPassword).Wait();
    }
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseMigrationsEndPoint();
}
else
{
    app.UseExceptionHandler("/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();

// Protect the /studio folder - prevent access without login
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value?.ToLower();
    if (path != null && (path.Contains("/studio") || path.Contains("adminpage") || path.Contains("client")))
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            context.Response.Redirect("/Identity/Account/Login?ReturnUrl=" + context.Request.Path);
            return;
        }

        // Disable caching for protected pages to force login check on every visit
        context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        context.Response.Headers["Pragma"] = "no-cache";
        context.Response.Headers["Expires"] = "0";
    }
    await next();
});

app.UseStaticFiles();

app.MapRazorPages();
app.MapControllers();
app.MapHub<StudioHub>(StudioHub.Path);

app.MapGet("/logout", async (SignInManager<IdentityUser> signInManager) =>
{
    await signInManager.SignOutAsync();
    return Results.Redirect("/");
});

app.Run();

static bool IsApiRequest(PathString path) =>
    path.StartsWithSegments("/api") || path.StartsWithSegments(StudioHub.Path);
