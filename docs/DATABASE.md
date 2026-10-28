# Database (MySQL)

SyriAI Studio stores accounts and studio data in MySQL through Entity Framework Core with the
[Pomelo](https://github.com/PomeloFoundation/Pomelo.EntityFrameworkCore.MySql) provider.
Uploaded files stay on disk in `SyriAI.Backend/App_Data/media`; the database only keeps their index.

## Setup on macOS

```bash
brew install mysql
brew services start mysql          # starts now and at every login

mysql -u root <<'SQL'
CREATE DATABASE syriai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'syriai'@'localhost' IDENTIFIED BY 'choose-a-password';
GRANT ALL PRIVILEGES ON syriai.* TO 'syriai'@'localhost';
SQL

cd SyriAI.Backend
dotnet user-secrets set "ConnectionStrings:DefaultConnection" \
  "Server=localhost;Port=3306;Database=syriai;User=syriai;Password=choose-a-password;"
```

The password lives only in user-secrets; `appsettings.json` holds a placeholder. On start-up the app
applies both sets of migrations, so all tables are created automatically.

## Tables

| Context | Tables | Migrations | History table |
|---|---|---|---|
| `ApplicationDbContext` | `AspNetUsers`, `AspNetRoles`, … (Identity) | `DataAccess/Migrations/Identity` | `__EFMigrationsHistory` |
| `StudioDbContext` | `Scripts`, `Sessions`, `Settings`, `Media` | `DataAccess/Migrations/Studio` | `__StudioMigrationsHistory` |

A model change needs a new migration for the context it belongs to:

```bash
dotnet ef migrations add <Name> -c StudioDbContext -o DataAccess/Migrations/Studio
```

## Moving data from the old SQLite file

Earlier versions stored everything in `app.db` (SQLite). Copy it into MySQL once:

```bash
dotnet run -- import-sqlite app.db
```

It copies accounts (with their passwords, confirmations and logins), scripts, sessions, settings and
the media index. The same works from one MySQL database to another, e.g. from the local database
into the cloud database:

```bash
ConnectionStrings__DefaultConnection="<target>" dotnet run -- import-mysql "<source connection string>"
``` Rows that already exist are skipped, so running it again is harmless. `app.db` is
only read and can be kept as a backup.

## Testing

Use the separate `syriai_test` database, never the real one. Point the app at it with an
environment variable for that run only:

```bash
ConnectionStrings__DefaultConnection="Server=localhost;Port=3306;Database=syriai_test;User=syriai;Password=...;" \
  dotnet run --launch-profile http
```

## Backup and restore

```bash
mysqldump -u root syriai > syriai-backup.sql
mysql -u root syriai < syriai-backup.sql
```
