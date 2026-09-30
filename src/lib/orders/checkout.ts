export const deliveryFields = [
  { name: "recipient_name", label: "Recipient name", max: 120, min: 1, autoComplete: "name" },
  { name: "phone", label: "Phone", max: 40, min: 3, autoComplete: "tel" },
  { name: "address_line1", label: "Address line 1", max: 200, min: 1, autoComplete: "address-line1" },
  { name: "address_line2", label: "Address line 2 (optional)", max: 200, min: 0, autoComplete: "address-line2" },
  { name: "city", label: "City", max: 100, min: 1, autoComplete: "address-level2" },
  { name: "region", label: "Region / state", max: 100, min: 1, autoComplete: "address-level1" },
  { name: "postal_code", label: "Postal code (optional)", max: 30, min: 0, autoComplete: "postal-code" },
  { name: "country", label: "Country code (two letters, e.g. ZW)", max: 2, min: 2, autoComplete: "country" },
] as const;

export function parseDelivery(form: FormData): Record<string, string> {
  const delivery: Record<string, string> = {};
  for (const field of deliveryFields) {
    const raw = form.get(field.name);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length < field.min || value.length > field.max) throw new Error(`Check ${field.label.toLowerCase()}.`);
    delivery[field.name] = value;
  }
  delivery.country = delivery.country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(delivery.country)) throw new Error("Enter a two-letter country code, such as ZW.");
  const method = form.get("delivery_method");
  if (method !== "standard" && method !== "express") throw new Error("Choose standard or express delivery.");
  delivery.delivery_method = method;
  return delivery;
}

export function canBuy(availability: string, review: string): boolean {
  return availability === "available" && review === "approved";
}

export function money(minor: number | string, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(minor) / 100);
}

export function orderPage(value?: string): number {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page >= 1 && page <= 2000 ? page : 1;
}
