# BEALPHA Dashboard

A modern music label management dashboard for BEALPHA MUSIC GROUP LLC. Built with Next.js, React, Material UI, and PostgreSQL.

## Features

✨ **Modern UI**
- Material Design dark theme (black/white/gray)
- Responsive layout with Material UI components
- Professional typography with Roboto font
- Material Design icons throughout

📊 **Analytics Dashboard**
- Playlist performance visualization (line charts)
- Play duration analytics (bar charts)
- Skip rate analysis (pie charts)
- Real-time metrics

🎵 **Release Management**
- Upcoming releases tracker
- Recent releases timeline
- Status tracking (pending/scheduled/released/rejected)
- Cover art display

🗄️ **Database Integration**
- PostgreSQL backend with Prisma ORM
- RESTful API endpoints
- Release, Playlist, Analytics data models
- Historical performance tracking

## Quick Start

### 1. Setup (5 minutes)

```powershell
# Update .env.local with your PostgreSQL password
# DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/bealpha_db"

# Install dependencies
npm install

# Initialize database
npm run db:push

# Seed with test data
npm run db:seed

# Start development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 2. Full Setup Guide

See [QUICKSTART.md](./QUICKSTART.md) for 5-minute setup or [POSTGRES_SETUP.md](./POSTGRES_SETUP.md) for detailed PostgreSQL configuration.

## Project Structure

```
bealpha-dashboard/
├── app/
│   ├── page.tsx              # Main dashboard component
│   ├── layout.tsx            # App layout
│   ├── globals.css           # Material UI styling
│   └── api/
│       ├── releases/         # Release endpoints
│       ├── playlists/        # Playlist endpoints
│       └── analytics/        # Analytics endpoints
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── seed.ts               # Test data seeder
└── public/                   # Static assets
```

## Tech Stack

- **Frontend**: Next.js 13+, React 19, TypeScript
- **UI Framework**: Material UI (@mui/icons-material)
- **Styling**: Tailwind CSS, Material Design typography
- **Charts**: Recharts (line, bar, pie charts)
- **Database**: PostgreSQL with Prisma ORM
- **Fonts**: Roboto (@fontsource/roboto)

## API Endpoints

### Releases
- `GET /api/releases` - Fetch all releases
- `POST /api/releases` - Create new release

### Playlists
- `GET /api/playlists` - Fetch all playlists
- `POST /api/playlists` - Create new playlist

### Analytics
- `GET /api/analytics` - Fetch analytics data
- `POST /api/analytics` - Record new analytics

## Database Commands

```powershell
# Start development server
npm run dev

# Database management
npm run db:push              # Initialize/update schema
npm run db:seed              # Seed with test data
npm run db:studio            # Open Prisma Studio (Web UI)
npm run db:migrate           # Create migrations

# Production
npm run build
npm run start
```

## Database Models

### Release
- Title, Artist, Label, Project name
- Format (Single/Album/EP)
- Release date and cover image
- Status tracking (pending/scheduled/released/rejected)

### Playlist
- Name and platform (Spotify/Apple Music/etc)
- Play count and followers
- Color for visualization

### PlaylistPerformance
- Historical tracking of playlist metrics
- Date-based performance data

### Analytics
- Daily metrics: total plays, skips, skip rate
- Average play duration

## Troubleshooting

**PostgreSQL connection error?**
- Ensure PostgreSQL is running
- Check `.env.local` has correct credentials
- Verify database `bealpha_db` exists

**Missing dependencies?**
```powershell
npm install
npx prisma generate
```

**Reset database?**
```powershell
npx prisma migrate reset
npm run db:seed
```

## Documentation

- [Quick Start Guide](./QUICKSTART.md) - 5-minute setup
- [PostgreSQL Setup](./POSTGRES_SETUP.md) - Detailed database configuration
- [Integration Guide](./INTEGRATION_GUIDE.md) - API and schema details
- [Prisma Docs](https://www.prisma.io/docs/) - Database ORM documentation
- [Next.js Docs](https://nextjs.org/docs) - Framework documentation

## Development

Built with:
- React hooks for state management
- Server-side rendering with Next.js
- Material Design principles
- TypeScript for type safety

## Production Deployment

1. Update `.env.local` with production database URL
2. Run `npm run build`
3. Deploy with `npm run start`
4. Or use: Vercel, AWS, Digital Ocean, etc.

**Note**: Use managed PostgreSQL service for production (AWS RDS, Supabase, etc.)

## License

BEALPHA MUSIC GROUP LLC

## Support

For issues or questions:
1. Check documentation files
2. Review Prisma and Next.js docs
3. Check database connection with `npm run db:studio`

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
