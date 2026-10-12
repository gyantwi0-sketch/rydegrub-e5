"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Coffee,
  Home,
  Leaf,
  MapPin,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  TrainFront,
  UserRound,
  UtensilsCrossed,
  Check,
  CircleHelp,
  Soup,
  Sandwich,
  Wheat,
  CookingPot,
  Baby,
  Apple,
  LogIn,
} from "lucide-react";
import { SignInPage, SignUpPage } from "./auth-forms";
import {
  categories,
  products,
  totals,
  money,
  type Product,
} from "@/lib/rydegrub";
import { cn } from "@/lib/utils";
import { RydeProvider, useRyde } from "./ryde-store";
import { FoodCard, JourneyTicket, ProductDetails } from "./food-components";
import {
  CartPage,
  CheckoutPage,
  OrdersPage,
  ProfilePage,
  DemoTrackingPage,
} from "./ryde-flows";
import { TrackingPage } from "./secure-tracking";
export type PageName =
  | "home"
  | "menu"
  | "cart"
  | "checkout"
  | "tracking"
  | "demo-tracking"
  | "orders"
  | "profile"
  | "signin"
  | "signup";
const navigation = [
  { id: "home", label: "Home", icon: Home },
  { id: "menu", label: "Menu", icon: UtensilsCrossed },
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "profile", label: "Profile", icon: UserRound },
] as const;
const categoryIcons = [
  UtensilsCrossed,
  CookingPot,
  Soup,
  Wheat,
  Leaf,
  Sandwich,
  Coffee,
  Baby,
  Apple,
];
function App() {
  const { state, ready, notice } = useRyde();
  const [page, setPage] = useState<PageName>("home");
  const [orderId, setOrderId] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [category, setCategory] = useState("All");
  useEffect(() => {
    const sync = () => {
      const [p, id] = location.hash.slice(1).split("/");
      if (
        [
          "home",
          "menu",
          "cart",
          "checkout",
          "tracking",
          "demo-tracking",
          "orders",
          "profile",
          "signin",
          "signup",
        ].includes(p)
      ) {
        setPage(p as PageName);
        setOrderId(id || "");
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const navigate = (p: PageName, id = "") => {
    setPage(p);
    setOrderId(id);
    location.hash = p + (id ? "/" + id : "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const count = Object.values(state.cart).reduce((a, b) => a + b, 0);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => navigate("home")}
            aria-label="RydeGrub home"
          >
            <span className="brand-mark">
              <TrainFront size={24} />
            </span>
            <span>
              Ryde<span className="orange">Grub</span>
              <small>GOOD FOOD. ON TRACK.</small>
            </span>
          </button>
          <nav className="desktop-nav" aria-label="Main navigation">
            {navigation.map((n) => (
              <button
                key={n.id}
                className={cn(page === n.id && "active")}
                onClick={() => navigate(n.id)}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            <span className="demo-badge">
              <i />
              Demo mode
            </span>
            <button
              className={cn(
                "header-signin",
                ["signin", "signup"].includes(page) && "active",
              )}
              onClick={() => navigate("signin")}
              aria-label="Sign in"
            >
              <LogIn size={17} />
              <span>Sign in</span>
            </button>
            <button
              className="header-cart"
              onClick={() => navigate("cart")}
              aria-label={`Cart with ${count} items`}
            >
              <ShoppingCart size={18} />
              <span>Cart</span>
              <b>{count}</b>
            </button>
          </div>
        </div>
      </header>
      <main className="app-main">
        {page === "home" && (
          <HomePage
            onOpen={setProduct}
            browse={(c = "All") => {
              setCategory(c);
              navigate("menu");
            }}
          />
        )}
        {page === "menu" && (
          <MenuPage
            onOpen={setProduct}
            category={category}
            setCategory={setCategory}
          />
        )}
        {page === "cart" && <CartPage navigate={navigate} />}
        {page === "checkout" && <CheckoutPage navigate={navigate} />}
        {page === "tracking" && (
          <TrackingPage key={orderId} id={orderId} navigate={navigate} />
        )}
        {page === "demo-tracking" && (
          <DemoTrackingPage id={orderId} navigate={navigate} />
        )}
        {page === "orders" && <OrdersPage navigate={navigate} />}
        {page === "profile" && <ProfilePage />}
        {page === "signin" && <SignInPage navigate={navigate} />}
        {page === "signup" && <SignUpPage navigate={navigate} />}
      </main>
      <footer className="site-footer">
        <span>
          <TrainFront size={15} /> A little comfort. A lot of miles.
        </span>
        <span>RydeGrub frontend demo · No real orders or payments</span>
        <span>Made for the journey.</span>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((n) => (
          <button
            key={n.id}
            className={cn(page === n.id && "active")}
            onClick={() => navigate(n.id)}
          >
            <n.icon size={20} />
            {n.label}
          </button>
        ))}
      </nav>
      {count > 0 && !["cart", "checkout", "signin", "signup"].includes(page) && (
        <button className="floating-cart" onClick={() => navigate("cart")}>
          <span>
            <ShoppingBag size={19} />
            {count} {count === 1 ? "item" : "items"} ·{" "}
            {money(totals(state.cart).total)}
          </span>
          <span>
            View cart <ArrowRight size={17} />
          </span>
        </button>
      )}
      {notice && (
        <div role="status" className="toast">
          <Check size={18} />
          {notice}
        </div>
      )}
      <ProductDetails product={product} onClose={() => setProduct(null)} />
      {!ready && <span className="sr-only">Loading saved demo data</span>}
    </>
  );
}
export default function RydeApp() {
  return (
    <RydeProvider>
      <App />
    </RydeProvider>
  );
}
function HomePage({
  onOpen,
  browse,
}: {
  onOpen: (p: Product) => void;
  browse: (c?: string) => void;
}) {
  const { state, setState, notify } = useRyde();
  const [pnr, setPnr] = useState("");
  const [error, setError] = useState("");
  const activate = (value: string) => {
    if (!/^\d{10}$/.test(value)) {
      setError("Please enter a valid 10-digit PNR.");
      return;
    }
    if (value !== "1234567890") {
      setError("Use the sample PNR to explore this demo.");
      return;
    }
    setError("");
    setState((s) => ({ ...s, selected: true }));
    notify("Demo journey selected. Your next stop: good food.");
  };
  const picks = products
    .filter((p) => !["Toddler Food", "Fruits"].includes(p.category))
    .filter((p) =>
      state.profile.preferences.length
        ? state.profile.preferences.every((t) => p.tags.includes(t))
        : ["paneer", "khichdi", "idli"].includes(p.id),
    )
    .slice(0, 3);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow">
            <span />
            THE BEST PART OF YOUR NEXT STOP
          </div>
          <h1>
            Good food.
            <br />
            <span>Great journeys.</span>
          </h1>
          <p className="hero-subtitle">
            Ghar jaisa khana, delivered to your train seat.
          </p>
          <form
            className="pnr-form"
            onSubmit={(e) => {
              e.preventDefault();
              activate(pnr);
            }}
          >
            <label htmlFor="pnr">Let&apos;s find your journey</label>
            <div className="pnr-input">
              <TrainFront size={20} />
              <input
                id="pnr"
                placeholder="Enter your 10-digit PNR"
                value={pnr}
                onChange={(e) => setPnr(e.target.value)}
                inputMode="numeric"
                maxLength={10}
                aria-invalid={!!error}
                aria-describedby="pnr-message"
              />
              <button className="primary" type="submit">
                Find my journey <ArrowRight size={16} />
              </button>
            </div>
            {error ? (
              <p className="error" id="pnr-message">
                {error}
              </p>
            ) : (
              <p className="pnr-hint" id="pnr-message">
                <ShieldCheck size={13} /> Just your PNR. We&apos;ll take care of
                the rest.
              </p>
            )}
            <div className="demo-pnr">
              <span>Just looking around?</span>
              <button
                type="button"
                onClick={() => {
                  setPnr("1234567890");
                  activate("1234567890");
                }}
              >
                {state.selected ? "Demo journey selected" : "Try demo PNR"}{" "}
                <ArrowRight size={13} />
              </button>
            </div>
          </form>
          <div className="hero-benefits">
            <span>
              <Leaf />
              Freshly prepared
            </span>
            <span>
              <ShieldCheck />
              Hygienically packed
            </span>
            <span>
              <MapPin />
              Right at your seat
            </span>
          </div>
        </div>
        <div className="hero-ticket-wrap">
          <div className="scenic-label">
            <span /> EVERY MILE, A LITTLE MORE DELICIOUS.
          </div>
          <JourneyTicket />
        </div>
      </section>
      <section className="category-section">
        <div className="section-heading">
          <h2>What are you craving?</h2>
          <span>Something for every kind of journey.</span>
        </div>
        <div className="category-list">
          {categories.map((c, i) => {
            const Icon = categoryIcons[i];
            return (
              <button
                key={c}
                className={cn("category-chip", c === "All" && "selected")}
                onClick={() => browse(c)}
              >
                <Icon size={20} />
                {c === "All" ? "All meals" : c}
              </button>
            );
          })}
        </div>
      </section>
      <section className="recommended">
        <div className="section-heading">
          <div>
            <div className="eyebrow orange">FRESH PICKS, HAPPY TRIPS</div>
            <h2>Next stop: delicious.</h2>
            <p>Passenger favourites that make the miles taste better.</p>
          </div>
          <button className="text-link" onClick={() => browse()}>
            Explore full menu <ArrowRight size={16} />
          </button>
        </div>
        <div className="food-grid">
          {[products[0], products[4], products[5], products[2]].map((p) => (
            <FoodCard key={p.id} product={p} onOpen={onOpen} />
          ))}
        </div>
        <div className="rating-note">
          <CircleHelp size={12} /> Ratings are illustrative sample data. Food
          images are representative.
        </div>
      </section>
      <section className="personalized">
        <div className="personalized-copy">
          <span className="personal-icon">
            <Sparkles size={23} />
          </span>
          <div className="eyebrow cyan">A LITTLE MORE YOU</div>
          <h2>
            Your journey.
            <br />
            Your kind of meal.
          </h2>
          <p>
            Comfort food, lighter bites, or a little extra protein. Find a pick
            that feels like you.
          </p>
          <span className="ai-label">
            <Sparkles size={12} /> AI-style picks · demo recommendations
          </span>
        </div>
        <div className="personalized-picks">
          {picks.length ? (
            picks.map((p) => (
              <button
                key={p.id}
                onClick={() => onOpen(p)}
                className="mini-food"
              >
                <img
                  src={p.image}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <div>
                  <span>
                    {p.tags.includes("High-protein")
                      ? "PROTEIN-PACKED"
                      : "LIGHT & COMFORTING"}
                  </span>
                  <h3>{p.name}</h3>
                  <p>
                    {money(p.price)} <span>· {p.protein}g sample protein</span>
                  </p>
                </div>
                <ArrowRight size={18} />
              </button>
            ))
          ) : (
            <p>No exact matches. Try adjusting your preferences in Profile.</p>
          )}
        </div>
      </section>
    </>
  );
}
function MenuPage({
  onOpen,
  category,
  setCategory,
}: {
  onOpen: (p: Product) => void;
  category: string;
  setCategory: (c: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [veg, setVeg] = useState(false);
  const [sort, setSort] = useState("recommended");
  const filtered = products
    .filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!veg || p.veg) &&
        p.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "low"
        ? a.price - b.price
        : sort === "high"
          ? b.price - a.price
          : 0,
    );
  const clear = () => {
    setSearch("");
    setVeg(false);
    setSort("recommended");
    setCategory("All");
  };
  return (
    <section className="page-section">
      <div className="eyebrow orange">A GOOD JOURNEY STARTS WITH GOOD FOOD</div>
      <div className="section-heading">
        <div>
          <h1>The onboard menu.</h1>
          <p>Made with care. Delivered to your seat.</p>
        </div>
        <span className="subtle-pill">{products.length} freshly picked favourites</span>
      </div>
      <div className="menu-controls">
        <label className="search-box">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for your comfort food..."
            aria-label="Search food by name"
          />
        </label>
        <label className="veg-toggle">
          <input
            type="checkbox"
            checked={veg}
            onChange={(e) => setVeg(e.target.checked)}
          />
          <Leaf size={16} />
          Veg only
        </label>
        <label className="sort-select">
          <SlidersHorizontal size={16} />
          <select
            aria-label="Sort by price"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recommended">Recommended</option>
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
          </select>
        </label>
      </div>
      <div className="category-list">
        {categories.map((c) => (
          <button
            className={cn("category-chip", category === c && "selected")}
            key={c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="results-heading">
        <span>
          {filtered.length} delicious{" "}
          {filtered.length === 1 ? "option" : "options"}
        </span>
        <button className="text-link" onClick={clear}>
          Clear filters
        </button>
      </div>
      {filtered.length ? (
        <div className="food-grid">
          {filtered.map((p) => (
            <FoodCard product={p} onOpen={onOpen} key={p.id} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Search size={32} />
          <h2>No meals found</h2>
          <p>Try a different search or give every craving a chance.</p>
          <button className="primary" onClick={clear}>
            Clear filters
          </button>
        </div>
      )}
      <p className="rating-note">
        All ratings and nutrition values are sample data. Images are
        representative.
      </p>
    </section>
  );
}
