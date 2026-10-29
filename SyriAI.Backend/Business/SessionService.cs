using System.Globalization;
using System.Text;
using System.Text.Json;
using SyriAI.Backend.DataAccess.Repositories;
using SyriAI.Backend.Entities;

namespace SyriAI.Backend.Business;

/// <summary>
/// Live session metrics for the evaluation study: storing sessions, the SUS questionnaire
/// score and the CSV export.
/// </summary>
public class SessionService(ISessionRepository sessions)
{
    public const int MaxListed = 500;
    private const int MaxTimelineChars = 1024 * 1024;

    /// <summary>
    /// System Usability Scale (Brooke, 1996): ten answers 1–5. Odd items score (x − 1),
    /// even items (5 − x); the sum × 2.5 gives 0–100.
    /// </summary>
    public static double ComputeSusScore(IReadOnlyList<int> answers)
    {
        if (answers.Count != 10 || answers.Any(a => a is < 1 or > 5))
            throw new ArgumentException("SUS needs ten answers between 1 and 5.");
        var sum = 0;
        for (var i = 0; i < 10; i++) sum += i % 2 == 0 ? answers[i] - 1 : 5 - answers[i];
        return sum * 2.5;
    }

    public Task<List<SessionSummary>> ListAsync(string userId) => sessions.ListAsync(userId, MaxListed);

    public async Task<int> CreateAsync(SessionInput input, string userId)
    {
        var timeline = JsonArray(input.Timeline);
        var segments = JsonArray(input.Segments);

        var session = new StudioSession
        {
            UserId = userId,
            Participant = Trim(input.Participant, 100),
            Condition = Trim(input.Condition, 50),
            ScriptTitle = Trim(input.ScriptTitle, 200),
            StartedAt = input.StartedAt.ToUniversalTime(),
            EndedAt = input.EndedAt.ToUniversalTime(),
            DurationSeconds = input.DurationSeconds,
            TotalWords = input.TotalWords,
            WordsReached = input.WordsReached,
            ProgressPercent = input.ProgressPercent,
            AverageWpm = input.AverageWpm,
            RecognitionResults = input.RecognitionResults,
            MatchEvents = input.MatchEvents,
            MatchRatePercent = input.MatchRatePercent,
            ManualNavigations = input.ManualNavigations,
            StallCount = input.StallCount,
            RecoveryCount = Math.Max(0, input.RecoveryCount),
            MedianProcessingMs = input.MedianProcessingMs,
            P95ProcessingMs = input.P95ProcessingMs,
            FaceVisiblePercent = input.FaceVisiblePercent,
            EyeContactPercent = input.EyeContactPercent,
            FaceLostCount = input.FaceLostCount,
            Notes = Trim(input.Notes, 2000),
            TimelineJson = timeline,
            SegmentsJson = segments,
        };
        await sessions.AddAsync(session);
        return session.Id;
    }

    public async Task<ServiceResult<SessionDetail>> GetAsync(int id, string userId)
    {
        if (await sessions.GetAsync(id, userId) is not { } s) return ServiceResult<SessionDetail>.NotFound();
        return ServiceResult<SessionDetail>.Success(new SessionDetail(
            s.Id, s.Participant, s.Condition, s.ScriptTitle, s.Notes,
            s.StartedAt, s.EndedAt, s.DurationSeconds,
            s.TotalWords, s.WordsReached, s.ProgressPercent, s.AverageWpm,
            s.RecognitionResults, s.MatchEvents, s.MatchRatePercent, s.ManualNavigations,
            s.StallCount, s.RecoveryCount, s.MedianProcessingMs, s.P95ProcessingMs,
            s.FaceVisiblePercent, s.EyeContactPercent, s.FaceLostCount,
            s.ObserverLostCount, s.SusScore, ParseJson(s.TimelineJson), ParseJson(s.SegmentsJson)));
    }

