"use client";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  Leaf,
  MapPin,
  Minus,
  Plus,
  Star,
  TrainFront,
  UtensilsCrossed,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, PACK_NOTE, type Product } from "@/lib/rydegrub";
import { useRyde } from "./ryde-store";
export function FoodImage({
  product,
  className = "",
}: {
  product: Product;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className={`food-fallback ${className}`}>
      <UtensilsCrossed />
      <span>{product.name}</span>
    </div>
  ) : (
    <img
      className={className}
      src={product.image}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
export function Stepper({
  value,
  onChange,
  label = "Quantity",
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  return (
    <div className="stepper">
      <button
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(value - 1)}
        disabled={value === 0}
      >
        <Minus size={15} />
      </button>
      <span aria-live="polite">{value}</span>
      <button
        aria-label={`Increase ${label}`}
        onClick={() => onChange(value + 1)}
        disabled={value >= 99}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
export function FoodCard({
  product,
  onOpen,
}: {
  product: Product;
  onOpen: (p: Product) => void;
}) {
  const { state, quantity, notify, ready } = useRyde();
  const n = state.cart[product.id] || 0;
  return (
    <article className="food-card">
      <button
        className="food-photo"
        onClick={() => onOpen(product)}
        aria-label={`View ${product.name}`}
      >
        <FoodImage product={product} />
        {product.id === "thali" && (
          <span className="photo-label">PASSENGER FAVOURITE</span>
        )}
        <span className="rating" title="Illustrative sample rating">
          <Star size={12} fill="currentColor" />
          {product.rating}
          <span>sample</span>
        </span>
      </button>
      <div className="food-card-body">
        <div className="food-title">
          <span
            className={`diet-dot ${product.veg ? "" : "nonveg"}`}
            aria-label={product.veg ? "Vegetarian" : "Non-vegetarian"}
          >
            <i />
          </span>
          <button onClick={() => onOpen(product)}>{product.name}</button>
        </div>
        {product.age && (
          <span className="age-pill">Age {product.age}</span>
        )}
        <p>{product.description}</p>
        {product.packaged && <small className="pack-note">{PACK_NOTE}</small>}
        <div className="food-card-bottom">
          <strong>{money(product.price)}</strong>
          {n ? (
            <Stepper
              value={n}
              onChange={(v) => quantity(product.id, v)}
              label={product.name}
            />
          ) : (
            <button
              className="add-button"
              disabled={!ready}
              aria-label={`Add ${product.name} to cart`}
              onClick={() => {
                quantity(product.id, 1);
                notify(`${product.name} added to your cart`);
              }}
            >
              Add <Plus size={15} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
export function ProductDetails({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const [count, setCount] = useState(1);
  const { state, quantity, notify } = useRyde();
  return (
    <Dialog
      open={!!product}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setCount(1);
        }
      }}
    >
      <DialogContent className="product-dialog">
        {product && (
          <>
            <FoodImage product={product} className="detail-image" />
            <DialogHeader>
              <span className="eyebrow">
                {product.veg ? "VEGETARIAN" : "NON-VEGETARIAN"} ·{" "}
                {product.packaged ? "SEALED PACK" : "FRESHLY PREPARED"}
                {product.age && ` · AGE ${product.age.toUpperCase()}`}
              </span>
              <DialogTitle>{product.name}</DialogTitle>
              <DialogDescription>{product.description}</DialogDescription>
              {product.packaged && <p className="pack-note">{PACK_NOTE}</p>}
            </DialogHeader>
            <div className="detail-meta">
              <span>
                <strong>{product.calories} kcal</strong>Approx. sample calories
              </span>
              <span>
                <strong>{product.protein}g protein</strong>Approx. sample
                nutrition
              </span>
              <span>
                <strong>{money(product.price)}</strong>Per serving
              </span>
            </div>
            <div>
              <h3>What goes into it</h3>
              <p className="muted">{product.ingredients}</p>
              <p className="allergens">Allergens: {product.allergens}</p>
            </div>
            <div className="detail-actions">
              <Stepper
                value={count}
                onChange={(n) => setCount(Math.max(1, n))}
              />
              <button
                className="primary"
                onClick={() => {
                  quantity(product.id, (state.cart[product.id] || 0) + count);
                  notify(`${product.name} added to your cart`);
                  onClose();
                  setCount(1);
                }}
              >
                Add to cart — {money(product.price * count)} <Plus size={16} />
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function JourneyTicket() {
  const { state } = useRyde();
  return (
    <section className="journey-ticket">
      <div className="ticket-heading">
        <span className="ticket-icon">
          <TrainFront size={20} />
        </span>
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h3>Your journey, sorted.</h3>
        </div>
        <span className="sample-tag">
          {state.selected ? "Demo active" : "Sample journey"}
        </span>
      </div>
      <div className="train-name">
        <span>12952</span>
        <strong>Mumbai Rajdhani Express</strong>
      </div>
      <div className="ticket-route">
        <div>
          <small>FROM</small>
          <h4>New Delhi</h4>
          <span>NDLS</span>
        </div>
        <div className="route-line">
          <i />
          <span />
          <TrainFront size={18} />
          <span />
          <i />
        </div>
        <div>
          <small>TO</small>
          <h4>Mumbai Central</h4>
          <span>MMCT</span>
        </div>
      </div>
      <div className="ticket-seats">
        <span>
          COACH <strong>B4</strong>
        </span>
        <span>
          SEAT <strong>32</strong>
        </span>
        <span className="cyan">
          <Check size={13} /> Seat delivery
        </span>
      </div>
      <div className="ticket-station">
        <MapPin size={20} />
        <div>
          <small>NEXT DELIVERY STATION</small>
          <strong>
            Kota Junction <span>· KOTA</span>
          </strong>
        </div>
        <div className="station-time">
          <strong>19:40</strong>
          <small>Sample arrival</small>
        </div>
      </div>
      <div className="ticket-foot">
        <span>
          <Clock3 size={13} /> Sample ETA: 45 min
        </span>
        <span>Fictional journey · Demo only</span>
      </div>
    </section>
  );
}
export function EmptyState({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <UtensilsCrossed size={32} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="primary" onClick={onAction}>
        {action}
        <ArrowRight size={17} />
      </button>
    </div>
  );
}
