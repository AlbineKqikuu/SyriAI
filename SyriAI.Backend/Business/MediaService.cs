using SyriAI.Backend.DataAccess.Repositories;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.Business;

/// <summary>
/// Documents and media shared with the client screens. Files are stored on disk under
/// App_Data/media/{user}; the database keeps the index (owner, name, type, path).
/// </summary>
public class MediaService(IMediaRepository media, IWebHostEnvironment env)
{
    public const long MaxMediaBytes = 250L * 1024 * 1024;

    private static readonly Dictionary<string, string> AllowedMedia = new(StringComparer.OrdinalIgnoreCase)
    {
        [".pdf"] = "application/pdf",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".mp4"] = "video/mp4",
        [".webm"] = "video/webm",
        [".mov"] = "video/quicktime",
        [".mp3"] = "audio/mpeg",
        [".wav"] = "audio/wav",
        [".ogg"] = "audio/ogg",
    };

    public string MediaRoot => Path.Combine(env.ContentRootPath, "App_Data", "media");

    public async Task<ServiceResult<MediaUploadResult>> UploadAsync(IFormFile file, string userId)
    {
        var ext = Path.GetExtension(file.FileName);
        if (!AllowedMedia.TryGetValue(ext, out var contentType))
            return ServiceResult<MediaUploadResult>.Invalid($"Unsupported file type '{ext}'.");
        if (file.Length is 0 or > MaxMediaBytes)
            return ServiceResult<MediaUploadResult>.Invalid("File is empty or larger than 250 MB.");

        var id = Guid.NewGuid();
        var userDir = Path.Combine(MediaRoot, SafeSegment(userId));
        Directory.CreateDirectory(userDir);
        var storagePath = Path.Combine(userDir, id.ToString("N") + ext.ToLowerInvariant());
        await using (var stream = File.Create(storagePath))
        {
            await file.CopyToAsync(stream);
        }

        var asset = new MediaAsset
        {
            Id = id,
            UserId = userId,
            FileName = Path.GetFileName(file.FileName),
            ContentType = contentType,
            SizeBytes = file.Length,
            StoragePath = storagePath,
            CreatedAt = DateTime.UtcNow,
        };
        await media.AddAsync(asset);
        return ServiceResult<MediaUploadResult>.Success(
            new MediaUploadResult(id, $"/api/media/{id}", asset.FileName, asset.ContentType, asset.SizeBytes));
    }

    /// <summary>The stored file, or null when it is missing or belongs to someone else.</summary>
    public async Task<MediaAsset?> FindFileAsync(Guid id, string userId)
    {
        var asset = await media.GetAsync(id, userId);
        return asset is not null && File.Exists(asset.StoragePath) ? asset : null;
    }

    private static string SafeSegment(string value) => new(value.Where(char.IsLetterOrDigit).ToArray());
}
