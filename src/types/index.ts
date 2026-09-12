export interface NavLink {
  label: string;
  href: string;
}

export interface PageMetadata {
  title: string;
  description: string;
}

export type SellerStatus =
  | "pending"
  | "active"
  | "suspended"
  | "closed"
  | "rejected";

export interface SellerProfile {
  id: string;
  user_id: string;
  store_name: string;
  store_slug: string;
  store_description: string | null;
  logo_url: string | null;
  country_code: string | null;
  default_currency: string;
  status: SellerStatus;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
