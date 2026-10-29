# SyriAI Studio — container image for cloud hosting (Railway), see docs/DEPLOY.md
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY SyriAI.Backend.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app ./
# Uploaded media lives here; mount a persistent volume on it (login keys are in the database)
RUN mkdir -p /app/App_Data
ENV ASPNETCORE_ENVIRONMENT=Production
# Railway passes the port in $PORT
CMD ASPNETCORE_URLS=http://0.0.0.0:${PORT:-8080} dotnet SyriAI.Backend.dll
