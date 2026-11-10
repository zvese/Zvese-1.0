"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deliveryFields, money } from "@/lib/orders/checkout";
import { shippingQuote, type ShippingRate } from "@/lib/orders/commerce";
import { Button } from "@/components/ui/button";

function Submit({ disabled, sandbox }: { disabled: boolean; sandbox: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending || disabled}>{pending ? "Creating order…" : sandbox ? "Create sandbox order" : "Place pending order"}</Button>;
}
export function CheckoutForm({ action, rates, subtotal, currency, sandbox }: {
  action: (form: FormData) => Promise<void>; rates: ShippingRate[]; subtotal: number; currency: string; sandbox: boolean;
}) {
  const [destination, setDestination] = useState({ country: "", city: "", region: "" });
  const [rateId, setRateId] = useState("");
  const available = rates.filter(rate => { try { shippingQuote(rate, destination, subtotal, currency); return true; } catch { return false; } });
  const selected = available.find(rate => rate.id === rateId);
  const quote = selected ? shippingQuote(selected, destination, subtotal, currency) : null;
  return <form action={action} className="space-y-5">
    {deliveryFields.map(field => <label key={field.name} className="block text-sm font-medium">{field.label}
      <input name={field.name} type={field.name === "phone" ? "tel" : "text"} autoComplete={field.autoComplete}
        required={field.min > 0} minLength={field.min || undefined} maxLength={field.max}
        onChange={event => { if (field.name in destination) { setDestination(previous => ({ ...previous, [field.name]: event.target.value })); setRateId(""); } }}
        className="mt-2 w-full rounded-md border bg-background p-3" />
    </label>)}
    {sandbox ? <>
      <label className="block text-sm font-medium">Configured delivery service
        <select name="rate_id" required value={rateId} onChange={event => setRateId(event.target.value)} className="mt-2 w-full rounded-md border bg-background p-3">
          <option value="">Select delivery after entering your address</option>
          {available.map(rate => <option key={rate.id} value={rate.id}>{rate.label} · {rate.method} · {money(rate.amount_minor, currency)}</option>)}
        </select>
      </label>
      <input type="hidden" name="delivery_method" value={selected?.method ?? ""} />
      {!available.length && <p role="status">No configured service matches this destination and currency. Checkout is unavailable until a delivery rate is approved.</p>}
      {quote && <div aria-live="polite"><p>Subtotal: {money(quote.subtotal, currency)}</p><p>Shipping: {money(quote.shipping, currency)}</p><p className="font-semibold">Total: {money(quote.total, currency)} {currency}</p></div>}
      <p className="text-sm">Sandbox only. One unit from one seller per order. Supplier sourcing is handled manually; there is no automatic stock synchronization or promised delivery date. Separate orders may arrive separately.</p>
    </> : <label className="block text-sm font-medium">Delivery preference (not a quote)
      <select name="delivery_method" defaultValue="standard" required className="mt-2 w-full rounded-md border bg-background p-3"><option value="standard">Standard</option><option value="express">Express</option></select>
    </label>}
    <Submit sandbox={sandbox} disabled={sandbox && !quote} />
  </form>;
}
