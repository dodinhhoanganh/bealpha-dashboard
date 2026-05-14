# BEALPHA Dashboard - Quick Start Guide

## Prerequisites
- Node.js 18+ installed
- PostgreSQL server installed and running
- Basic familiarity with terminal/PowerShell

---

## Quick Setup (5 minutes)

### 1. Update Database Connection
Edit `.env.local` and set your PostgreSQL credentials:
```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/bealpha_db?schema=public"
```

### 2. Create Database
```powershell
psql -U postgres -c "CREATE DATABASE bealpha_db;"
```

### 3. Initialize Database
```powershell
npm run db:push
npm run db:seed
```

### 4. Run Dashboard
```powershell
npm run dev
```

Visit: **http://localhost:3000**

---

## Project Structure

```
bealpha-dashboard/
├── app/
│   ├── page.tsx              # Main dashboard component
│   ├── globals.css           # Material UI styling
│   └── api/
│       ├── releases/route.ts # Release endpoints
│       ├── playlists/route.ts# Playlist endpoints
│       └── analytics/route.ts# Analytics endpoints
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── seed.ts               # Mock data seeder
├── public/                   # Static files
├── .env.local               # Database credentials
└── package.json             # Dependencies
```

---

## Key Features

✅ **Material UI Dark Theme** - Professional black/white/gray design
✅ **Analytics Dashboard** - Charts for playlist performance
✅ **Release Catalog** - Track upcoming and recent releases
✅ **PostgreSQL Integration** - Persistent data storage
✅ **REST API** - Get/Post releases, playlists, analytics
✅ **Recharts Visualization** - Line, bar, and pie charts

---

## Development Commands

```powershell
# Start dev server
npm run dev

# Database operations
npm run db:push           # Initialize database
npm run db:seed           # Seed with test data
npm run db:studio         # Open Prisma UI
npm run db:migrate        # Create migrations

# Production build
npm run build
npm run start
```

---

## Database Schema

### Release (Upcoming & Recent Releases)
- Title, Artist, Label, Format (Single/Album/EP)
- Release Date, Cover Image, Status (pending/scheduled/released/rejected)

### Playlist (Spotify, Apple Music, etc.)
- Name, Platform, Cover, Plays, Followers

### Analytics (Daily Metrics)
- Total Plays, Total Skips, Skip Rate, Avg Duration

---

## API Examples

### Get Releases
```javascript
const response = await fetch('/api/releases');
const releases = await response.json();
```

### Create Release
```javascript
const response = await fetch('/api/releases', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'New Song',
    artist: 'Artist Name',
    label: 'BEALPHA',
    project: 'Project Name',
    format: 'Single',
    releaseDate: new Date().toISOString(),
    cover: 'https://example.com/cover.jpg',
    status: 'scheduled'
  })
});
```

---

## Default Test Data (After Seeding)

### Releases
- QUA KHU MOI (Idt)
- NGÀY HÔM NAY (b2na)
- NHO3M (KR3W)
- The Rebels Cypher (Various)
- ALL BARK (Various)
- Dear (Various)

### Playlists
- Chill Tracks (Spotify)
- This Is ODESZA (Spotify)
- Daily Mix (Apple Music)
- Peaceful Piano (Spotify)
- Release Radar (Spotify)

---

## Troubleshooting

### Database connection error
✓ Check PostgreSQL is running: `Get-Service postgresql-*`
✓ Verify `.env.local` has correct credentials
✓ Ensure database exists: `psql -U postgres -l`

### "Cannot find module" error
```powershell
npm install
npm run db:push
```

### Reset database (clears all data)
```powershell
npx prisma migrate reset
npm run db:seed
```

---

## Next Steps

1. Explore the dashboard at http://localhost:3000
2. Check mock data in Prisma Studio: `npm run db:studio`
3. Create new releases via API POST request
4. Customize colors, fonts, and layout in `app/globals.css`
5. Add authentication for production use

---

## Documentation

- [PostgreSQL Setup Guide](./POSTGRES_SETUP.md)
- [Prisma Docs](https://www.prisma.io/docs/)
- [Next.js Docs](https://nextjs.org/docs)
- [Material UI](https://mui.com/material-ui/)

---

**Ready to go!** Your dashboard is fully set up. 🚀
