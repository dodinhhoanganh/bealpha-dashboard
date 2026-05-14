# PostgreSQL Database Setup Guide for BEALPHA Dashboard

## Overview
This dashboard uses **PostgreSQL** as the database and **Prisma ORM** for data management.

---

## Step 1: Install PostgreSQL Server

### Windows
1. Download PostgreSQL from: https://www.postgresql.org/download/windows/
2. Run the installer (choose version 14+)
3. During installation:
   - Set postgres user password (remember this!)
   - Keep default port: **5432**
   - Choose your preferred components (default is fine)
4. Verify installation by opening PowerShell:
   ```powershell
   psql --version
   ```

### Verify PostgreSQL is Running
```powershell
# Check if PostgreSQL service is running (Windows)
Get-Service postgresql-* | Select-Object Status, Name
```

---

## Step 2: Create Database and User

### Connect to PostgreSQL
```powershell
# Connect as superuser
psql -U postgres
```

### Create Database and User
```sql
-- Create database
CREATE DATABASE bealpha_db;

-- (Optional) Create dedicated user for better security
CREATE USER bealpha_user WITH PASSWORD 'your_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE bealpha_db TO bealpha_user;

-- Connect to the new database
\c bealpha_db

-- Grant schema privileges
GRANT ALL PRIVILEGES ON SCHEMA public TO bealpha_user;

-- Exit psql
\q
```

---

## Step 3: Configure Environment Variables

Update `.env.local` in the project root with your PostgreSQL credentials:

```env
# Using postgres user (simpler for development)
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/bealpha_db?schema=public"

# OR using dedicated user (more secure)
DATABASE_URL="postgresql://bealpha_user:your_secure_password@localhost:5432/bealpha_db?schema=public"

NODE_ENV="development"
```

**Replace:**
- `your_password` → PostgreSQL password you set during installation
- `your_secure_password` → Password you created for bealpha_user

---

## Step 4: Run Prisma Setup

### Initialize Prisma (First Time Only)
```powershell
# Install Prisma CLI (already in dependencies, but explicitly if needed)
npm install prisma

# Create Prisma migrations
npm run db:push
```

### Alternative: Use Prisma Migrate
```powershell
# This creates migration files and applies them
npm run db:migrate
```

---

## Step 5: Seed Database with Mock Data

```powershell
npm run db:seed
```

This will:
- Delete existing data (for fresh start)
- Create 6 test releases (QUA KHU MOI, NGÀY HÔM NAY, NHO3M, etc.)
- Create 5 test playlists with performance data

---

## Step 6: Verify Database Setup

### Option A: Using Prisma Studio
```powershell
npm run db:studio
```
This opens a web UI showing all database tables and data.

### Option B: Using psql
```powershell
# Connect to the database
psql -U postgres -d bealpha_db

# List tables
\dt

# View data
SELECT * FROM releases LIMIT 5;
SELECT * FROM playlists LIMIT 5;

# Exit
\q
```

---

## Step 7: Start the Dashboard

```powershell
npm run dev
```

The dashboard will now fetch real data from PostgreSQL instead of mock data.

Visit: http://localhost:3000

---

## Available Database Commands

```powershell
# Development - creates/updates tables
npm run db:push

# Create migration (with naming)
npm run db:migrate

# Seed database with test data
npm run db:seed

# Open Prisma Studio (Web UI)
npm run db:studio

# Regenerate Prisma client after schema changes
npx prisma generate
```

---

## Database Schema Overview

### Release Model
- `id` - Unique identifier
- `title` - Release title
- `artist` - Artist name
- `label` - Record label
- `project` - Project name
- `format` - "Single", "Album", "EP", etc.
- `releaseDate` - Release date
- `cover` - Cover image URL
- `status` - "pending", "scheduled", "released", "rejected"
- `createdAt`, `updatedAt` - Timestamps

### Playlist Model
- `id` - Unique identifier
- `name` - Playlist name
- `platform` - "Spotify", "Apple Music", etc.
- `cover` - Cover image URL
- `plays` - Total plays count
- `followers` - Total followers
- `color` - Hex color for visualization
- `createdAt`, `updatedAt` - Timestamps

### PlaylistPerformance Model
- Tracks historical performance data for playlists
- Fields: playlistId, date, plays, followers

### Analytics Model
- Tracks daily analytics metrics
- Fields: date, totalPlays, totalSkips, skipRate, avgPlayDuration

---

## API Endpoints

### Releases
- `GET /api/releases` - Fetch all releases
- `POST /api/releases` - Create new release

### Playlists
- `GET /api/playlists` - Fetch all playlists
- `POST /api/playlists` - Create new playlist

### Analytics
- `GET /api/analytics` - Fetch analytics data
- `POST /api/analytics` - Create new analytics record

---

## Troubleshooting

### "Database connection failed"
- Check PostgreSQL is running: `Get-Service postgresql-* | Select-Object Status`
- Verify credentials in `.env.local`
- Ensure database `bealpha_db` exists

### "Cannot find module '@prisma/client'"
```powershell
npm install
npm run db:push
```

### "Migration failed"
```powershell
# Reset database (⚠️ deletes all data)
npx prisma migrate reset

# Or manually drop and recreate:
psql -U postgres -d bealpha_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run db:push
npm run db:seed
```

### "Port 5432 already in use"
Change `.env.local`:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5433/bealpha_db"
```
And update PostgreSQL to listen on port 5433.

---

## Next Steps

1. ✅ Install PostgreSQL
2. ✅ Create database `bealpha_db`
3. ✅ Update `.env.local` with credentials
4. ✅ Run `npm run db:push`
5. ✅ Run `npm run db:seed`
6. ✅ Start: `npm run dev`
7. Add authentication (optional)
8. Create dashboard features for CRUD operations

---

## Security Notes

- Use strong passwords for PostgreSQL users
- Never commit `.env.local` to git (add to `.gitignore`)
- For production: Use managed PostgreSQL services (AWS RDS, Supabase, etc.)
- Implement API authentication before deploying

---

**Questions?** Check Prisma docs: https://www.prisma.io/docs/
