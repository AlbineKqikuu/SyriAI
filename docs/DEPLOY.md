# Deploying SyriAI Studio (Render + Aiven MySQL)

The app needs a running server and a MySQL database. It runs on [Render](https://render.com) as a
Docker container built from `SyriAI.Backend/Dockerfile`, with a free MySQL database on
[Aiven](https://aiven.io). Both have free plans.

## 1. Database (Aiven)

1. Create a free **MySQL** service on Aiven.
2. From its overview page copy host, port, user (`avnadmin`) and password, and build the
   connection string (Aiven requires TLS):

   ```
   Server=<host>;Port=<port>;Database=defaultdb;User=avnadmin;Password=<password>;SslMode=Required;
   ```

## 2. App (Render)

1. On Render choose **New → Blueprint** and pick this repository. Render reads `render.yaml`.
2. Fill in the values it asks for:

| Variable | Value |
|---|---|
| `ConnectionStrings__DefaultConnection` | the connection string from step 1 |
| `SeedAdmin__Email`, `SeedAdmin__Password` | the first admin account |
| `Smtp__User`, `Smtp__FromEmail`, `Smtp__Password` | Gmail address and app password for the e-mail codes |

Secrets are only stored in Render, never in the repository. Every push to `main` redeploys.

Tables are created by the EF Core migrations on start-up. The app trusts the proxy's
`X-Forwarded-*` headers (HTTPS is terminated by Render), so camera and microphone work over the
public `https://` link.

## Limits of the free plans

- The app sleeps after ~15 minutes without visitors; the next visit takes about a minute.
- The free web service has no persistent disk: uploaded media and the login-cookie keys
  (`App_Data`) are reset when the app restarts, so users sign in again and re-upload files.
  A paid instance with a disk mounted on `/app/App_Data` keeps them.
