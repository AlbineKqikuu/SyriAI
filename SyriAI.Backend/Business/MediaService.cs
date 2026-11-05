using SyriAI.Backend.DataAccess.Repositories;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.Business;

/// <summary>
/// Documents and media shared with the client screens. Files are served from disk under
/// App_Data/media/{user}; the database keeps the index (owner, name, type, path) and a copy of
/// the bytes in pieces (<see cref="MediaChunk"/>), so a file lost with the cloud container's disk
/// is rebuilt the next time it is opened.
/// </summary>
public class MediaService(IMediaRepository media, IWebHostEnvironment env, ILogger<MediaService> logger)
{
    public const long MaxMediaBytes = 250L * 1024 * 1024;

    /// <summary>Bytes per database piece: well under TiDB's 6 MB row limit</summary>
    public const int ChunkBytes = 2 * 1024 * 1024;

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

        // Copy into the database piece by piece (never the whole file in memory)
        try
        {
            await using var source = File.OpenRead(storagePath);
            var buffer = new byte[ChunkBytes];
            for (var index = 0; ; index++)
            {
                var read = await source.ReadAtLeastAsync(buffer, ChunkBytes, throwOnEndOfStream: false);
                if (read == 0) break;
                await media.AddChunkAsync(new MediaChunk { MediaId = id, Index = index, Data = buffer[..read] });
                if (read < ChunkBytes) break;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not store media {MediaId} in the database", id);
            // Best effort: the database may be the thing that failed
            try { await media.DeleteChunksAsync(id); } catch (Exception cleanup) { logger.LogWarning(cleanup, "Cleanup of media {MediaId} failed", id); }
            File.Delete(storagePath);
            return ServiceResult<MediaUploadResult>.Invalid("The file could not be saved. Please try again.");
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

    /// <summary>
    /// The stored file, or null when it belongs to someone else or cannot be found. A file missing
    /// on disk (the cloud container restarted) is rebuilt from its database copy first.
    /// </summary>
    public async Task<MediaAsset?> FindFileAsync(Guid id, string userId)
    {
        var asset = await media.GetAsync(id, userId);
        if (asset is null) return null;
        if (File.Exists(asset.StoragePath)) return asset;

        // Rebuild under this server's folder (the saved path may come from another machine)
        var path = Path.Combine(MediaRoot, SafeSegment(userId), id.ToString("N") + Path.GetExtension(asset.FileName).ToLowerInvariant());
        if (!File.Exists(path) && !await RestoreAsync(asset, path)) return null;
        asset.StoragePath = path;
        return asset;
    }

    private async Task<bool> RestoreAsync(MediaAsset asset, string path)
    {
        var count = await media.CountChunksAsync(asset.Id);
        if (count == 0) return false; // uploaded before database copies existed

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // A temporary name, so a request at the same moment never serves a half-written file
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var target = File.Create(temp))
            {
                for (var index = 0; index < count; index++)
                {
                    var data = await media.GetChunkAsync(asset.Id, index);
                    if (data is null) return false;
                    await target.WriteAsync(data);
                }
            }
            if (new FileInfo(temp).Length != asset.SizeBytes)
            {
                logger.LogError("Media {MediaId}: rebuilt size does not match, not served", asset.Id);
                return false;
            }
            File.Move(temp, path, overwrite: true);
            logger.LogInformation("Media {MediaId} rebuilt from the database", asset.Id);
            return true;
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    private static string SafeSegment(string value) => new(value.Where(char.IsLetterOrDigit).ToArray());
}
