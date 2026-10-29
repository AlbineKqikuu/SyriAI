using System.ComponentModel.DataAnnotations;

namespace SyriAI.Backend.Entities;

/// <summary>A saved teleprompter script owned by one user.</summary>
public class Script
{
    public int Id { get; set; }

    [MaxLength(450)]
    public string UserId { get; set; } = "";

    [MaxLength(200)]
    public string Title { get; set; } = "";

    public string Content { get; set; } = "";

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Metrics recorded for one live teleprompter session (Start LIVE → Stop).
/// Used for the session report and exported as CSV for the evaluation study.
/// </summary>
public class StudioSession
{
    public int Id { get; set; }

    [MaxLength(450)]
    public string UserId { get; set; } = "";

    // Study labels
    [MaxLength(100)]
    public string? Participant { get; set; }

    /// <summary>Experimental condition, e.g. "voice" (speech tracking) or "autoscroll".</summary>
    [MaxLength(50)]
    public string? Condition { get; set; }

    [MaxLength(200)]
    public string? ScriptTitle { get; set; }

    public DateTime StartedAt { get; set; }
    public DateTime EndedAt { get; set; }
    public double DurationSeconds { get; set; }

    // Reading progress
    public int TotalWords { get; set; }
    public int WordsReached { get; set; }
    public double ProgressPercent { get; set; }
    public double AverageWpm { get; set; }

    // Speech tracking
    public int RecognitionResults { get; set; }
    public int MatchEvents { get; set; }
    public double MatchRatePercent { get; set; }
    public int ManualNavigations { get; set; }

    /// <summary>Times the reader paused more than a few seconds without a match.</summary>
    public int StallCount { get; set; }

    /// <summary>Times the tracker lost the reader (off-script) and found them again further on.</summary>
    public int RecoveryCount { get; set; }

    /// <summary>Median / 95th percentile time from a recognition result to the highlight update (ms).</summary>
    public double MedianProcessingMs { get; set; }
    public double P95ProcessingMs { get; set; }

    // Camera feedback
    public double FaceVisiblePercent { get; set; }
    public double EyeContactPercent { get; set; }
    public int FaceLostCount { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    // Filled in after the session (user study)

    /// <summary>Times the participant visibly lost their place, counted by the researcher.</summary>
    public int? ObserverLostCount { get; set; }

    /// <summary>System Usability Scale score, 0–100.</summary>
    public double? SusScore { get; set; }

    /// <summary>The ten raw SUS answers (1–5) as a JSON array, for item-level analysis.</summary>
    [MaxLength(100)]
    public string? SusAnswersJson { get; set; }

    /// <summary>Optional JSON array of [secondsFromStart, wordIndex] samples for progress charts.</summary>
    public string? TimelineJson { get; set; }

    /// <summary>Optional JSON array with planned and actual time per rundown segment (story).</summary>
    public string? SegmentsJson { get; set; }
}

/// <summary>Per-user studio preferences stored as a JSON document.</summary>
public class UserSettings
{
    [Key]
    [MaxLength(450)]
    public string UserId { get; set; } = "";

    public string Json { get; set; } = "{}";

    public DateTime UpdatedAt { get; set; }
}

/// <summary>A document or media file uploaded to the studio and shared with the client screen.</summary>
public class MediaAsset
{
    public Guid Id { get; set; }

    [MaxLength(450)]
    public string UserId { get; set; } = "";

    [MaxLength(260)]
    public string FileName { get; set; } = "";

    [MaxLength(200)]
    public string ContentType { get; set; } = "application/octet-stream";

    public long SizeBytes { get; set; }

    [MaxLength(500)]
    public string StoragePath { get; set; } = "";

    public DateTime CreatedAt { get; set; }
}
