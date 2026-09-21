// A photograph per KIND of dish, for the meals the app builds itself.
//
// The owner, 21 Sep 2026: real recipes carry a photo and the app's own meals
// carried an emoji, and the list looked unfinished beside them. There is no
// photo of an app-built meal (it is composed from parts), so each is shown
// with a photo of its dish type: every overnight-oats breakfast shares the
// overnight-oats photo. Keyed by `GeneratedMeal.pic`, the component the dish
// is built around. Anything without a photo here keeps its emoji.
//
// Photos: Unsplash, under the Unsplash License (free for commercial use, no
// permission needed). 240px crops, bundled so a list never waits on the
// network. Source ids are in docs/MEAL-PHOTOS.md.
import type { ImageSourcePropType } from 'react-native';

const PHOTOS: Record<string, ImageSourcePropType> = {
  'seitan': require('../../assets/meals/seitan.jpg'),
  'tempeh': require('../../assets/meals/tempeh.jpg'),
  'tofu': require('../../assets/meals/tofu.jpg'),
  'grilled chicken': require('../../assets/meals/grilled-chicken.jpg'),
  'rice cakes': require('../../assets/meals/rice-cakes.jpg'),
  'nut-butter toast': require('../../assets/meals/nut-butter-toast.jpg'),
  'protein bar': require('../../assets/meals/protein-bar.jpg'),
  'chia pudding': require('../../assets/meals/chia-pudding.jpg'),
  'eggs': require('../../assets/meals/eggs.jpg'),
  'omelette': require('../../assets/meals/omelette.jpg'),
  'shakshuka': require('../../assets/meals/shakshuka.jpg'),
  'tofu scramble': require('../../assets/meals/tofu-scramble.jpg'),
  'salmon': require('../../assets/meals/salmon.jpg'),
  'tuna pot': require('../../assets/meals/tuna-pot.jpg'),
  'white fish': require('../../assets/meals/white-fish.jpg'),
  'avocado': require('../../assets/meals/avocado.jpg'),
  'avocado & eggs': require('../../assets/meals/avocado-eggs.jpg'),
  'boiled eggs': require('../../assets/meals/boiled-eggs.jpg'),
  'mixed-nut pot': require('../../assets/meals/mixed-nut-pot.jpg'),
  'protein pancakes': require('../../assets/meals/protein-pancakes.jpg'),
  'Greek yogurt': require('../../assets/meals/greek-yogurt.jpg'),
  'Greek yogurt bowl': require('../../assets/meals/greek-yogurt-bowl.jpg'),
  'cottage cheese bowl': require('../../assets/meals/cottage-cheese-bowl.jpg'),
  'oats': require('../../assets/meals/oats.jpg'),
  'overnight oats': require('../../assets/meals/overnight-oats.jpg'),
  'pea-protein shake': require('../../assets/meals/pea-protein-shake.jpg'),
  'protein shake': require('../../assets/meals/protein-shake.jpg'),
  'smoothie': require('../../assets/meals/smoothie.jpg'),
  'beef jerky': require('../../assets/meals/beef-jerky.jpg'),
  'lean beef': require('../../assets/meals/lean-beef.jpg'),
  'salami slices': require('../../assets/meals/salami-slices.jpg'),
  'oatcakes': require('../../assets/meals/oatcakes.jpg'),
  'turkey': require('../../assets/meals/turkey.jpg'),
  'prawns': require('../../assets/meals/prawns.jpg'),
  'cheese': require('../../assets/meals/cheese.jpg'),
  'cottage cheese': require('../../assets/meals/cottage-cheese.jpg'),
  'halloumi': require('../../assets/meals/halloumi.jpg'),
  'paneer': require('../../assets/meals/paneer.jpg'),
  'olives & cheese': require('../../assets/meals/olives-cheese.jpg'),
  'hummus': require('../../assets/meals/hummus.jpg'),
  'black beans': require('../../assets/meals/black-beans.jpg'),
  'chickpeas': require('../../assets/meals/chickpeas.jpg'),
  'lentils': require('../../assets/meals/lentils.jpg'),
  'edamame': require('../../assets/meals/edamame.jpg'),
};

/** The dish type's photo, or null to keep the emoji. */
export function mealPhoto(pic: string | undefined): ImageSourcePropType | null {
  return pic ? PHOTOS[pic] ?? null : null;
}
