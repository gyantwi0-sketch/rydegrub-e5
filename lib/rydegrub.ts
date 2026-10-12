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
};
export const categories = [
  "All",
  "Thalis",
  "Biryani",
  "Breakfast",
  "Light Meals",
  "Snacks",
  "Beverages",
];
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
