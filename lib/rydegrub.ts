export type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  image: string;
  veg: boolean;
  rating: string;
  ingredients: string;
  allergens: string;
  calories: number;
  protein: number;
  tags: string[];
  age?: string;
  packaged?: boolean;
};
export const PACK_NOTE = "Check pack for age suitability and preparation.";
export const categories = [
  "All",
  "Thalis",
  "Biryani",
  "Breakfast",
  "Light Meals",
  "Snacks",
  "Beverages",
  "Toddler Food",
  "Fruits",
];
const fruit = (
  id: string,
  name: string,
  price: number,
  description: string,
  calories: number,
  protein: number,
): Product => ({
  id,
  name,
  price,
  category: "Fruits",
  description,
  image: `/images/${id}.png`,
  veg: true,
  rating: "4.6",
  ingredients: `Fresh ${name.toLowerCase().replace(/ \(.*\)$/, "")}`,
  allergens: "None known",
  calories,
  protein,
  tags: ["Vegetarian", "Fresh fruit"],
});
export const products: Product[] = [
  {
    id: "thali",
    name: "Homestyle Veg Thali",
    price: 189,
    category: "Thalis",
    description:
      "A little taste of home. Dal, sabzi, fluffy rice, rotis & a sweet finish.",
    image: "/images/thali.png",
    veg: true,
    rating: "4.8",
    ingredients:
      "Rice, wheat rotis, lentils, seasonal vegetables, paneer, spices",
    allergens: "Wheat, milk",
    calories: 650,
    protein: 22,
    tags: ["Vegetarian", "Mild spice", "High-protein"],
  },
  {
    id: "paneer",
    name: "Paneer Rice Bowl",
    price: 219,
    category: "Light Meals",
    description: "Golden paneer, fragrant rice and a whole lot of comfort.",
    image: "/images/paneer.png",
    veg: true,
    rating: "4.7",
    ingredients: "Paneer, basmati rice, tomato, onion, spices",
    allergens: "Milk",
    calories: 520,
    protein: 26,
    tags: ["Vegetarian", "High-protein"],
  },
  {
    id: "rajma",
    name: "Rajma Chawal",
    price: 149,
    category: "Light Meals",
    description:
      "Slow-cooked kidney beans with perfectly steamed basmati rice.",
    image: "/images/rajma.png",
    veg: true,
    rating: "4.8",
    ingredients: "Kidney beans, basmati rice, tomato, onion",
    allergens: "May contain milk",
    calories: 460,
    protein: 18,
    tags: ["Vegetarian", "Mild spice", "High-protein"],
  },
  {
    id: "veg-biryani",
    name: "Veg Dum Biryani",
    price: 179,
    category: "Biryani",
    description:
      "Aromatic basmati, garden vegetables and slow-cooked goodness.",
    image: "/images/veg-biryani.png",
    veg: true,
    rating: "4.6",
    ingredients: "Basmati rice, vegetables, yogurt, saffron, spices",
    allergens: "Milk, tree nuts",
    calories: 480,
    protein: 12,
    tags: ["Vegetarian"],
  },
  {
    id: "chicken",
    name: "Chicken Dum Biryani",
    price: 249,
    category: "Biryani",
    description: "Tender chicken layered with saffron rice and warming spices.",
    image: "/images/chicken.png",
    veg: false,
    rating: "4.9",
    ingredients: "Chicken, basmati rice, yogurt, onion, spices",
    allergens: "Milk",
    calories: 620,
    protein: 34,
    tags: ["High-protein"],
  },
  {
    id: "dosa",
    name: "Masala Dosa",
    price: 129,
    category: "Breakfast",
    description:
      "Crisp golden dosa, spiced potato filling and coconut chutney.",
    image: "/images/dosa.png",
    veg: true,
    rating: "4.7",
    ingredients: "Rice, urad dal, potato, coconut, mustard",
    allergens: "Mustard",
    calories: 380,
    protein: 9,
    tags: ["Vegetarian"],
  },
  {
    id: "idli",
    name: "Idli Sambar",
    price: 99,
    category: "Breakfast",
    description: "Soft steamed idlis with hearty sambar and fresh chutney.",
    image: "/images/idli.png",
    veg: true,
    rating: "4.6",
    ingredients: "Rice, urad dal, lentils, vegetables, coconut",
    allergens: "Mustard",
    calories: 280,
    protein: 10,
    tags: ["Vegetarian", "Mild spice"],
  },
  {
    id: "khichdi",
    name: "Moong Dal Khichdi",
    price: 139,
    category: "Light Meals",
    description:
      "A gentle, nourishing bowl of rice, moong dal and golden ghee.",
    image: "/images/khichdi.png",
    veg: true,
    rating: "4.7",
    ingredients: "Rice, moong dal, ghee, turmeric, cumin",
    allergens: "Milk",
    calories: 340,
    protein: 15,
    tags: ["Vegetarian", "Mild spice"],
  },
  {
    id: "poha",
    name: "Poha",
    price: 89,
    category: "Breakfast",
    description:
      "Light flattened rice with peanuts, lemon and fresh coriander.",
    image: "/images/poha.png",
    veg: true,
    rating: "4.5",
    ingredients: "Flattened rice, peanuts, onion, lemon, turmeric",
    allergens: "Peanuts, mustard",
    calories: 290,
    protein: 7,
    tags: ["Vegetarian", "Mild spice"],
  },
  {
    id: "samosa",
    name: "Samosa Duo",
    price: 59,
    category: "Snacks",
    description: "Two crisp, golden samosas with tangy tamarind chutney.",
    image: "/images/samosa.png",
    veg: true,
    rating: "4.6",
    ingredients: "Wheat flour, potato, peas, spices",
    allergens: "Wheat",
    calories: 320,
    protein: 6,
    tags: ["Vegetarian"],
  },
  {
    id: "chai",
    name: "Masala Chai",
    price: 29,
    category: "Beverages",
    description:
      "Your favourite travel companion. Freshly brewed, warmly spiced.",
    image: "/images/chai.png",
    veg: true,
    rating: "4.8",
    ingredients: "Black tea, milk, ginger, cardamom, sugar",
    allergens: "Milk",
    calories: 90,
    protein: 3,
    tags: ["Vegetarian", "Mild spice"],
  },
  {
    id: "curd",
    name: "Plain Curd",
    price: 39,
    category: "Light Meals",
    description: "Fresh, creamy curd. The perfect cooling side for your meal.",
    image: "/images/curd.png",
    veg: true,
    rating: "4.5",
    ingredients: "Cultured milk",
    allergens: "Milk",
    calories: 80,
    protein: 5,
    tags: ["Vegetarian", "Mild spice"],
  },
  {
    id: "cerelac",
    name: "Nestlé CERELAC Wheat Apple",
    price: 85,
    category: "Toddler Food",
    description: "Sealed single-serve pack. Prepared as per pack instructions.",
    image: "/images/cereal-demo.png",
    veg: true,
    rating: "4.5",
    ingredients: "Packaged infant cereal. See pack for full ingredients.",
    allergens: "Wheat, milk. See pack for details.",
    calories: 105,
    protein: 3,
    tags: ["Vegetarian", "Toddler"],
    age: "6+ months",
    packaged: true,
  },
  {
    id: "porridge",
    name: "Ragi Porridge",
    price: 69,
    category: "Toddler Food",
    description: "Smooth, mildly sweet ragi porridge. No added salt.",
    image: "/images/porridge.png",
    veg: true,
    rating: "4.6",
    ingredients: "Ragi flour, water, jaggery",
    allergens: "None known",
    calories: 120,
    protein: 3,
    tags: ["Vegetarian", "Toddler"],
    age: "8+ months",
  },
  {
    id: "soft-khichdi",
    name: "Soft Moong Khichdi",
    price: 79,
    category: "Toddler Food",
    description: "Well-mashed rice and moong dal. No chilli, light ghee.",
    image: "/images/khichdi.png",
    veg: true,
    rating: "4.7",
    ingredients: "Rice, moong dal, ghee, turmeric",
    allergens: "Milk",
    calories: 140,
    protein: 5,
    tags: ["Vegetarian", "Toddler"],
    age: "8+ months",
  },
  {
    id: "banana-puree",
    name: "Banana Purée",
    price: 59,
    category: "Toddler Food",
    description: "Freshly mashed ripe banana. Nothing added.",
    image: "/images/banana-puree.png",
    veg: true,
    rating: "4.6",
    ingredients: "Ripe banana",
    allergens: "None known",
    calories: 90,
    protein: 1,
    tags: ["Vegetarian", "Toddler"],
    age: "6+ months",
  },
  {
    id: "apple-puree",
    name: "Apple Purée",
    price: 65,
    category: "Toddler Food",
    description: "Steamed, smooth-blended apple. No added sugar.",
    image: "/images/apple-puree.png",
    veg: true,
    rating: "4.5",
    ingredients: "Apple, water",
    allergens: "None known",
    calories: 60,
    protein: 0,
    tags: ["Vegetarian", "Toddler"],
    age: "6+ months",
  },
  fruit("banana", "Banana (2 pcs)", 30, "Ripe, naturally sweet and easy to carry.", 180, 2),
  fruit("apple", "Apple (2 pcs)", 60, "Crisp, juicy apples, washed and ready.", 150, 1),
  fruit("orange", "Orange (2 pcs)", 50, "Juicy, tangy oranges to brighten the ride.", 120, 2),
  fruit("papaya", "Papaya Cubes", 55, "Fresh-cut papaya cubes in a sealed cup.", 90, 1),
  fruit("mango", "Mango Cubes", 79, "Sweet, fresh-cut mango in a sealed cup.", 120, 1),
  fruit("watermelon", "Watermelon Cubes", 49, "Cool, hydrating watermelon cubes.", 70, 1),
];
export const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
export const journey = {
  train: "12952 Mumbai Rajdhani Express",
  from: "New Delhi",
  to: "Mumbai Central",
  coach: "B4",
  seat: "32",
  station: "Kota Junction",
};
export type Cart = Record<string, number>;
export type Profile = { name: string; mobile: string; preferences: string[] };
export type Order = {
  id: string;
  createdAt: number;
  items: { product: Product; quantity: number }[];
  subtotal: number;
  delivery: number;
  total: number;
  journey: typeof journey;
  passenger: {
    name: string;
    mobile: string;
    coach: string;
    seat: string;
    station: string;
    payment: string;
  };
};
export const totals = (cart: Cart) => {
  const subtotal = products.reduce(
    (sum, p) => sum + p.price * (cart[p.id] || 0),
    0,
  );
  const delivery = subtotal === 0 || subtotal >= 399 ? 0 : 20;
  return { subtotal, delivery, total: subtotal + delivery };
};
export const orderStatus = (createdAt: number, now: number) =>
  Math.min(4, Math.max(0, Math.floor((now - createdAt) / 15000)));
export const statuses = [
  "Confirmed",
  "Preparing",
  "Packed",
  "At your coach",
  "Delivered",
];
