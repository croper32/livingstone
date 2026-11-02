// Visitor copy. Every fact carries its source (Iron Rule). D = SOURCE-DOSSIER.md section; P = W2-PLAN.md synthesis row.
// Arrangement titles/subs are the engine's own taglines split at the first comma/colon (listing.json staging.<group>.arrangements[].tagline).
export const LISTING_URL = 'https://www.martels.ca/listings/default/8/1165725694/74/'; // src: D §1 (live URL of the saved listing page)
export const PHONE = '613-742-5057';                                                    // src: D §1 ("Text me directly at 613-742-5057")
export const STOPS = [
  { group: 'living-dining', t: 14.5, frame: 435, view: '08', thumbView: '05', level: 'main',
    title: 'The living and dining rooms.', ask: 'How will you gather?',
    body: 'Living room 15′0″ × 11′5″, dining room 15′4″ × 12′11″, with the kitchen open beside them.', // src: D §2 plan table; listing.json portal m-dining-kitchen (open_plan_seam, photos 09, 12)
    arr: { gather: ['Sofa by the fire', 'and a table for six'], unwind: ['Reading chairs by the window', 'a round table for four'], everyday: ['A sectional for the family', 'a bench at the table'] } },
  { group: 'bedroom-main', t: 55.5, frame: 1663, view: '13', level: 'main',
    title: 'A bedroom tucked away on the main floor.', ask: 'Who is it for?',
    body: 'The listing suggests it for a nanny, in-laws or an office: it has a separate entrance, and its own bathroom on the same floor. 14′4″ × 11′7″.', // src: D §1 description; D §2 plan (main BATH; dims BEDRM main)
    arr: { gather: ['Queen bed', 'between two nightstands'], unwind: ['King bed', 'and a reading chair'], everyday: ['Bed and desk', 'with open shelves'] } },
  { group: 'family', t: 73.8, frame: 2212, view: '25', level: 'lower',
    title: '23′7″ by 15′5″: the largest size printed on the plan.', ask: 'What will happen down here?',
    body: 'The lower-level family room, “modernized with lots of pot lights”. Each choice also sets up the workout room beyond it.', // src: P S1 (plan table FAMRM vs LIVRM); D §1 quote; listing.json staging.family.rooms = [family, workout]
    arr: { gather: ['Sofa and lounge chairs', 'a TV lounge beyond'], unwind: ['Chairs round an ottoman', 'a game table beyond'], everyday: ['A sectional and a desk', 'a play corner beyond'] } },
  { group: 'bedroom-front', t: 143.2, frame: 4292, view: '21', level: 'upper',
    title: 'Upstairs, four more bedrooms. This is the front one.', ask: 'Who sleeps here?',
    body: 'The second floor has four bedrooms with generous closet space, in the listing’s words.', // src: D §1 ("Second floor: 4 spacious bedrooms with generous closet space")
    arr: { gather: ['Twin beds', 'for two guests'], unwind: ['King bed', 'a bench at its foot'], everyday: ['Bed and desk', 'with open shelves'] } },
  { group: 'bedroom-rear', t: 153.4, frame: 4597, view: '20', level: 'upper',
    title: 'The rear bedroom.', ask: 'A bedroom, or a place to read?',
    body: 'One of the four upstairs. Every floor where someone sleeps has its own bathroom; the lower level has none.', // src: P S2 (plan sheet: 4 baths on main + upper)
    arr: { gather: ['Queen bed', 'nightstands and a chair'], unwind: ['Daybed and books', 'a table by the window'], everyday: ['Bed and desk', 'with open shelves'] } },
  { group: 'office', t: 178.8, frame: 5359, view: '22', level: 'upper', pos: 84,
    title: 'The red room upstairs.', ask: 'What will it be?',
    body: 'Used as an office in the listing photos. The red walls, the window and the carpet stay; only the furniture is virtual.', // src: D §2 ("one used as an office"); STAGING-REPORT S2 landmark gate (walls, windows, floors preserved)
    arr: { gather: ['Guest room', 'queen bed and dresser'], unwind: ['Reading room', 'a daybed and a small round desk'], everyday: ['Home office', 'a sofa and a desk'] } },
  { group: 'primary', t: 187.5, frame: 5619, view: '15', level: 'upper',
    title: 'The primary bedroom, with its own ensuite.', ask: 'How do you want to wake up?',
    body: '16′4″ × 12′2″, with a large ensuite bathroom and a walk-in.', // src: D §2 plan table (primary), D §1 ("a large ensuite bathroom"), D §2 rooms (walk-in)
    arr: { gather: ['Queen bed', 'with a dresser'], unwind: ['King bed', 'and a reading chair'], everyday: ['Bed and desk', 'with open shelves'] } },
];
export const ROOM_NAMES = { living: 'Living room', dining: 'Dining room', kitchen: 'Kitchen', foyer: 'Foyer', entry: 'Entry', hall_main: 'Hall', bath_main: 'Bathroom',
  bedroom_main: 'Main-floor bedroom', family: 'Family room', workout: 'Workout room', laundry: 'Laundry', utility: 'Furnace / utility', workshop: 'Workshop',
  hall_upper: 'Upper hall', bedroom_front: 'Front bedroom', bedroom_rear: 'Rear bedroom', bath_upper: 'Bathroom', wc_upper: 'Powder room',
  office: 'Bedroom / office', primary: 'Primary bedroom', ensuite: 'Ensuite' }; // names from listing.json rooms (plan labels)
export const GROUP_SHORT = { 'living-dining': 'Living & dining', 'bedroom-main': 'Main-floor bedroom', family: 'Family room', 'bedroom-front': 'Front bedroom', 'bedroom-rear': 'Rear bedroom', office: 'The red room', primary: 'Primary bedroom' };
