using System.Text.Json;

namespace SyriAI.Backend.Entities;

// Request and response shapes of the studio API. They keep the exact JSON of the previous
// minimal API, so the browser code did not change when the backend moved to layers.

public record ScriptInput(string Title, string Content);

/// <summary>Row of the script library list (without the script text).</summary>
public record ScriptSummary(int Id, string Title, DateTime UpdatedAt, int Characters);

public record SessionInput(
    string? Participant, string? Condition, string? ScriptTitle,
    DateTime StartedAt, DateTime EndedAt, double DurationSeconds,
    int TotalWords, int WordsReached, double ProgressPercent, double AverageWpm,
    int RecognitionResults, int MatchEvents, double MatchRatePercent, int ManualNavigations,
    int StallCount, double MedianProcessingMs, double P95ProcessingMs,
    double FaceVisiblePercent, double EyeContactPercent, int FaceLostCount,
    string? Notes, JsonElement? Timeline, int RecoveryCount, JsonElement? Segments);

/// <summary>Data added after a session: researcher count, SUS answers, notes. Null fields are left unchanged.</summary>
public record SessionPatch(int? ObserverLostCount, int[]? SusAnswers, string? Notes);

/// <summary>Row of the session history list.</summary>
public record SessionSummary(
    int Id, string? Participant, string? Condition, string? ScriptTitle, DateTime StartedAt, double DurationSeconds,
    int TotalWords, int WordsReached, double ProgressPercent, double AverageWpm, double MatchRatePercent,
    int StallCount, double MedianProcessingMs, double EyeContactPercent,
    int? ObserverLostCount, double? SusScore);

/// <summary>One saved session with its timeline and segments, to show its report again.</summary>
public record SessionDetail(
    int Id, string? Participant, string? Condition, string? ScriptTitle, string? Notes,
    DateTime StartedAt, DateTime EndedAt, double DurationSeconds,
    int TotalWords, int WordsReached, double ProgressPercent, double AverageWpm,
    int RecognitionResults, int MatchEvents, double MatchRatePercent, int ManualNavigations,
    int StallCount, int RecoveryCount, double MedianProcessingMs, double P95ProcessingMs,
    double FaceVisiblePercent, double EyeContactPercent, int FaceLostCount,
    int? ObserverLostCount, double? SusScore, JsonElement? Timeline, JsonElement? Segments);

public record SessionPatchResult(int Id, int? ObserverLostCount, double? SusScore);

public record MediaUploadResult(Guid Id, string Url, string FileName, string ContentType, long SizeBytes);
