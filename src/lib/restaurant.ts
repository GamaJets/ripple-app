// Eating-out estimator — curated macro estimates for common restaurant dishes by
// cuisine, with portion scaling. Pure + deterministic so it unit-tests and works
// fully over-the-air (no backend). Estimates are typical restaurant servings;
// the user can adjust before logging. Not a substitute for a label when one exists.

export interface Dish { id: string; name: string; cuisine: string; kcal: number; protein: number; carbs: number; fat: number; note?: string }

export const CUISINES = ['American', 'Italian', 'Mexican', 'Chinese', 'Japanese', 'Indian', 'Thai', 'Mediterranean', 'Cafe', 'Fast food'] as const;

// Per typical restaurant serving. Values are round, honest ballparks.
export const DISHES: Dish[] = [
  // American
  { id: 'burger', name: 'Cheeseburger', cuisine: 'American', kcal: 750, protein: 40, carbs: 45, fat: 45 },
  { id: 'ribeye', name: 'Ribeye steak (10oz)', cuisine: 'American', kcal: 820, protein: 62, carbs: 2, fat: 62 },
  { id: 'caesar-chx', name: 'Chicken Caesar salad', cuisine: 'American', kcal: 560, protein: 42, carbs: 18, fat: 36 },
  { id: 'wings', name: 'Buffalo wings (10)', cuisine: 'American', kcal: 700, protein: 55, carbs: 8, fat: 48 },
  { id: 'bbq-ribs', name: 'BBQ pork ribs (half rack)', cuisine: 'American', kcal: 900, protein: 55, carbs: 30, fat: 60 },
  // Italian
  { id: 'carbonara', name: 'Spaghetti carbonara', cuisine: 'Italian', kcal: 820, protein: 30, carbs: 90, fat: 38 },
  { id: 'margherita', name: 'Margherita pizza (whole 12")', cuisine: 'Italian', kcal: 1000, protein: 40, carbs: 120, fat: 38 },
  { id: 'lasagna', name: 'Beef lasagna', cuisine: 'Italian', kcal: 720, protein: 38, carbs: 55, fat: 38 },
  { id: 'chx-parm', name: 'Chicken parmigiana', cuisine: 'Italian', kcal: 880, protein: 58, carbs: 60, fat: 44 },
  // Mexican
  { id: 'burrito', name: 'Chicken burrito', cuisine: 'Mexican', kcal: 780, protein: 44, carbs: 88, fat: 26 },
  { id: 'tacos', name: 'Beef tacos (3)', cuisine: 'Mexican', kcal: 570, protein: 30, carbs: 45, fat: 30 },
  { id: 'quesadilla', name: 'Cheese quesadilla', cuisine: 'Mexican', kcal: 650, protein: 28, carbs: 48, fat: 38 },
  { id: 'bowl', name: 'Chicken burrito bowl', cuisine: 'Mexican', kcal: 620, protein: 45, carbs: 62, fat: 20 },
  // Chinese
  { id: 'fried-rice', name: 'Chicken fried rice', cuisine: 'Chinese', kcal: 760, protein: 30, carbs: 95, fat: 28 },
  { id: 'orange-chx', name: 'Orange chicken', cuisine: 'Chinese', kcal: 800, protein: 32, carbs: 78, fat: 40 },
  { id: 'lo-mein', name: 'Beef lo mein', cuisine: 'Chinese', kcal: 720, protein: 30, carbs: 90, fat: 26 },
  { id: 'dumplings', name: 'Pork dumplings (8)', cuisine: 'Chinese', kcal: 500, protein: 22, carbs: 52, fat: 22 },
  // Japanese
  { id: 'sushi-roll', name: 'Sushi (8-piece roll)', cuisine: 'Japanese', kcal: 350, protein: 14, carbs: 55, fat: 8 },
  { id: 'ramen', name: 'Tonkotsu ramen', cuisine: 'Japanese', kcal: 650, protein: 30, carbs: 70, fat: 26 },
  { id: 'chx-teriyaki', name: 'Chicken teriyaki + rice', cuisine: 'Japanese', kcal: 680, protein: 45, carbs: 80, fat: 16 },
  { id: 'katsu', name: 'Pork katsu curry', cuisine: 'Japanese', kcal: 900, protein: 40, carbs: 100, fat: 38 },
  // Indian
  { id: 'tikka', name: 'Chicken tikka masala + rice', cuisine: 'Indian', kcal: 850, protein: 45, carbs: 85, fat: 36 },
  { id: 'butter-chx', name: 'Butter chicken + naan', cuisine: 'Indian', kcal: 950, protein: 44, carbs: 78, fat: 52 },
  { id: 'dal', name: 'Dal + rice', cuisine: 'Indian', kcal: 560, protein: 20, carbs: 90, fat: 12 },
  { id: 'biryani', name: 'Chicken biryani', cuisine: 'Indian', kcal: 780, protein: 38, carbs: 95, fat: 26 },
  // Thai
  { id: 'pad-thai', name: 'Pad thai', cuisine: 'Thai', kcal: 750, protein: 28, carbs: 90, fat: 30 },
  { id: 'green-curry', name: 'Green curry + rice', cuisine: 'Thai', kcal: 700, protein: 30, carbs: 78, fat: 32 },
  { id: 'basil-chx', name: 'Thai basil chicken + rice', cuisine: 'Thai', kcal: 720, protein: 40, carbs: 80, fat: 26 },
  // Mediterranean
  { id: 'chx-shawarma', name: 'Chicken shawarma wrap', cuisine: 'Mediterranean', kcal: 620, protein: 40, carbs: 55, fat: 26 },
  { id: 'falafel', name: 'Falafel bowl', cuisine: 'Mediterranean', kcal: 580, protein: 20, carbs: 68, fat: 26 },
  { id: 'gyro', name: 'Lamb gyro plate', cuisine: 'Mediterranean', kcal: 780, protein: 42, carbs: 60, fat: 40 },
  { id: 'greek-salad', name: 'Greek salad + chicken', cuisine: 'Mediterranean', kcal: 480, protein: 38, carbs: 18, fat: 28 },
  // Cafe
  { id: 'latte', name: 'Latte (16oz, whole milk)', cuisine: 'Cafe', kcal: 220, protein: 12, carbs: 20, fat: 11 },
  { id: 'croissant', name: 'Butter croissant', cuisine: 'Cafe', kcal: 340, protein: 7, carbs: 38, fat: 18 },
  { id: 'avo-toast', name: 'Avocado toast', cuisine: 'Cafe', kcal: 450, protein: 14, carbs: 42, fat: 26 },
  { id: 'bagel-cc', name: 'Bagel + cream cheese', cuisine: 'Cafe', kcal: 460, protein: 15, carbs: 66, fat: 15 },
  // Fast food
  { id: 'ff-fries', name: 'Fries (large)', cuisine: 'Fast food', kcal: 490, protein: 6, carbs: 66, fat: 23 },
  { id: 'ff-nuggets', name: 'Chicken nuggets (10)', cuisine: 'Fast food', kcal: 470, protein: 26, carbs: 28, fat: 30 },
  { id: 'ff-chx-sand', name: 'Crispy chicken sandwich', cuisine: 'Fast food', kcal: 620, protein: 30, carbs: 52, fat: 32 },
  { id: 'ff-shake', name: 'Milkshake (medium)', cuisine: 'Fast food', kcal: 620, protein: 14, carbs: 96, fat: 20 },
];

export const PORTIONS: { id: string; label: string; mult: number }[] = [
  { id: 'half', label: 'Half', mult: 0.5 },
  { id: 'full', label: 'Full', mult: 1 },
  { id: 'oneandhalf', label: '1.5×', mult: 1.5 },
  { id: 'double', label: 'Double', mult: 2 },
];

export interface DishEstimate { name: string; kcal: number; protein: number; carbs: number; fat: number }

/** Scale a dish by a portion multiplier, rounding to whole numbers. */
export function estimateDish(dish: Dish, mult: number = 1): DishEstimate {
  const m = mult > 0 ? mult : 1;
  const label = m === 1 ? dish.name : `${dish.name} (${m === 0.5 ? 'half' : m + '×'})`;
  return {
    name: label,
    kcal: Math.round(dish.kcal * m),
    protein: Math.round(dish.protein * m),
    carbs: Math.round(dish.carbs * m),
    fat: Math.round(dish.fat * m),
  };
}

/** Case-insensitive search over dish name + cuisine. */
export function searchDishes(query: string, limit = 40): Dish[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return DISHES.slice(0, limit);
  return DISHES.filter((d) => d.name.toLowerCase().includes(q) || d.cuisine.toLowerCase().includes(q)).slice(0, limit);
}
