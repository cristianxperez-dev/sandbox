/* Clubhouse Bag Tags: the six built-in destinations. This is the one place to change them.

   id        never change it (staff preferences and logos are saved against it)
   label     the assignment as it appears in the app and on the tag
   tagLine   the destination line printed on the tag, under the name
   facility, address, city   the shipping address printed on the tag (staff can override these in the app)
   short     short code for filters and badges
   accent    accent colour on the tag, taken from the club's logo (lightened where needed to read on navy)
   logo      the club's official logo file inside logos/ (or null if there is none).
   background  a ballpark photo inside backgrounds/ (landscape JPEG, 1600 px or wider), shown under a navy wash, or null.
             It is cropped to fill whatever tag size is chosen, never stretched.
   focus     optional [x, y] (0 to 1) point of the photo kept in view when it is cropped; default the centre
             Staff can also upload a logo in the app; that copy stays in their browser.
   aliases   values recognized in an imported CSV (case, spaces and punctuation are ignored). Keep them
             unambiguous: a value that matches two destinations is flagged for review, never guessed. */
window.CBT_DESTINATIONS = [
  {
    id: "sugar-land", label: "Sugar Land Space Cowboys", short: "SUG", level: "Triple-A",
    tagLine: "Sugar Land Space Cowboys",
    facility: "Constellation Field", address: "1 Stadium Drive", city: "Sugar Land, TX 77498",
    accent: "#1EC3E0", logo: "logos/sugar-land.webp", background: "backgrounds/sugar-land.jpg",
    aliases: ["Sugar Land", "Sugar Land Space Cowboys", "Space Cowboys", "SUG", "SL", "AAA", "Triple-A", "Triple A"]
  },
  {
    id: "corpus-christi", label: "Corpus Christi Hooks", short: "CC", level: "Double-A",
    tagLine: "Corpus Christi Hooks",
    facility: "Whataburger Field", address: "734 E. Port Avenue", city: "Corpus Christi, TX 78401",
    accent: "#63A8DE", logo: "logos/corpus-christi.webp", background: "backgrounds/corpus-christi.jpg",
    aliases: ["Corpus Christi", "Corpus Christi Hooks", "Corpus", "Hooks", "CC", "AA", "Double-A", "Double A"]
  },
  {
    id: "asheville", label: "Asheville Tourists", short: "ASH", level: "High-A",
    tagLine: "Asheville Tourists",
    facility: "HomeTrust Park", address: "30 Buchanan Place", city: "Asheville, NC 28801",
    accent: "#6ECDB4", logo: "logos/asheville.webp", background: "backgrounds/asheville.jpg",
    aliases: ["Asheville", "Asheville Tourists", "Tourists", "ASH", "High-A", "High A", "A+"]
  },
  {
    id: "fayetteville", label: "Fayetteville Woodpeckers", short: "FAY", level: "Low-A",
    tagLine: "Fayetteville Woodpeckers",
    facility: "Segra Stadium", address: "460 Hay Street", city: "Fayetteville, NC 28301",
    accent: "#E2304A", logo: "logos/fayetteville.webp", background: "backgrounds/fayetteville.jpg",
    aliases: ["Fayetteville", "Fayetteville Woodpeckers", "Woodpeckers", "FAY", "Low-A", "Low A", "Single-A", "Single A"]
  },
  {
    id: "fcl", label: "FCL", short: "FCL", level: "Rookie",
    tagLine: "FCL · Florida Complex League",
    facility: "CACTI Park of the Palm Beaches", address: "5454 N. Haverhill Road", city: "West Palm Beach, FL 33407",
    accent: "#EB6E1F", logo: "logos/astros.webp", background: "backgrounds/cacti-park.jpg", focus: [0.5, 0.45],
    aliases: ["FCL", "Florida Complex League", "FCL Astros", "Complex League"]
  },
  {
    id: "rehab", label: "Rehab", short: "RHB", level: "Rehab",
    tagLine: "Rehab Assignment · Houston Astros",
    facility: "CACTI Park of the Palm Beaches", address: "5454 N. Haverhill Road", city: "West Palm Beach, FL 33407",
    accent: "#EB6E1F", logo: "logos/astros.webp", background: "backgrounds/cacti-park.jpg", focus: [0.5, 0.45],
    aliases: ["Rehab", "Rehabilitation", "Rehab Assignment"]
  }
];

/* West Palm mode: when staff choose it, every tag uses this destination instead of the person's assignment
   (Spring Training and centralized travel). It is not an assignment (never matched from a CSV), never changes
   the roster, and prints Houston Astros branding only: no FCL, Rehab or affiliate wording. */
window.CBT_WEST_PALM = {
  id: "west-palm", label: "Houston Astros", short: "WPB", level: "West Palm",
  tagLine: "Houston Astros",
  facility: "CACTI Park of the Palm Beaches", address: "5444 Haverhill Road", city: "West Palm Beach, FL 33407",
  accent: "#EB6E1F", logo: "logos/astros.webp", background: "backgrounds/cacti-park.jpg", focus: [0.5, 0.45],
  aliases: []
};

/* FCL, Rehab and West Palm all use the Houston Astros primary logo; share one upload between them. */
window.CBT_SHARED_LOGOS = { fcl: "astros", rehab: "astros", "west-palm": "astros" };