    public async Task<ServiceResult<SessionPatchResult>> PatchAsync(int id, SessionPatch patch, string userId)
    {
        var session = await sessions.GetAsync(id, userId);
        if (session is null) return ServiceResult<SessionPatchResult>.NotFound();

        if (patch.ObserverLostCount is { } lost)
        {
            if (lost is < 0 or > 1000) return ServiceResult<SessionPatchResult>.Invalid("Invalid count.");
            session.ObserverLostCount = lost;
        }
        if (patch.SusAnswers is { } answers)
        {
            try { session.SusScore = ComputeSusScore(answers); }
            catch (ArgumentException e) { return ServiceResult<SessionPatchResult>.Invalid(e.Message); }
            session.SusAnswersJson = JsonSerializer.Serialize(answers);
        }
        if (patch.Notes is not null) session.Notes = Trim(patch.Notes, 2000);

        await sessions.SaveChangesAsync();
        return ServiceResult<SessionPatchResult>.Success(new SessionPatchResult(session.Id, session.ObserverLostCount, session.SusScore));
    }

    public Task<bool> DeleteAsync(int id, string userId) => sessions.DeleteAsync(id, userId);

    /// <summary>All sessions of the user as CSV, UTF-8 with BOM so Excel reads ë/ç.</summary>
    public async Task<byte[]> ExportCsvAsync(string userId)
    {
        var csv = BuildSessionsCsv(await sessions.ListAllAsync(userId));
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray();
    }

    public static string BuildSessionsCsv(IEnumerable<StudioSession> sessions)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",",
            "id", "participant", "condition", "script", "started_at_utc", "duration_s",
            "total_words", "words_reached", "progress_pct", "avg_wpm",
            "recognition_results", "match_events", "match_rate_pct", "manual_navigations", "stalls", "recoveries",
            "median_processing_ms", "p95_processing_ms",
            "face_visible_pct", "eye_contact_pct", "face_lost_count",
            "observer_lost_count", "sus_score", "sus_answers", "notes"));

        foreach (var s in sessions)
        {
            sb.AppendLine(string.Join(",",
                s.Id, Csv(s.Participant), Csv(s.Condition), Csv(s.ScriptTitle),
                s.StartedAt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture), Num(s.DurationSeconds),
                s.TotalWords, s.WordsReached, Num(s.ProgressPercent), Num(s.AverageWpm),
                s.RecognitionResults, s.MatchEvents, Num(s.MatchRatePercent), s.ManualNavigations, s.StallCount, s.RecoveryCount,
                Num(s.MedianProcessingMs), Num(s.P95ProcessingMs),
                Num(s.FaceVisiblePercent), Num(s.EyeContactPercent), s.FaceLostCount,
                s.ObserverLostCount?.ToString(CultureInfo.InvariantCulture) ?? "",
                s.SusScore is { } sus ? Num(sus) : "",
                SusAnswersCell(s.SusAnswersJson), Csv(s.Notes)));
        }
        return sb.ToString();
    }

    /// <summary>"[4,2,5,…]" → "4;2;5;…" (a single CSV cell that spreadsheets keep as text)</summary>
    private static string SusAnswersCell(string? json)
    {
        if (string.IsNullOrEmpty(json)) return "";
        var answers = JsonSerializer.Deserialize<int[]>(json) ?? [];
        return string.Join(";", answers);
    }

    /// <summary>Raw JSON of an array field, or null when it is missing, not an array or too large</summary>
    private static string? JsonArray(JsonElement? value) =>
        value is { ValueKind: JsonValueKind.Array } a && a.GetRawText() is { Length: <= MaxTimelineChars } raw ? raw : null;

    private static JsonElement? ParseJson(string? json) =>
        string.IsNullOrEmpty(json) ? null : JsonDocument.Parse(json).RootElement.Clone();

    private static string? Trim(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is var v && v.Length > max ? v[..max] : value.Trim();

    private static string Num(double value) => Math.Round(value, 2).ToString(CultureInfo.InvariantCulture);

    private static string Csv(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        // Quote always; also neutralise spreadsheet formula injection
        var safe = value.Length > 0 && "=+-@".Contains(value[0]) ? "'" + value : value;
        return "\"" + safe.Replace("\"", "\"\"") + "\"";
    }
}
