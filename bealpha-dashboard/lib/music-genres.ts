// Music Genres and Sub-Genres
// Source: https://www.musicgenreslist.com/

export interface GenreOption {
  value: string;
  label: string;
  subgenres?: string[];
}

export const MUSIC_GENRES: GenreOption[] = [
  {
    value: "Alternative",
    label: "Alternative",
    subgenres: [
      "Art Punk",
      "Alternative Rock",
      "Britpunk",
      "College Rock",
      "Grunge",
      "Indie Rock",
      "New Wave",
      "Punk",
      "Shoegaze",
    ],
  },
  {
    value: "Anime",
    label: "Anime",
  },
  {
    value: "Blues",
    label: "Blues",
    subgenres: [
      "Acoustic Blues",
      "Blues Rock",
      "Chicago Blues",
      "Classic Blues",
      "Delta Blues",
      "Electric Blues",
      "Soul Blues",
    ],
  },
  {
    value: "Classical",
    label: "Classical",
    subgenres: [
      "Baroque",
      "Chamber Music",
      "Choral",
      "Contemporary Classical",
      "Opera",
      "Orchestral",
      "Symphony",
    ],
  },
  {
    value: "Country",
    label: "Country",
    subgenres: [
      "Bluegrass",
      "Classic Country",
      "Contemporary Country",
      "Country Pop",
      "Country Rock",
      "Honky Tonk",
      "Outlaw Country",
    ],
  },
  {
    value: "Dance",
    label: "Dance / EDM",
    subgenres: [
      "Breakbeat",
      "Dubstep",
      "Electro House",
      "Garage",
      "Hardcore",
      "House",
      "Techno",
      "Trance",
      "Trap",
    ],
  },
  {
    value: "Electronic",
    label: "Electronic",
    subgenres: [
      "Ambient",
      "Chillwave",
      "Downtempo",
      "Drum & Bass",
      "Electro",
      "IDM",
      "Industrial",
      "Synthpop",
      "Trip Hop",
    ],
  },
  {
    value: "Folk",
    label: "Folk",
    subgenres: [
      "Contemporary Folk",
      "Indie Folk",
      "Folk Rock",
      "Traditional Folk",
    ],
  },
  {
    value: "Hip-Hop/Rap",
    label: "Hip-Hop / Rap",
    subgenres: [
      "Alternative Rap",
      "Conscious Hip Hop",
      "Dirty South",
      "East Coast",
      "Gangsta Rap",
      "Old School Rap",
      "Trap",
      "West Coast Rap",
    ],
  },
  {
    value: "Jazz",
    label: "Jazz",
    subgenres: [
      "Acid Jazz",
      "Bebop",
      "Big Band",
      "Cool Jazz",
      "Fusion",
      "Jazz-Funk",
      "Smooth Jazz",
      "Swing",
    ],
  },
  {
    value: "Latin",
    label: "Latin",
    subgenres: [
      "Bachata",
      "Bossa Nova",
      "Cumbia",
      "Flamenco",
      "Merengue",
      "Reggaeton",
      "Salsa",
      "Tango",
    ],
  },
  {
    value: "Metal",
    label: "Metal",
    subgenres: [
      "Black Metal",
      "Death Metal",
      "Doom Metal",
      "Folk Metal",
      "Gothic Metal",
      "Heavy Metal",
      "Power Metal",
      "Thrash Metal",
      "Progressive Metal",
    ],
  },
  {
    value: "Pop",
    label: "Pop",
    subgenres: [
      "Britpop",
      "Bubblegum Pop",
      "Dance Pop",
      "Dream Pop",
      "Electro Pop",
      "Indie Pop",
      "K-Pop",
      "J-Pop",
      "Synth Pop",
      "Teen Pop",
    ],
  },
  {
    value: "R&B/Soul",
    label: "R&B / Soul",
    subgenres: [
      "Contemporary R&B",
      "Funk",
      "Motown",
      "Neo-Soul",
      "Soul",
      "Soul Blues",
    ],
  },
  {
    value: "Reggae",
    label: "Reggae",
    subgenres: [
      "Dancehall",
      "Dub",
      "Lovers Rock",
      "Ragga",
      "Reggae Fusion",
      "Roots Reggae",
      "Ska",
    ],
  },
  {
    value: "Rock",
    label: "Rock",
    subgenres: [
      "Alternative Rock",
      "Arena Rock",
      "Classic Rock",
      "Glam Rock",
      "Hard Rock",
      "Indie Rock",
      "Progressive Rock",
      "Psychedelic Rock",
      "Punk Rock",
      "Southern Rock",
    ],
  },
  {
    value: "World",
    label: "World",
    subgenres: [
      "African",
      "Asian",
      "Cajun",
      "Calypso",
      "Celtic",
      "Hawaiian",
      "Latin",
      "Middle Eastern",
      "Polka",
    ],
  },
  {
    value: "Christian/Gospel",
    label: "Christian / Gospel",
    subgenres: [
      "CCM",
      "Christian Rock",
      "Contemporary Gospel",
      "Gospel",
      "Praise & Worship",
      "Southern Gospel",
    ],
  },
  {
    value: "Children",
    label: "Children's Music",
  },
  {
    value: "Comedy",
    label: "Comedy / Novelty",
  },
  {
    value: "Soundtrack",
    label: "Soundtrack",
    subgenres: ["Movie Soundtrack", "TV Soundtrack", "Video Game Music"],
  },
  {
    value: "Other",
    label: "Other",
  },
];

// Get all unique subgenres for dropdown
export const getAllSubgenres = (): string[] => {
  const subgenres: string[] = [];
  MUSIC_GENRES.forEach((genre) => {
    if (genre.subgenres) {
      subgenres.push(...genre.subgenres);
    }
  });
  return subgenres.sort();
};
