namespace SyriAI.Backend.Business;

public enum ResultStatus
{
    Ok,
    NotFound,
    /// <summary>The request breaks a business rule; <see cref="ServiceResult{T}.Error"/> says which.</summary>
    Invalid,
}

/// <summary>Outcome of a business operation, mapped to an HTTP response by the controllers.</summary>
public record ServiceResult<T>(ResultStatus Status, T? Value = default, string? Error = null)
{
    public static ServiceResult<T> Success(T value) => new(ResultStatus.Ok, value);
    public static ServiceResult<T> NotFound() => new(ResultStatus.NotFound);
    public static ServiceResult<T> Invalid(string error) => new(ResultStatus.Invalid, default, error);
}
