import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // This endpoint deliberately uses anonymous RLS, never cookies or a user session.
  if (/^\/api\/product-thumbnails\/[0-9a-f-]+$/i.test(request.nextUrl.pathname)) return NextResponse.next();
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and images.
     * Extend this matcher when adding auth-protected routes.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
